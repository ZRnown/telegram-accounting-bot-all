import { NextRequest, NextResponse } from 'next/server'
import { assertAdminAsync, getSession } from '@/app/api/_auth'

export async function GET(req: NextRequest) {
  const unauth = await assertAdminAsync(req)
  if (unauth) return unauth
  const s = getSession(req)
  return NextResponse.json({ authenticated: true, username: s?.u })
}
