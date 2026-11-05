import http from 'node:http';

export interface HealthState {
  revision: string;
  isReady(): boolean;
}

// Contract expected by m-boyer/Pipelines coolify-deploy (health_mode: revision-json).
export function startHealthServer(port: number, state: HealthState): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url?.split('?')[0] !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const ready = state.isReady();
    res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ status: ready ? 'ok' : 'starting', revision: state.revision }));
  });
  // No host: listen dual-stack, since probes may resolve `localhost` to ::1 (Coolify does on Alpine).
  server.listen(port);
  return server;
}
