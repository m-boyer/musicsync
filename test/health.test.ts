import { afterEach, describe, expect, it } from 'vitest';
import { healthResponse, setReady } from '../src/health.js';

describe('healthResponse', () => {
  afterEach(() => setReady(false));

  it('reports starting until the service is ready', () => {
    expect(healthResponse('abc')).toEqual({ status: 503, body: { status: 'starting', revision: 'abc' } });
  });

  it('reports the revision once ready', () => {
    setReady(true);
    expect(healthResponse('abc')).toEqual({ status: 200, body: { status: 'ok', revision: 'abc' } });
  });
});
