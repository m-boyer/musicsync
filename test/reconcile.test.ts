import { describe, expect, it } from 'vitest';
import type { Track } from '../src/providers/types.js';
import { reconcile, type Link } from '../src/sync/reconcile.js';

const now = new Date('2026-11-05T12:00:00Z');
const old = new Date('2026-11-01T00:00:00Z');
const graceMs = 30 * 60_000;
const t = (id: string): Track => ({ id, title: id, artist: 'x' });
const link = (overrides: Partial<Link> = {}): Link => ({
  appleId: 'a',
  youtubeId: 'y',
  appleSeenAt: old,
  youtubeSeenAt: old,
  linkedAt: old,
  ...overrides,
});
const run = (apple: Track[], youtube: Track[], links: Link[]) => reconcile({ apple, youtube, links, now, graceMs });

describe('reconcile', () => {
  it('does nothing when both sides still have the song', () => {
    const plan = run([t('a')], [t('y')], [link()]);
    expect(plan.deletions).toEqual([]);
    expect(plan.unlinkedApple).toEqual([]);
    expect(plan.unlinkedYoutube).toEqual([]);
  });

  it('reports songs without a link as new, never as deletions', () => {
    const plan = run([t('a2')], [t('y2')], []);
    expect(plan.unlinkedApple).toEqual([t('a2')]);
    expect(plan.unlinkedYoutube).toEqual([t('y2')]);
    expect(plan.deletions).toEqual([]);
  });

  it('removes from Apple a song removed from YouTube', () => {
    const plan = run([t('a')], [], [link()]);
    expect(plan.deletions).toMatchObject([{ from: 'apple', track: t('a') }]);
  });

  it('removes from YouTube a song removed from Apple', () => {
    const plan = run([], [t('y')], [link()]);
    expect(plan.deletions).toMatchObject([{ from: 'youtube', track: t('y') }]);
  });

  it('forgets a song gone from both sides', () => {
    const gone = link();
    const plan = run([], [], [gone]);
    expect(plan.forget).toEqual([gone]);
    expect(plan.deletions).toEqual([]);
  });

  it('waits for a recently added song instead of deleting it', () => {
    const plan = run([t('a')], [], [link({ youtubeSeenAt: null, linkedAt: new Date(now.getTime() - 60_000) })]);
    expect(plan.waiting).toBe(1);
    expect(plan.deletions).toEqual([]);
  });

  it('reports an added song that never showed up, without deleting it', () => {
    const plan = run([], [t('y')], [link({ appleSeenAt: null })]);
    expect(plan.neverAppeared).toMatchObject([{ missingFrom: 'apple', track: t('y') }]);
    expect(plan.deletions).toEqual([]);
  });

  it('marks an added song as seen when it shows up', () => {
    const pendingApple = link({ appleSeenAt: null });
    const pendingYoutube = link({ youtubeSeenAt: null });
    expect(run([t('a')], [t('y')], [pendingApple]).seenApple).toEqual([pendingApple]);
    expect(run([t('a')], [t('y')], [pendingYoutube]).seenYoutube).toEqual([pendingYoutube]);
  });
});
