import { describe, expect, it } from 'vitest';
import type { Track } from '../src/providers/types.js';
import { bestMatch, pairLocally, scoreTracks } from '../src/sync/matcher.js';

const t = (id: string, title: string, artist: string, durationMs?: number): Track => ({
  id,
  title,
  artist,
  ...(durationMs === undefined ? {} : { durationMs }),
});

describe('scoreTracks', () => {
  it('scores the same song on both services highly despite formatting', () => {
    const score = scoreTracks(t('a', 'Canción (feat. Otro)', 'Soda Stereo', 200_000), t('y', 'Cancion', 'Soda Stereo - Topic', 201_000));
    expect(score).toBeGreaterThan(0.95);
  });

  it('accepts an artist list that contains the other artist', () => {
    expect(scoreTracks(t('a', 'Song', 'Dua Lipa & Elton John'), t('y', 'Song', 'Dua Lipa'))).toBeGreaterThan(0.95);
  });

  it('rejects a different version of the song', () => {
    expect(scoreTracks(t('a', 'Song', 'Band', 200_000), t('y', 'Song (Live)', 'Band', 200_000))).toBeLessThan(0.8);
  });

  it('rejects a different song by the same artist', () => {
    expect(scoreTracks(t('a', 'Sunrise', 'Band'), t('y', 'Midnight', 'Band'))).toBeLessThan(0.8);
  });

  it('lowers the score as durations drift apart', () => {
    const base = t('a', 'Song', 'Band', 200_000);
    const near = scoreTracks(base, t('y', 'Song', 'Band', 203_000));
    const mid = scoreTracks(base, t('y', 'Song', 'Band', 209_000));
    const far = scoreTracks(base, t('y', 'Song', 'Band', 300_000));
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it('handles missing text', () => expect(scoreTracks(t('a', '', ''), t('y', '', ''))).toBe(0));
});

describe('bestMatch', () => {
  it('returns the highest candidate over the threshold', () => {
    const source = t('a', 'Song', 'Band', 200_000);
    const match = bestMatch(source, [t('1', 'Song', 'Band', 215_000), t('2', 'Song', 'Band', 200_000)], 0.8);
    expect(match?.track.id).toBe('2');
  });

  it('returns nothing under the threshold', () => {
    expect(bestMatch(t('a', 'Song', 'Band'), [t('1', 'Other', 'Person')], 0.8)).toBeUndefined();
  });
});

describe('pairLocally', () => {
  it('uses each song once, keeping the best pair', () => {
    const pairs = pairLocally(
      [t('a1', 'Song', 'Band', 200_000), t('a2', 'Song', 'Band', 260_000)],
      [t('y1', 'Song', 'Band', 200_000)],
      0.8,
    );
    expect(pairs.map((pair) => [pair.apple.id, pair.youtube.id])).toEqual([['a1', 'y1']]);
  });

  it('ignores songs with no shared title words', () => {
    expect(pairLocally([t('a', 'One', 'Band')], [t('y', 'Two', 'Band')], 0.8)).toEqual([]);
  });

  it('pairs several songs in one bucket', () => {
    const pairs = pairLocally(
      [t('a1', 'Love Song', 'Band'), t('a2', 'Love Story', 'Singer')],
      [t('y1', 'Love Song', 'Band'), t('y2', 'Love Story', 'Singer')],
      0.8,
    );
    expect(pairs).toHaveLength(2);
  });
});
