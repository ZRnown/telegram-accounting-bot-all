import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 🔥 本地开发环境中间件（简化版）
// 生产环境使用 middleware-proxy.ts

export function middleware(request: NextRequest) {
  // 本地开发环境跳过复杂的安全检查
  // 只保留基本的路径验证

  const { pathname } = request.nextUrl

  // 🔥 防止路径遍历攻击（基本检查）
  if (pathname.includes('..') || pathname.includes('\\')) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // 本地开发环境允许所有请求通过
  return NextResponse.next()
}

// 🔥 配置中间件匹配的路径（本地开发）
export const config = {
  matcher: [
    /*
     * 本地开发环境：只对API路径进行基本检查
     */
    '/api/:path*',
  ],
}
