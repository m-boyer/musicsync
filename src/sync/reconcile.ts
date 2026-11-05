import type { Service, Track } from '../providers/types.js';

export interface Link {
  appleId: string;
  youtubeId: string;
  appleSeenAt: Date | null;
  youtubeSeenAt: Date | null;
  linkedAt: Date;
}

export interface Deletion {
  /** Service the song must be removed from. */
  from: Service;
  track: Track;
  link: Link;
}

export interface ReconcileInput {
  apple: Track[];
  youtube: Track[];
  links: Link[];
  now: Date;
  graceMs: number;
}

export interface ReconcilePlan {
  seenApple: Link[];
  seenYoutube: Link[];
  /** Gone from both services. */
  forget: Link[];
  /** Added to a service and still missing after the grace period. */
  neverAppeared: { link: Link; missingFrom: Service; track: Track }[];
  /** Added to a service recently and still missing: not treated as a deletion yet. */
  waiting: number;
  deletions: Deletion[];
  unlinkedApple: Track[];
  unlinkedYoutube: Track[];
}

/**
 * Three-way comparison of both services against the last saved state. A song on one side only is
 * a new song when it has no link, and a deletion when its link says it was on the other side.
 */
export function reconcile(input: ReconcileInput): ReconcilePlan {
  const apple = new Map(input.apple.map((track) => [track.id, track]));
  const youtube = new Map(input.youtube.map((track) => [track.id, track]));
  const plan: ReconcilePlan = {
    seenApple: [],
    seenYoutube: [],
    forget: [],
    neverAppeared: [],
    waiting: 0,
    deletions: [],
    unlinkedApple: [],
    unlinkedYoutube: [],
  };

  const onlyOnOneSide = (link: Link, track: Track, missingFrom: Service, missingSeenAt: Date | null) => {
    if (missingSeenAt) {
      plan.deletions.push({ from: missingFrom === 'apple' ? 'youtube' : 'apple', track, link });
    } else if (input.now.getTime() - link.linkedAt.getTime() < input.graceMs) {
      plan.waiting += 1;
    } else {
      plan.neverAppeared.push({ link, missingFrom, track });
    }
  };

  for (const link of input.links) {
    const inApple = apple.get(link.appleId);
    const inYoutube = youtube.get(link.youtubeId);
    if (inApple && !link.appleSeenAt) plan.seenApple.push(link);
    if (inYoutube && !link.youtubeSeenAt) plan.seenYoutube.push(link);

    if (inApple && !inYoutube) onlyOnOneSide(link, inApple, 'youtube', link.youtubeSeenAt);
    else if (inYoutube && !inApple) onlyOnOneSide(link, inYoutube, 'apple', link.appleSeenAt);
    else if (!inApple && !inYoutube) plan.forget.push(link);
  }

  const linkedApple = new Set(input.links.map((link) => link.appleId));
  const linkedYoutube = new Set(input.links.map((link) => link.youtubeId));
  plan.unlinkedApple = input.apple.filter((track) => !linkedApple.has(track.id));
  plan.unlinkedYoutube = input.youtube.filter((track) => !linkedYoutube.has(track.id));
  return plan;
}
