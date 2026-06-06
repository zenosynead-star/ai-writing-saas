/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  // Prisma is a Node-only runtime; force Node Lambda on Vercel
  // @napi-rs/canvas は native binary を含むので webpack でバンドルさせない
  serverExternalPackages: ['@prisma/client', 'bcryptjs', '@napi-rs/canvas'],
};
export default nextConfig;
