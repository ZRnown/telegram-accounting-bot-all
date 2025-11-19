import { NextRequest, NextResponse } from 'next/server'
import { getSession, bumpUserSessionVersion, getClientIp, auditAdmin } from '@/app/api/_auth'

const COOKIE_NAME = 'adm_sess'

export async function POST(req: NextRequest) {
  const s = getSession(req)
  if (!s?.u) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await bumpUserSessionVersion(String(s.u))
    await auditAdmin(String(s.u), 'logout_all', getClientIp(req), undefined)
  } catch {}
  const res = NextResponse.json({ ok: true })
  res.cookies.set({ name: COOKIE_NAME, value: '', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 })
  return res
}
