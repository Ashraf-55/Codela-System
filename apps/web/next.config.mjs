/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  transpilePackages: ['@codela/design', '@codela/shared'],
  poweredByHeader: false,
  // Next 16 blocks dev-only /_next/* requests (incl. the HMR WebSocket) from origins it does not know; 127.0.0.1 and localhost count as different origins.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // /api/* passes through proxy.ts, which would otherwise cut request bodies at 10 MB; hosted lesson videos go up to 150 MB
  experimental: { proxyClientMaxBodySize: '160mb' },
  // production build type-checks the app only (tests need vitest, a dev dependency that hosts may not install)
  typescript: { tsconfigPath: 'tsconfig.build.json' },
  images: { unoptimized: true }, // the image optimizer is not used (tenant logos are plain <img>); keeps that attack surface closed
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      // Conservative CSP subset (does not restrict scripts/styles, so Next.js keeps working): no plugins, no <base> hijack, forms only to self, framing only by self.
      { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'" },
      ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []) ] }];
  },
};
