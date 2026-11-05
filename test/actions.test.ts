import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('server actions and panel pages', () => {
  it('checks the session first in every action', () => {
    const source = readFileSync('app/(panel)/actions.ts', 'utf8');
    const actions = [...source.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n\s*(.*)/g)];
    expect(actions.length).toBeGreaterThanOrEqual(9);
    for (const [, name, firstLine] of actions) {
      expect(`${name}: ${firstLine}`).toBe(`${name}: await requireSession();`);
    }
  });

  it.each(['page', 'credentials/page', 'tests/page', 'settings/page', 'history/page', 'pending/page'])(
    'checks the session in %s',
    (page) => {
      expect(readFileSync(`app/(panel)/${page}.tsx`, 'utf8')).toContain('await requireSession();');
    },
  );
});
