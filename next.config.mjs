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
  // 修复服务器部署问题
  webpack: (config, { isServer, dev }) => {
    if (!isServer) {
      // 确保客户端 chunk 正确生成
      config.optimization = {
        ...config.optimization,
        moduleIds: 'deterministic',
        // 确保 chunk 文件名稳定
        chunkIds: 'deterministic',
      }
    }
    return config
  },
  // 确保静态文件正确生成
  outputFileTracing: true,
  // 压缩输出
  compress: true,
  // 生产环境优化
  productionBrowserSourceMaps: false,
  // 确保正确的 base path（如果部署在子路径）
  // basePath: process.env.BASE_PATH || '',
}

export default nextConfig
