import type { Track } from '../providers/types.js';

export interface Match {
  track: Track;
  score: number;
}

export interface LocalPair {
  apple: Track;
  youtube: Track;
  score: number;
}

const VERSION_WORDS = ['live', 'remix', 'acoustic', 'instrumental', 'karaoke', 'cover', 'sped', 'slowed', 'demo'];
const DURATION_CLOSE_MS = 3_000;
const DURATION_FAR_MS = 15_000;
const VERSION_PENALTY = 0.3;

function tokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Removes what the services add around a title, keeping the words checked by {@link VERSION_WORDS}. */
function titleTokens(title: string): string[] {
  const withoutFeatures = title.replace(/[([]\s*(feat\.?|ft\.?|with)\b[^)\]]*[)\]]/giu, ' ');
  const withoutSuffix = withoutFeatures.replace(/\s(feat\.?|ft\.?)\s.*$/iu, ' ');
  return tokens(withoutSuffix);
}

function artistTokens(artist: string): string[] {
  return tokens(artist.replace(/\s-\sTopic$/iu, '')).filter((token) => token !== 'and');
}

function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const inB = new Set(b);
  const shared = new Set(a.filter((token) => inB.has(token))).size;
  return (2 * shared) / (new Set(a).size + inB.size);
}

/** Artist lists differ between services, so finding one inside the other counts as a full match. */
function containment(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  const inLonger = new Set(longer);
  return shorter.filter((token) => inLonger.has(token)).length / shorter.length;
}

function durationScore(a?: number, b?: number): number | undefined {
  if (a === undefined || b === undefined) return undefined;
  const difference = Math.abs(a - b);
  if (difference <= DURATION_CLOSE_MS) return 1;
  if (difference >= DURATION_FAR_MS) return 0;
  return 1 - (difference - DURATION_CLOSE_MS) / (DURATION_FAR_MS - DURATION_CLOSE_MS);
}

/** Similarity between 0 and 1. */
export function scoreTracks(a: Track, b: Track): number {
  const titleA = titleTokens(a.title);
  const titleB = titleTokens(b.title);
  const title = overlap(titleA, titleB);
  const artist = containment(artistTokens(a.artist), artistTokens(b.artist));
  const duration = durationScore(a.durationMs, b.durationMs);

  const base =
    duration === undefined ? title * 0.65 + artist * 0.35 : title * 0.55 + artist * 0.3 + duration * 0.15;

  const versionDiffers = VERSION_WORDS.some((word) => titleA.includes(word) !== titleB.includes(word));
  return Math.max(0, versionDiffers ? base - VERSION_PENALTY : base);
}

export function bestMatch(source: Track, candidates: Track[], threshold: number): Match | undefined {
  let best: Match | undefined;
  for (const track of candidates) {
    const score = scoreTracks(source, track);
    if (score >= threshold && (!best || score > best.score)) best = { track, score };
  }
  return best;
}

/** Pairs songs already on both sides without any search. Each song is used at most once. */
export function pairLocally(apple: Track[], youtube: Track[], threshold: number): LocalPair[] {
  const byTitleToken = new Map<string, Track[]>();
  for (const track of youtube) {
    for (const token of new Set(titleTokens(track.title))) {
      const bucket = byTitleToken.get(token);
      if (bucket) bucket.push(track);
      else byTitleToken.set(token, [track]);
    }
  }

  const pairs: LocalPair[] = [];
  for (const track of apple) {
    const candidates = new Set(titleTokens(track.title).flatMap((token) => byTitleToken.get(token) ?? []));
    for (const candidate of candidates) {
      const score = scoreTracks(track, candidate);
      if (score >= threshold) pairs.push({ apple: track, youtube: candidate, score });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  const usedApple = new Set<string>();
  const usedYoutube = new Set<string>();
  return pairs.filter((pair) => {
    if (usedApple.has(pair.apple.id) || usedYoutube.has(pair.youtube.id)) return false;
    usedApple.add(pair.apple.id);
    usedYoutube.add(pair.youtube.id);
    return true;
  });
}
