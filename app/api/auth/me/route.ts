import { NextRequest, NextResponse } from 'next/server'
import { assertAdminAsync, getSession } from '@/app/api/_auth'

export async function GET(req: NextRequest) {
  console.log('[API /auth/me] Checking authentication...')
  console.log('[API /auth/me] Current time:', new Date().toISOString())
  console.log('[API /auth/me] Timezone:', process.env.TZ || 'default')

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
  return NextResponse.json({ authenticated: true, username: s?.u })
}
