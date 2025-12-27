import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 🔥 安全增强：敏感路径保护
const SENSITIVE_PATHS = [
  '/api/auth',
  '/api/bots',
  '/api/chats',
  '/api/bills',
  '/dashboard'
]

// 🔥 安全增强：API速率限制存储（内存中，生产环境建议使用Redis）
const RATE_LIMIT_STORE = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_MAX = 100 // 每窗口最大请求数
const RATE_LIMIT_WINDOW = 15 * 60 * 1000 // 15分钟窗口

function checkRateLimit(clientId: string): boolean {
  const now = Date.now()
  const record = RATE_LIMIT_STORE.get(clientId)

  if (!record || now > record.resetTime) {
    // 重置或新建记录
    RATE_LIMIT_STORE.set(clientId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
    return true
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false
  }

  record.count++
  return true
}

function getClientId(request: NextRequest): string {
  // 优先使用IP，其次使用User-Agent作为辅助标识
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')
  const ip = forwarded?.split(',')[0].trim() || realIp || 'unknown'
  const ua = request.headers.get('user-agent') || ''
  return `${ip}:${ua.slice(0, 50)}` // 限制UA长度
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 🔥 安全增强：记录可疑请求
  if (pathname.includes('..') || pathname.includes('\\')) {
    console.warn(`[SECURITY] Path traversal attempt: ${pathname} from ${getClientId(request)}`)
    return new NextResponse('Forbidden', { status: 403 })
  }

  // 🔥 安全增强：检查敏感路径的速率限制
  const isSensitivePath = SENSITIVE_PATHS.some(path => pathname.startsWith(path))
  if (isSensitivePath) {
    const clientId = getClientId(request)

    if (!checkRateLimit(clientId)) {
      console.warn(`[SECURITY] Rate limit exceeded for ${pathname} from ${clientId}`)
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: {
          'Retry-After': '900', // 15分钟后重试
          'X-RateLimit-Limit': RATE_LIMIT_MAX.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(Date.now() + RATE_LIMIT_WINDOW).toISOString()
        }
      })
    }
  }

  // 🔥 安全增强：强制HTTPS重定向（生产环境）
  if (process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS === 'true') {
    const host = request.headers.get('host')
    const protocol = request.headers.get('x-forwarded-proto') || 'http'

    if (protocol !== 'https' && !host?.includes('localhost')) {
      const httpsUrl = `https://${host}${request.nextUrl.pathname}${request.nextUrl.search}`
      console.log(`[HTTPS] Redirecting to: ${httpsUrl}`)
      return NextResponse.redirect(httpsUrl, 301)
    }
  }

  // 🔥 安全增强：阻止常见的攻击载荷
  const suspiciousPatterns = [
    /(\.\.|\\|%2e%2e|%2e)/i, // 路径遍历
    /(<script|javascript:|data:|vbscript:)/i, // XSS
    /(union.*select|select.*from|insert.*into|update.*set|delete.*from)/i, // SQL注入
    /(\.\.\/|\.\.\\)/, // 目录遍历
  ]

  const url = request.url
  const userAgent = request.headers.get('user-agent') || ''

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(url) || pattern.test(userAgent)) {
      console.warn(`[SECURITY] Suspicious request blocked: ${url} UA: ${userAgent.slice(0, 100)}`)
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  // 🔥 安全增强：检查请求头
  const contentType = request.headers.get('content-type')
  if (request.method === 'POST' && !contentType?.includes('application/json') && pathname.startsWith('/api/')) {
    // API请求应该都是JSON格式
    console.warn(`[SECURITY] Invalid content-type for API: ${contentType} on ${pathname}`)
    return new NextResponse('Bad Request', { status: 400 })
  }

  // 清理过期的速率限制记录（每1000个请求清理一次）
  if (Math.random() < 0.001) {
    const now = Date.now()
    for (const [key, record] of RATE_LIMIT_STORE.entries()) {
      if (now > record.resetTime) {
        RATE_LIMIT_STORE.delete(key)
      }
    }
  }

  return NextResponse.next()
}

// 🔥 安全增强：配置中间件匹配的路径
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}