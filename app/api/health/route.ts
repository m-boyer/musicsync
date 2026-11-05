import { healthResponse } from '../../../src/health';

export const dynamic = 'force-dynamic';

export function GET() {
  const { status, body } = healthResponse();
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
