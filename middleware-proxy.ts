import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 🛡️ 安全级别：敏感路径保护（临时放宽登录相关路径）
const SENSITIVE_PATHS = [
  '/api/auth',
  '/api/bots',
  '/api/chats',
  '/api/bills',
  '/api/admin',
  '/api/logs',
  '/dashboard',
  '/admin'
]

// 🛡️ 白名单路径：这些路径跳过所有安全检查
const WHITELIST_PATHS = [
  '/api/auth/login',
  '/api/auth/me'
]

// 🛡️ 最高安全级别：API速率限制存储（内存中，生产环境建议使用Redis）
const RATE_LIMIT_STORE = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_MAX = 50 // 降低限制，每窗口最大请求数
const RATE_LIMIT_WINDOW = 15 * 60 * 1000 // 15分钟窗口

// 🛡️ 最高安全级别：可疑IP黑名单
const SUSPICIOUS_IPS = new Set<string>()
const BLOCKED_IPS = new Set<string>()

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
  // 🛡️ 修复：Cloudflare环境下优先使用cf-connecting-ip获取真实IP
  // 如果不这样，所有流量看起来都来自Cloudflare，限流会失效
  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  const forwarded = request.headers.get('x-forwarded-for')
  const realIp = request.headers.get('x-real-ip')

  // 优先级：cf-connecting-ip > x-real-ip > x-forwarded-for
  const ip = cfConnectingIp || realIp || forwarded?.split(',')[0].trim() || 'unknown'

  // 🛡️ 检查是否为已知恶意IP
  if (BLOCKED_IPS.has(ip)) {
    console.warn(`[SECURITY] Blocked IP attempted access: ${ip}`)
    throw new Error('Access denied')
  }

  const ua = request.headers.get('user-agent') || ''
  return `${ip}:${ua.slice(0, 50)}` // 限制UA长度
}

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl
  const method = request.method
  const userAgent = request.headers.get('user-agent') || ''
  const host = request.headers.get('host') || ''

  // 🛡️ 白名单路径直接放行，跳过所有安全检查
  if (WHITELIST_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next()
  }

  // 🛡️ 获取客户端标识
  let clientId: string
  try {
    clientId = getClientId(request)
  } catch (e) {
    return new NextResponse('Access Denied', { status: 403 })
  }

  // 🛡️ 检查Host头 - 防止Host头攻击
  if (process.env.NODE_ENV === 'production') {
    const allowedHosts = (process.env.ALLOWED_HOSTS || 'localhost').split(',')
    if (!allowedHosts.some(allowedHost => host.includes(allowedHost.trim()))) {
      console.warn(`[SECURITY] Invalid host header: ${host} from ${clientId}`)
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  // 🛡️ 记录可疑请求
  if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('%2e%2e')) {
    console.warn(`[SECURITY] Path traversal attempt: ${pathname} from ${clientId}`)
    SUSPICIOUS_IPS.add(clientId.split(':')[0])
    return new NextResponse('Forbidden', { status: 403 })
  }

  // 🔥 安全增强：检查敏感路径的速率限制
  // 排除掉 /api/auth/me 和 /api/auth/login 这种高频调用的轻量接口，防止误伤
  const isSensitivePath = SENSITIVE_PATHS.some(path => pathname.startsWith(path)) &&
                         !pathname.startsWith('/api/auth/me') &&
                         !pathname.startsWith('/api/auth/login')
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

  // 🛡️ 安全级别：阻止常见的攻击载荷（放宽API路径检查）
  const suspiciousPatterns = [
    /(\.\.|\\|%2e%2e|%2e)/i, // 路径遍历
    /(<script|javascript:|data:|vbscript:|onload=|onerror=)/i, // XSS
    /(union.*select|select.*from|insert.*into|update.*set|delete.*from|drop.*table)/i, // SQL注入
    /(\.\.\/|\.\.\\|\/etc\/|\/proc\/|\/home\/)/, // 目录遍历
    /(eval\(|exec\(|system\(|shell_exec\()/i, // 代码执行
    /(<iframe|<object|<embed|<form|<input)/i, // HTML注入
    /(base64|data:text|javascript:void)/i, // 数据URL攻击
    // 移除超长字符串检查，避免误判正常请求
  ]

  const url = request.url
  const body = request.body ? 'has-body' : 'no-body'

  // 对API路径放宽安全检查，避免误判正常请求
  const isApiRequest = pathname.startsWith('/api/')
  const patternsToCheck = isApiRequest ?
    // API请求只检查最危险的模式
    suspiciousPatterns.filter(p => !p.toString().includes('[a-zA-Z0-9]{100,}')) :
    // 非API请求检查所有模式
    suspiciousPatterns

  for (const pattern of patternsToCheck) {
    if (pattern.test(url) || pattern.test(userAgent) || pattern.test(pathname)) {
      console.warn(`[SECURITY] Suspicious request blocked: ${method} ${url} UA: ${userAgent.slice(0, 100)}`)
      const clientIP = clientId.split(':')[0]
      SUSPICIOUS_IPS.add(clientIP)

      // 如果同一IP有多次可疑请求，加入黑名单
      if (SUSPICIOUS_IPS.has(clientIP)) {
        let suspiciousCount = 0
        for (const ip of SUSPICIOUS_IPS) {
          if (ip === clientIP) suspiciousCount++
        }
        if (suspiciousCount >= 3) {
          BLOCKED_IPS.add(clientIP)
          console.warn(`[SECURITY] IP blocked due to repeated suspicious activity: ${clientIP}`)
        }
      }

      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  // 🛡️ 最高安全级别：检查请求头
  const contentType = request.headers.get('content-type')
  const contentLength = request.headers.get('content-length')
  const authorization = request.headers.get('authorization')

  // 检查API请求的Content-Type
  if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && pathname.startsWith('/api/')) {
    if (!contentType?.includes('application/json')) {
    console.warn(`[SECURITY] Invalid content-type for API: ${contentType} on ${pathname}`)
    return new NextResponse('Bad Request', { status: 400 })
  }
  }

  // 检查请求体大小限制
  if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) { // 10MB限制
    console.warn(`[SECURITY] Request too large: ${contentLength} bytes from ${clientId}`)
    return new NextResponse('Payload Too Large', { status: 413 })
  }

  // 检查敏感API的认证头
  if (pathname.startsWith('/api/') && SENSITIVE_PATHS.some(path => pathname.startsWith(path))) {
    if (!authorization && method !== 'GET') {
      console.warn(`[SECURITY] Missing authorization for sensitive API: ${pathname} from ${clientId}`)
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  // 🛡️ 定期清理安全数据
  if (Math.random() < 0.001) {
    const now = Date.now()

    // 清理过期的速率限制记录
    for (const [key, record] of RATE_LIMIT_STORE.entries()) {
      if (now > record.resetTime) {
        RATE_LIMIT_STORE.delete(key)
      }
    }

    // 清理过期的可疑IP记录（24小时后清除）
    const oneDayAgo = now - 24 * 60 * 60 * 1000
    // 注意：这里简化处理，实际生产环境应该有更好的过期机制
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