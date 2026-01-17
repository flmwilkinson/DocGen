/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@docgen/shared'],
  images: {
    domains: ['localhost'],
  },
};

module.exports = nextConfig;

