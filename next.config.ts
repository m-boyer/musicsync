import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['pg', 'youtubei.js', '@syncfm/applemusic-api', '@sentry/node', 'better-auth'],
  experimental: { cpus: 1, webpackMemoryOptimizations: true },
  webpack: (config) => {
    // The server code imports TypeScript files with their compiled .js name.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
  rewrites: async () => [{ source: '/health', destination: '/api/health' }],
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'X-Robots-Tag', value: 'noindex' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
      ],
    },
  ],
};

export default nextConfig;
