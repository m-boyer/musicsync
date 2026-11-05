import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { startHealthServer } from '../src/health.js';

let close: (() => void) | undefined;

afterEach(() => close?.());

async function serve(isReady: () => boolean) {
  const server = startHealthServer(0, { revision: 'abc123', isReady });
  close = () => server.close();
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('health server binding', () => {
  it('answers on both IPv4 and IPv6 loopback (probes may resolve localhost to ::1)', async () => {
    const port = new URL(await serve(() => true)).port;
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    expect((await fetch(`http://[::1]:${port}/health`)).status).toBe(200);
  });
});

describe('health server', () => {
  it('reports starting with 503 until the bot is ready, then ok with the revision', async () => {
    let ready = false;
    const base = await serve(() => ready);

    const starting = await fetch(`${base}/health`);
    expect(starting.status).toBe(503);
    expect(await starting.json()).toEqual({ status: 'starting', revision: 'abc123' });

    ready = true;
    const ok = await fetch(`${base}/health?probe=1`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.json()).toEqual({ status: 'ok', revision: 'abc123' });
  });

  it('answers 404 for anything else', async () => {
    const base = await serve(() => true);
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/health`, { method: 'POST' })).status).toBe(404);
  });
});
