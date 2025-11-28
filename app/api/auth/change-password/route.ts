export const runtime = 'nodejs'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { assertAdmin, rateLimit, bumpUserSessionVersion, getClientIp, auditAdmin } from '@/app/api/_auth'

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS Admin (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username TEXT UNIQUE,
  passwordHash TEXT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);`

function hashPassword(pwd: string) {
  const salt = process.env.ADMIN_PWD_SALT || 'tgbot_salt_v1'
  return crypto.createHash('sha256').update(`${salt}:${pwd}`).digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'change_pwd', 5, 5 * 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many attempts. Retry after ${rl.retryAfter}s` }, { status: 429 })
    try {
      const dbUrl = process.env.DATABASE_URL || ''
      if (dbUrl.startsWith('file:')) {
        let p = dbUrl.slice(5)
        if (!p) throw new Error('Empty sqlite path')
        if (!p.startsWith('/')) p = path.resolve(process.cwd(), p)
        const dir = path.dirname(p)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        if (!fs.existsSync(p)) fs.closeSync(fs.openSync(p, 'a'))
      }
    } catch {}
    const body = await req.json().catch(() => ({})) as { username?: string; oldPassword?: string; newPassword?: string }
    const username = (body.username || '').trim()
    const oldPassword = (body.oldPassword || '').trim()
    const newPassword = (body.newPassword || '').trim()

    if (!username || !oldPassword || !newPassword) return NextResponse.json({ error: 'Bad Request' }, { status: 400 })
    if (newPassword.length < 6) return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 })

    // ensure table exists (use Unsafe for static DDL string)
    await prisma.$executeRawUnsafe(TABLE_SQL)

    const rows = await prisma.$queryRaw`SELECT id, username, passwordHash FROM Admin WHERE username = ${username} LIMIT 1` as any
    const user = Array.isArray(rows) ? rows[0] : null
    if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 })

    const ok = user.passwordHash === hashPassword(oldPassword)
    if (!ok) {
      try { await auditAdmin(username, 'change_password_failed', getClientIp(req), undefined) } catch {}
      return NextResponse.json({ error: '原密码不正确' }, { status: 401 })
    }

    await prisma.$executeRaw`UPDATE Admin SET passwordHash = ${hashPassword(newPassword)}, updatedAt = CURRENT_TIMESTAMP WHERE id = ${user.id}`
    try {
      await bumpUserSessionVersion(username)
      await auditAdmin(username, 'change_password_success', getClientIp(req), undefined)
    } catch {}
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
