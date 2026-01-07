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
    console.log('[Change Password API] Starting request...')
    const unauth = assertAdmin(req)
    if (unauth) {
      console.error('[Change Password API] Auth failed:', unauth.status)
      return unauth
    }
    console.log('[Change Password API] Auth passed')

    const rl = rateLimit(req, 'change_pwd', 5, 5 * 60 * 1000)
    if (!rl.ok) {
      console.log('[Change Password API] Rate limited:', rl.retryAfter)
      return NextResponse.json({ error: `Too many attempts. Retry after ${rl.retryAfter}s` }, { status: 429 })
    }

    try {
      const dbUrl = process.env.DATABASE_URL || ''
      console.log('[Change Password API] Database URL:', dbUrl)
      if (dbUrl.startsWith('file:')) {
        let p = dbUrl.slice(5)
        if (!p) throw new Error('Empty sqlite path')
        if (!p.startsWith('/')) p = path.resolve(process.cwd(), p)
        const dir = path.dirname(p)
        console.log('[Change Password API] Database path:', p, 'Directory:', dir)

        // 确保目录存在
        if (!fs.existsSync(dir)) {
          console.log('[Change Password API] Creating directory...')
          fs.mkdirSync(dir, { recursive: true })
        }

        // 确保文件存在
        if (!fs.existsSync(p)) {
          console.log('[Change Password API] Creating database file...')
          fs.closeSync(fs.openSync(p, 'w'))
        }

        // 多次尝试修复权限
        let permissionsFixed = false
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            fs.chmodSync(p, 0o644)
            fs.chmodSync(dir, 0o755)
            console.log(`[Change Password API] Database permissions fixed (attempt ${attempt})`)

            // 测试写入权限
            const testData = 'test_write_' + Date.now()
            fs.appendFileSync(p, testData)
            const stats = fs.statSync(p)
            fs.truncateSync(p, stats.size - testData.length)
            console.log('[Change Password API] Database write test successful')
            permissionsFixed = true
            break
          } catch (permErr) {
            console.warn(`[Change Password API] Permission fix attempt ${attempt} failed:`, permErr.message)
            if (attempt === 3) {
              console.error('[Change Password API] All permission fix attempts failed')
            }
          }
        }

        if (!permissionsFixed) {
          console.warn('[Change Password API] Continuing without permission fix - may cause database errors')
        }
      }
    } catch (dbErr) {
      console.error('[Change Password API] Database setup error:', dbErr.message)
      // 继续执行，不要因为数据库设置失败而中断密码修改
    }

    const body = await req.json().catch(() => ({})) as { username?: string; oldPassword?: string; newPassword?: string }
    const username = (body.username || '').trim()
    const oldPassword = (body.oldPassword || '').trim()
    const newPassword = (body.newPassword || '').trim()
    console.log('[Change Password API] Request body - username:', username, 'oldPassword length:', oldPassword.length, 'newPassword length:', newPassword.length)

    if (!username || !oldPassword || !newPassword) {
      console.error('[Change Password API] Bad request: missing fields')
      return NextResponse.json({ error: 'Bad Request' }, { status: 400 })
    }
    if (newPassword.length < 6) {
      console.error('[Change Password API] Password too short')
      return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 })
    }

    console.log('[Change Password API] Creating Admin table...')
    // ensure table exists (use Unsafe for static DDL string)
    await prisma.$executeRawUnsafe(TABLE_SQL)

    console.log('[Change Password API] Checking for default admin...')
    // bootstrap default admin if none (same logic as login API)
    const checkRows = await prisma.$queryRaw`SELECT id, username, passwordHash FROM Admin LIMIT 1`
    if (!checkRows || checkRows.length === 0) {
      console.log('[Change Password API] Creating default admin...')
      const defaultHash = hashPassword('admin123')
      await prisma.$executeRaw`INSERT INTO Admin (id, username, passwordHash) VALUES (lower(hex(randomblob(16))), ${'admin'}, ${defaultHash})`
      console.log('[Change Password API] Default admin created')
    }

    console.log('[Change Password API] Looking up user:', username)
    const rows = await prisma.$queryRaw`SELECT id, username, passwordHash FROM Admin WHERE username = ${username} LIMIT 1` as any
    const user = Array.isArray(rows) ? rows[0] : null
    console.log('[Change Password API] User found:', !!user)
    if (!user) {
      console.error('[Change Password API] User not found')
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    console.log('[Change Password API] Verifying old password...')
    const oldHash = hashPassword(oldPassword)
    const storedHash = user.passwordHash
    console.log('[Change Password API] Hash comparison - old input:', oldHash.substring(0, 10) + '...', 'stored:', storedHash.substring(0, 10) + '...')
    const ok = storedHash === oldHash
    if (!ok) {
      console.log('[Change Password API] Password verification failed')
      try { await auditAdmin(username, 'change_password_failed', getClientIp(req), undefined) } catch {}
      return NextResponse.json({ error: '原密码不正确' }, { status: 401 })
    }

    console.log('[Change Password API] Updating password...')
    await prisma.$executeRaw`UPDATE Admin SET passwordHash = ${hashPassword(newPassword)}, updatedAt = CURRENT_TIMESTAMP WHERE id = ${user.id}`

    console.log('[Change Password API] Bumping session version...')
    try {
      await bumpUserSessionVersion(username)
      await auditAdmin(username, 'change_password_success', getClientIp(req), undefined)
    } catch (auditErr) {
      console.warn('[Change Password API] Audit error:', auditErr.message)
    }

    console.log('[Change Password API] Success!')
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    console.error('[Change Password API] Error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
