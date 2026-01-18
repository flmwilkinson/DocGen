/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@docgen/shared', 'docx'],
  images: {
    domains: ['localhost'],
  },
  // Performance optimizations
  reactStrictMode: true,
  swcMinify: true,
  // Optimize bundle size
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  // Compress responses
  compress: true,
};

module.exports = nextConfig;

