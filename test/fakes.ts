import { vi } from 'vitest';
import type { MusicProvider, ReadResult, Service, Track } from '../src/providers/types.js';
import type { MatchResult, StateRepo, SyncRun } from '../src/repos/state.js';
import type { Link } from '../src/sync/reconcile.js';

export function fakeProvider(service: Service, tracks: Track[] = [], catalog: Track[] = []) {
  const read = vi.fn<() => Promise<ReadResult>>(async () => ({ tracks, complete: true }));
  const search = vi.fn<(track: Track) => Promise<Track[]>>(async () => catalog);
  const add = vi.fn<(track: Track) => Promise<void>>(async () => {});
  const remove = vi.fn<(track: Track) => Promise<void>>(async () => {});
  const provider: MusicProvider = { service, read, search, add, remove };
  return { provider, read, search, add, remove };
}

export class FakeRepo implements StateRepo {
  links: Link[] = [];
  matches: MatchResult[] = [];
  runs: SyncRun[] = [];

  async getLinks() {
    return [...this.links];
  }
  async insertLink(link: Pick<Link, 'appleId' | 'youtubeId' | 'appleSeenAt' | 'youtubeSeenAt'>) {
    this.links.push({ ...link, linkedAt: new Date('2026-11-05T12:00:00Z') });
  }
  async markSeen(service: Service, links: Link[], at: Date) {
    for (const stored of this.links) {
      if (!links.some((link) => link.appleId === stored.appleId)) continue;
      if (service === 'apple') stored.appleSeenAt = at;
      else stored.youtubeSeenAt = at;
    }
  }
  async deleteLink(link: Link) {
    this.links = this.links.filter((stored) => stored.appleId !== link.appleId);
  }
  async getMatches() {
    return [...this.matches];
  }
  async saveMatch(match: MatchResult) {
    await this.deleteMatch(match.service, match.sourceId);
    this.matches.push(match);
  }
  async deleteMatch(service: Service, sourceId: string) {
    this.matches = this.matches.filter((m) => !(m.service === service && m.sourceId === sourceId));
  }
  async recordRun(run: SyncRun) {
    this.runs.push(run);
  }
}
