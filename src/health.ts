const state = globalThis as unknown as { __musicsyncReady?: boolean };

export function setReady(ready: boolean): void {
  state.__musicsyncReady = ready;
}

/** Contract expected by m-boyer/Pipelines coolify-deploy (health_mode: revision-json). */
export function healthResponse(revision = process.env.APP_REVISION ?? 'unknown'): { status: number; body: object } {
  const ready = state.__musicsyncReady === true;
  return { status: ready ? 200 : 503, body: { status: ready ? 'ok' : 'starting', revision } };
}
