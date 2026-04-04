/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@announcement/shared'],
  // Enable standalone output for Docker deployments
  output: 'standalone',
  env: {
    NEXT_PUBLIC_LICENSE_SERVER_URL: process.env.NEXT_PUBLIC_LICENSE_SERVER_URL ?? 'http://localhost:3001',
  },
}

export default nextConfig
