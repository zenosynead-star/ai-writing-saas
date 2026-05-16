/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  // Prisma is a Node-only runtime; force Node Lambda on Vercel
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
};
export default nextConfig;
