import { NextRequest, NextResponse } from 'next/server'
import { assertAdminAsync, getSession } from '@/app/api/_auth'

export async function GET(req: NextRequest) {
  console.log('[API /auth/me] Checking authentication...')
  console.log('[API /auth/me] Current time:', new Date().toISOString())
  console.log('[API /auth/me] Timezone:', process.env.TZ || 'default')
  console.log('[API /auth/me] User-Agent:', req.headers.get('user-agent'))
  console.log('[API /auth/me] Referer:', req.headers.get('referer'))

  // 检查Cookie
  const cookies = req.cookies.getAll()
  const sessionCookie = cookies.find(c => c.name === 'adm_sess')
  console.log('[API /auth/me] Session cookie present:', !!sessionCookie)
  if (sessionCookie) {
    console.log('[API /auth/me] Cookie value length:', sessionCookie.value.length)
    console.log('[API /auth/me] Cookie value preview:', sessionCookie.value.substring(0, 50) + '...')
  }

  const unauth = await assertAdminAsync(req)
  if (unauth) {
    console.log('[API /auth/me] Authentication failed, status:', unauth.status)
    // 如果是会话过期，返回特定的状态码，让前端知道需要重新登录
    if (unauth.status === 401 && unauth.statusText?.includes('Session expired')) {
      console.log('[API /auth/me] Session expired detected')
      return NextResponse.json({ authenticated: false, sessionExpired: true, message: 'Session expired' }, { status: 401 })
    }
    console.log('[API /auth/me] Other auth failure:', unauth.statusText)
    return unauth
  }

  const s = getSession(req)
  console.log('[API /auth/me] Authentication successful for user:', s?.u)
  console.log('[API /auth/me] Session data:', { username: s?.u, ver: s?.ver, exp: s?.exp ? new Date(s.exp).toISOString() : 'no exp' })
  return NextResponse.json({ authenticated: true, username: s?.u })
}
