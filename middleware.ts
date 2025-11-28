import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Lightweight global security headers middleware
// Skip heavy work; only set headers. Exclude static assets via config.matcher below.

export function middleware(req: NextRequest) {
  const res = NextResponse.next()

  // Content Security Policy (adjust as needed)
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob:" ,
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ')

  res.headers.set('Content-Security-Policy', csp)
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')

  if (process.env.NODE_ENV === 'production') {
    // Enable HSTS only in production and when HTTPS is guaranteed
    res.headers.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains; preload') // 180 days
  }

  return res
}

// Exclude static files and Next internals for performance
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|uploads/).*)'
  ],
}
