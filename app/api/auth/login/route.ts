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
    const body = await req.json().catch(() => ({})) as { username?: string; password?: string }
    const username = (body.username || '').trim()
    const password = (body.password || '').trim()
    if (!username || !password) return new Response('Bad Request', { status: 400 })

    // ensure table exists
    await prisma.$executeRawUnsafe(TABLE_SQL)

    // bootstrap default admin if none
    const rows = await prisma.$queryRawUnsafe<any[]>(`SELECT id, username, passwordHash FROM Admin LIMIT 1`)
    if (!rows || rows.length === 0) {
      const defaultHash = hashPassword('admin123')
      // 提供显式 id，兼容历史上 Admin.id 无默认值的情况
      await prisma.$executeRawUnsafe(`INSERT INTO Admin (id, username, passwordHash) VALUES (lower(hex(randomblob(16))), ?, ?)`, 'admin', defaultHash)
    }

    const user = (await prisma.$queryRawUnsafe<any[]>(`SELECT id, username, passwordHash FROM Admin WHERE username = ? LIMIT 1`, username))[0]
    if (!user) return new Response('Unauthorized', { status: 401 })

    const ok = user.passwordHash === hashPassword(password)
    if (!ok) return new Response('Unauthorized', { status: 401 })

    // simple token for current app
    return Response.json({ token: 'authenticated', username })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
