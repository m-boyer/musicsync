import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // probe.ts only runs by hand against the real services; index.ts only wires the pieces together.
      exclude: ['src/probe.ts', 'src/index.ts'],
      reporter: ['text', 'html', 'json-summary'],
      // The deploy pipeline runs `npm run test:coverage`; dropping below this fails the deploy.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
