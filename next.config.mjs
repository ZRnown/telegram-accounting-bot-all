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

  // 🛡️ 最高安全级别配置
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // 🛡️ 防止MIME类型混淆攻击
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // 🛡️ 防止点击劫持
          { key: 'X-Frame-Options', value: 'DENY' },
          // 🛡️ 防止跨域资源嵌入
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // 🛡️ XSS防护
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          // 🛡️ 引用者策略 - 最高安全级别
          { key: 'Referrer-Policy', value: 'no-referrer' },
          // 🛡️ HSTS - 强制HTTPS，最大期限
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          // 🛡️ 权限策略 - 禁用不必要的浏览器功能
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          // 🛡️ 内容安全策略 - 最高安全级别
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'", // Radix UI需要
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://apilist.tronscanapi.com https://api.telegram.org",
              "frame-src 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "upgrade-insecure-requests"
            ].join('; ')
          },
        ],
      },
      {
        source: '/api/(.*)',
        headers: [
          // 🛡️ API端点最高安全头
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // 🛡️ 防止缓存敏感API响应
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate, private' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
          // 🛡️ CORS策略 - 只允许特定域名
          { key: 'Access-Control-Allow-Origin', value: process.env.ALLOWED_ORIGIN || 'null' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, X-Requested-With' },
          { key: 'Access-Control-Allow-Credentials', value: 'false' },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ],
      },
      {
        source: '/dashboard(.*)',
        headers: [
          // 🛡️ 管理面板额外保护
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" },
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
