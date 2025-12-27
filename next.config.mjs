/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  images: { unoptimized: true },
  compress: true,
  productionBrowserSourceMaps: false,
  poweredByHeader: false, // 隐藏X-Powered-By头

  // 🔥 安全增强：输出独立构建，优化安全
  output: 'standalone',

  // 🔥 修复 Turbopack 配置问题
  turbopack: {},

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // 防止MIME类型混淆攻击
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // 防止点击劫持
          { key: 'X-Frame-Options', value: 'DENY' },
          // XSS防护
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          // 引用者策略
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // 内容安全策略（基础版）
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://apilist.tronscanapi.com"
          },
        ],
      },
      {
        source: '/api/(.*)',
        headers: [
          // API端点额外安全头
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // 防止缓存敏感API响应
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ]
  },

  // 🔥 本地开发环境移除实验性配置

  // 禁用某些可能有安全风险的功能
  webpack: (config, { dev, isServer }) => {
    // 生产环境移除source maps
    if (!dev && !isServer) {
      config.devtool = false
    }

    // 移除可能泄露源码的插件
    if (config.optimization && config.optimization.minimizer) {
      config.optimization.minimizer.forEach((minimizer) => {
        if (minimizer.options && minimizer.options.extractComments !== undefined) {
          minimizer.options.extractComments = false
        }
      })
    }

    return config
  },
}

export default nextConfig
