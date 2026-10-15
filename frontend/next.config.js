/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    typedRoutes: false
  },
  // Persistent webpack cache decompression can exhaust memory on low-RAM machines
  // (observed as "Array buffer allocation failed"); keep the cache in memory instead.
  webpack: (config) => {
    config.cache = { type: 'memory' };
    return config;
  }
};

module.exports = nextConfig;
