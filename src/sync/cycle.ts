import { logger } from '../logger.js';
import type { MusicProvider, Service, Track } from '../providers/types.js';
import type { SyncMode } from '../repos/settings.js';
import type { MatchResult, StateRepo } from '../repos/state.js';
import { deleteDecision, readBlockReason } from './guards.js';
import { bestMatch, pairLocally, scoreTracks } from './matcher.js';
import { reconcile, type Link } from './reconcile.js';
import { LocalizedError, type Message } from '../i18n/index.js';

const SAMPLE_SIZE = 50;

export interface CycleOptions {
  mode: SyncMode;
  maxOpsPerCycle: number;
  maxDeletesPerCycle: number;
  graceMs: number;
  matchThreshold: number;
}

export interface CycleDeps {
  apple: MusicProvider;
  youtube: MusicProvider;
  repo: StateRepo;
  options: CycleOptions;
  now?: () => Date;
}

export interface SongSummary {
  to: Service;
  title: string;
  artist: string;
}

export interface CycleSummary {
  appleSongs: number;
  youtubeSongs: number;
  linked: number;
  linkedLocally: number;
  searched: number;
  deferredSearches: number;
  pending: number;
  added: number;
  plannedAdds: number;
  deferredAdds: number;
  deleted: number;
  plannedDeletes: number;
  waiting: number;
  failures: number;
  deleteDecision?: string;
  blockedReason?: string;
  addSample: SongSummary[];
  deleteSample: SongSummary[];
}

export type CycleStatus = 'ok' | 'partial' | 'blocked' | 'failed';

export interface CycleResult {
  status: CycleStatus;
  summary: CycleSummary;
}

function emptySummary(): CycleSummary {
  return {
    appleSongs: 0,
    youtubeSongs: 0,
    linked: 0,
    linkedLocally: 0,
    searched: 0,
    deferredSearches: 0,
    pending: 0,
    added: 0,
    plannedAdds: 0,
    deferredAdds: 0,
    deleted: 0,
    plannedDeletes: 0,
    waiting: 0,
    failures: 0,
    addSample: [],
    deleteSample: [],
  };
}

/**
 * Keeps only the message and HTTP status. HTTP client errors carry the request, including the
 * account credentials in its headers, so the original must never reach the logs or Sentry.
 */
