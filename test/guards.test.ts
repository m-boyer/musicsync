import { describe, expect, it } from 'vitest';
import { deleteDecision, readBlockReason } from '../src/sync/guards.js';

const track = { id: '1', title: 't', artist: 'a' };
const good = { tracks: [track], complete: true };

describe('readBlockReason', () => {
  it('allows complete reads', () => expect(readBlockReason(good, good, { apple: 1, youtube: 1 })).toBeUndefined());
  it('allows an empty read when that side had no linked songs', () =>
    expect(readBlockReason({ tracks: [], complete: true }, good, { apple: 0, youtube: 3 })).toBeUndefined());
  it.each([
    [{ tracks: [track], complete: false }, good, 'apple_read_incomplete'],
    [good, { tracks: [track], complete: false }, 'youtube_read_incomplete'],
    [{ tracks: [], complete: true }, good, 'apple_read_empty'],
    [good, { tracks: [], complete: true }, 'youtube_read_empty'],
  ])('blocks untrusted reads', (apple, youtube, reason) => {
    expect(readBlockReason(apple, youtube, { apple: 3, youtube: 3 })).toBe(reason);
  });
});

describe('deleteDecision', () => {
  it('only allows deletions in full mode', () => {
    expect(deleteDecision('dry-run', 1, 5)).toBe('not_enabled');
    expect(deleteDecision('add-only', 1, 5)).toBe('not_enabled');
    expect(deleteDecision('full', 5, 5)).toBe('allowed');
  });
  it('blocks a batch over the limit', () => expect(deleteDecision('full', 6, 5)).toBe('over_limit'));
});
