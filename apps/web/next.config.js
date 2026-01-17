/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@docgen/shared', 'docx'],
  images: {
    domains: ['localhost'],
  },
};

module.exports = nextConfig;

