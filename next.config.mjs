/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  images: { unoptimized: true },
  compress: true,
  productionBrowserSourceMaps: false,
  // basePath: process.env.BASE_PATH || '',
}

export default nextConfig
