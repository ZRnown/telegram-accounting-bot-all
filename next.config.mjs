/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // 修复 chunk 加载错误：确保静态文件正确生成
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // 确保客户端 chunk 正确生成
      config.optimization = {
        ...config.optimization,
        moduleIds: 'deterministic',
      }
    }
    return config
  },
}

export default nextConfig
