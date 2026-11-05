import { toNextJsHandler } from 'better-auth/next-js';
import { getRuntime } from '../../../../src/runtime';

const handler = (request: Request) => getRuntime().auth.handler(request);

export const { GET, POST } = toNextJsHandler(handler);
