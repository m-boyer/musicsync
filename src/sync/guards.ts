import type { SyncMode } from '../config.js';
import type { ReadResult } from '../providers/types.js';

/**
 * Why a cycle must not change anything, or undefined when the reads can be trusted. A service that
 * reads empty is only suspicious if it had linked songs: otherwise it may just be a new account,
 * or still waiting for the first song added to it.
 */
export function readBlockReason(
  apple: ReadResult,
  youtube: ReadResult,
  seen: { apple: number; youtube: number },
): string | undefined {
  if (!apple.complete) return 'apple_read_incomplete';
  if (!youtube.complete) return 'youtube_read_incomplete';
  if (seen.apple > 0 && apple.tracks.length === 0) return 'apple_read_empty';
  if (seen.youtube > 0 && youtube.tracks.length === 0) return 'youtube_read_empty';
  return undefined;
}

export type DeleteDecision = 'allowed' | 'not_enabled' | 'over_limit';

export function deleteDecision(mode: SyncMode, count: number, maxPerCycle: number): DeleteDecision {
  if (mode !== 'full') return 'not_enabled';
  return count > maxPerCycle ? 'over_limit' : 'allowed';
}
