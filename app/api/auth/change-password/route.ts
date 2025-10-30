export const runtime = 'nodejs'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

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

    if (!username || !oldPassword || !newPassword) return new Response('Bad Request', { status: 400 })
    if (newPassword.length < 6) return new Response('密码至少 6 位', { status: 400 })

    // ensure table exists
    await prisma.$executeRawUnsafe(TABLE_SQL)

    const user = (await prisma.$queryRawUnsafe<any[]>(`SELECT id, username, passwordHash FROM Admin WHERE username = ? LIMIT 1`, username))[0]
    if (!user) return new Response('用户不存在', { status: 404 })

    const ok = user.passwordHash === hashPassword(oldPassword)
    if (!ok) return new Response('原密码不正确', { status: 401 })

    await prisma.$executeRawUnsafe(`UPDATE Admin SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, hashPassword(newPassword), user.id)
    return new Response(null, { status: 204 })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
