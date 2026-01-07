import { NextRequest, NextResponse } from 'next/server'
import { assertAdminAsync, getSession } from '@/app/api/_auth'

export async function GET(req: NextRequest) {
  const unauth = await assertAdminAsync(req)
  if (unauth) {
    // 如果是会话过期，返回特定的状态码，让前端知道需要重新登录
    if (unauth.status === 401 && unauth.statusText?.includes('Session expired')) {
      return NextResponse.json({ authenticated: false, sessionExpired: true, message: 'Session expired' }, { status: 401 })
    }
    return unauth
  }
  const s = getSession(req)
  return NextResponse.json({ authenticated: true, username: s?.u })
}