export function safeError(error: unknown): Error {
  if (error instanceof LocalizedError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return new Error(typeof status === 'number' ? `${message} (HTTP ${status})` : message);
}

/** What is saved and shown for an error: a translatable message when the app raised it. */
export function errorMessage(error: unknown): Message {
  return error instanceof LocalizedError ? error.toMessage() : safeError(error).message;
}

function matchKey(service: Service, id: string): string {
  return `${service}:${id}`;
}

function sample(list: SongSummary[], to: Service, track: Pick<Track, 'title' | 'artist'>): void {
  if (list.length < SAMPLE_SIZE) list.push({ to, title: track.title, artist: track.artist });
}

function linkFor(
  source: Service,
  sourceId: string,
  targetId: string,
  now: Date,
  targetPresent: boolean,
): Pick<Link, 'appleId' | 'youtubeId' | 'appleSeenAt' | 'youtubeSeenAt'> {
  const targetSeenAt = targetPresent ? now : null;
  return source === 'apple'
    ? { appleId: sourceId, youtubeId: targetId, appleSeenAt: now, youtubeSeenAt: targetSeenAt }
    : { appleId: targetId, youtubeId: sourceId, appleSeenAt: targetSeenAt, youtubeSeenAt: now };
}

/** One full comparison. Reads both services first, and changes nothing unless both can be trusted. */
export async function runCycle(deps: CycleDeps): Promise<CycleResult> {
  const { apple, youtube, repo, options } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const summary = emptySummary();

  const read = (provider: MusicProvider) =>
    provider.read().catch((error: unknown) => {
      throw new LocalizedError('errors.serviceRead', {
        service: provider.service === 'apple' ? 'Apple Music' : 'YouTube Music',
        error: errorMessage(error),
      });
    });
  const [appleRead, youtubeRead] = await Promise.all([read(apple), read(youtube)]);
  const links = await repo.getLinks();
  summary.appleSongs = appleRead.tracks.length;
  summary.youtubeSongs = youtubeRead.tracks.length;
  summary.linked = links.length;

  const blockedReason = readBlockReason(appleRead, youtubeRead, {
    apple: links.filter((link) => link.appleSeenAt).length,
    youtube: links.filter((link) => link.youtubeSeenAt).length,
  });
  if (blockedReason) {
    summary.blockedReason = blockedReason;
    return { status: 'blocked', summary };
  }

  const plan = reconcile({
    apple: appleRead.tracks,
    youtube: youtubeRead.tracks,
    links,
    now,
    graceMs: options.graceMs,
  });
  summary.waiting = plan.waiting;

  await repo.markSeen('apple', plan.seenApple, now);
  await repo.markSeen('youtube', plan.seenYoutube, now);
  for (const link of plan.forget) await repo.deleteLink(link);

  const matches = new Map((await repo.getMatches()).map((m) => [matchKey(m.service, m.sourceId), m]));

  const saveMatch = async (match: MatchResult) => {
    await repo.saveMatch(match);
    matches.set(matchKey(match.service, match.sourceId), match);
  };

  for (const { link, missingFrom, track } of plan.neverAppeared) {
    await repo.deleteLink(link);
    await saveMatch({
      service: missingFrom === 'apple' ? 'youtube' : 'apple',
      sourceId: track.id,
      status: 'pending',
      title: track.title,
      artist: track.artist,
      reason: 'never_appeared',
    });
    logger.warn('Added song never appeared', { missingFrom, title: track.title, artist: track.artist });
  }
  const dropped = new Set([...plan.forget, ...plan.neverAppeared.map(({ link }) => link)]);

  const pairs = pairLocally(plan.unlinkedApple, plan.unlinkedYoutube, options.matchThreshold);
  for (const pair of pairs) {
    await repo.insertLink({
      appleId: pair.apple.id,
      youtubeId: pair.youtube.id,
      appleSeenAt: now,
      youtubeSeenAt: now,
    });
  }
  summary.linkedLocally = pairs.length;

  const pairedApple = new Set(pairs.map((pair) => pair.apple.id));
  const pairedYoutube = new Set(pairs.map((pair) => pair.youtube.id));
  const present = {
    apple: new Set(appleRead.tracks.map((track) => track.id)),
    youtube: new Set(youtubeRead.tracks.map((track) => track.id)),
  };
  const taken = {
    apple: new Set([...links.filter((link) => !dropped.has(link)).map((link) => link.appleId), ...pairedApple]),
    youtube: new Set([...links.filter((link) => !dropped.has(link)).map((link) => link.youtubeId), ...pairedYoutube]),
  };

  const sources: { source: Service; target: MusicProvider; track: Track }[] = [
    ...plan.unlinkedApple
      .filter((track) => !pairedApple.has(track.id))
      .map((track) => ({ source: 'apple' as const, target: youtube, track })),
    ...plan.unlinkedYoutube
      .filter((track) => !pairedYoutube.has(track.id))
      .map((track) => ({ source: 'youtube' as const, target: apple, track })),
  ];

  let operations = 0;
  for (const { source, target, track } of sources) {
    let match = matches.get(matchKey(source, track.id));

    if (!match) {
      if (operations >= options.maxOpsPerCycle) {
        summary.deferredSearches += 1;
        continue;
      }
      operations += 1;
      summary.searched += 1;
      try {
        const candidates = await target.search(track);
        const best = bestMatch(track, candidates, options.matchThreshold);
        match = {
          service: source,
          sourceId: track.id,
          title: track.title,
          artist: track.artist,
          ...(best
            ? {
                status: 'matched' as const,
                targetId: best.track.id,
                targetTitle: best.track.title,
                targetArtist: best.track.artist,
                score: best.score,
              }
            : {
                status: 'pending' as const,
                reason: 'no_match',
                ...(candidates[0]
                  ? {
                      targetTitle: candidates[0].title,
                      targetArtist: candidates[0].artist,
                      score: scoreTracks(track, candidates[0]),
                    }
                  : {}),
              }),
        };
        await saveMatch(match);
      } catch (error) {
        summary.failures += 1;
        logger.warn('Search failed', { service: target.service, error: safeError(error).message });
        continue;
      }
    }

    if (match.status === 'ignored') continue;
    if (match.status === 'pending' || !match.targetId) {
      summary.pending += 1;
      continue;
    }

    const targetId = match.targetId;
    const targetPresent = present[target.service].has(targetId);

    if (taken[target.service].has(targetId)) {
      // Two versions on this side map to the same song on the other one.
      await saveMatch({ ...match, status: 'pending', reason: 'duplicate_target' });
      summary.pending += 1;
      continue;
    }

    if (targetPresent) {
      await repo.insertLink(linkFor(source, track.id, targetId, now, true));
      taken[target.service].add(targetId);
      summary.linkedLocally += 1;
      continue;
    }

    if (options.mode === 'dry-run') {
      summary.plannedAdds += 1;
      sample(summary.addSample, target.service, track);
      continue;
    }

    if (operations >= options.maxOpsPerCycle) {
      summary.deferredAdds += 1;
      continue;
    }
    operations += 1;
    try {
      await target.add({ id: targetId, title: track.title, artist: track.artist });
      await repo.insertLink(linkFor(source, track.id, targetId, now, false));
      taken[target.service].add(targetId);
      summary.added += 1;
      sample(summary.addSample, target.service, track);
    } catch (error) {
      summary.failures += 1;
      logger.warn('Add failed', { service: target.service, error: safeError(error).message });
    }
  }

  summary.plannedDeletes = plan.deletions.length;
  for (const { from, track } of plan.deletions) sample(summary.deleteSample, from, track);

  const decision = deleteDecision(options.mode, plan.deletions.length, options.maxDeletesPerCycle);
  if (plan.deletions.length > 0) summary.deleteDecision = decision;
  if (decision === 'over_limit') {
    logger.error('Too many deletions: none were applied', undefined, {
      count: plan.deletions.length,
      limit: options.maxDeletesPerCycle,
    });
  }
  if (decision === 'allowed') {
    const providers = { apple, youtube };
    for (const { from, track, link } of plan.deletions) {
      try {
        await providers[from].remove(track);
        await repo.deleteLink(link);
        summary.deleted += 1;
      } catch (error) {
        summary.failures += 1;
        logger.warn('Delete failed', { service: from, error: safeError(error).message });
      }
    }
  }

  // A result for a song no longer there is useless, and dropping it allows a retry if it comes back.
  for (const match of matches.values()) {
    if (!present[match.service].has(match.sourceId)) await repo.deleteMatch(match.service, match.sourceId);
  }

  return { status: summary.failures > 0 || decision === 'over_limit' ? 'partial' : 'ok', summary };
}
