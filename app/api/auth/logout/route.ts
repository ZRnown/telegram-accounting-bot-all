import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'adm_sess'

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({ name: COOKIE_NAME, value: '', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 })
  return res
}
