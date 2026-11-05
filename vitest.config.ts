import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // These only wire the pieces together; they are covered by running the app in Docker.
      exclude: ['src/runtime.ts', 'src/boot.ts', 'src/auth/server.ts', 'src/auth/client.ts', 'src/auth/guard.ts', 'src/probe/start.ts'],
      reporter: ['text', 'html', 'json-summary'],
      // The deploy pipeline runs `npm run test:coverage`; dropping below this fails the deploy.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
