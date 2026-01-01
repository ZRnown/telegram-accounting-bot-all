export const runtime = 'nodejs'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { rateLimit, setSessionCookie, getClientIp, auditAdmin } from '@/app/api/_auth'

// 🛡️ 密码爆破防护：全局IP黑名单存储
const BRUTE_FORCE_BLOCKED_IPS = new Map<string, { blockedAt: number; reason: string }>()
const MAX_LOGIN_ATTEMPTS_PER_DAY = 3
const BRUTE_FORCE_CHECK_WINDOW = 24 * 60 * 60 * 1000 // 24小时

// 检查IP是否被永久封禁
function isIpPermanentlyBlocked(ip: string): boolean {
  const blocked = BRUTE_FORCE_BLOCKED_IPS.get(ip)
  return blocked ? true : false
}

// 检查IP当天登录失败次数
async function getFailedAttemptsToday(ip: string): Promise<number> {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const fails: any = await prisma.$queryRaw`
      SELECT COUNT(1) as c FROM AdminLoginAttempt
      WHERE ip = ${ip} AND success = 0 AND createdAt >= ${today}
    `
    return Array.isArray(fails) ? Number(fails[0]?.c || 0) : 0
  } catch {
    return 0
  }
}

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
    const ip = getClientIp(req)

    // 🛡️ 密码爆破防护：检查IP是否已被永久封禁
    if (isIpPermanentlyBlocked(ip)) {
      console.warn(`[SECURITY] Permanently blocked IP attempted login: ${ip}`)
      try { await auditAdmin('unknown', 'blocked_ip_attempt', ip, undefined) } catch {}
      return NextResponse.json({ error: 'Access permanently denied due to security policy' }, { status: 403 })
    }

    // 🛡️ 密码爆破防护：检查当天失败次数
    const failedAttemptsToday = await getFailedAttemptsToday(ip)
    if (failedAttemptsToday >= MAX_LOGIN_ATTEMPTS_PER_DAY) {
      // 永久封禁此IP
      BRUTE_FORCE_BLOCKED_IPS.set(ip, {
        blockedAt: Date.now(),
        reason: `Exceeded ${MAX_LOGIN_ATTEMPTS_PER_DAY} failed login attempts in 24 hours`
      })
      console.warn(`[SECURITY] IP permanently blocked for brute force: ${ip}`)
      try { await auditAdmin('unknown', 'ip_permanently_blocked', ip, `Failed attempts: ${failedAttemptsToday}`) } catch {}
      return NextResponse.json({ error: 'Access permanently denied due to security policy' }, { status: 403 })
    }

    // 简单IP级速率限制：每5分钟最多10次
    const rl = rateLimit(req, 'login', 10, 5 * 60 * 1000)
    if (!rl.ok) {
      return NextResponse.json({ error: `Too many attempts. Retry after ${rl.retryAfter}s` }, { status: 429 })
    }
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
    if (!username || !password) return NextResponse.json({ error: 'Bad Request' }, { status: 400 })

    // ensure table exists (use Unsafe for static DDL string)
    await prisma.$executeRawUnsafe(TABLE_SQL)

    // persisted attempts table
    const ATTEMPT_DDL = `CREATE TABLE IF NOT EXISTS AdminLoginAttempt (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      username TEXT, ip TEXT, success INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );`
    try { await prisma.$executeRawUnsafe(ATTEMPT_DDL) } catch {}


    // throttle by recent failures
    const winMin = Math.max(1, Number(process.env.ADMIN_LOGIN_FAIL_WINDOW_MIN || '15'))
    const limit = Math.max(1, Number(process.env.ADMIN_LOGIN_FAIL_LIMIT || '20'))
    const fifteenMinAgo = new Date(Date.now() - winMin * 60 * 1000)
    const recentFails: any = await prisma.$queryRaw`SELECT COUNT(1) as c FROM AdminLoginAttempt WHERE success = 0 AND (username = ${username} OR ip = ${ip}) AND createdAt >= ${fifteenMinAgo}`
    const failCount = Array.isArray(recentFails) ? Number(recentFails[0]?.c || 0) : 0
    if (failCount > limit) {
      return NextResponse.json({ error: 'Too many attempts, please try later.' }, { status: 429 })
    }


    // bootstrap default admin if none
    const rows = await prisma.$queryRaw`SELECT id, username, passwordHash FROM Admin LIMIT 1`
    if (!rows || rows.length === 0) {
      const defaultHash = hashPassword('admin123')
      // 提供显式 id，兼容历史上 Admin.id 无默认值的情况
      await prisma.$executeRaw`INSERT INTO Admin (id, username, passwordHash) VALUES (lower(hex(randomblob(16))), ${'admin'}, ${defaultHash})`
    }

    const list = await prisma.$queryRaw`SELECT id, username, passwordHash FROM Admin WHERE username = ${username} LIMIT 1` as any
    const user = Array.isArray(list) ? list[0] : null
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const ok = user.passwordHash === hashPassword(password)
    try { await prisma.$executeRaw`INSERT INTO AdminLoginAttempt (username, ip, success) VALUES (${username}, ${ip}, ${ok ? 1 : 0})` } catch {}
    try { await auditAdmin(username, ok ? 'login_success' : 'login_failure', ip, undefined) } catch {}

    if (!ok) {
      // 🛡️ 密码爆破防护：登录失败强制延迟1-2秒，防止快速爆破
      const delay = 1000 + Math.random() * 1000 // 1-2秒随机延迟
      await new Promise(resolve => setTimeout(resolve, delay))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // per-user session version
    let ver = 0
    try {
      const verRow: any = await prisma.$queryRaw`SELECT value FROM GlobalConfig WHERE key = ${'admin_session_ver:' + username} LIMIT 1`
      if (Array.isArray(verRow) && verRow[0]?.value != null) {
        const v = Number(verRow[0].value)
        if (!Number.isNaN(v)) ver = v
      }
    } catch {}

    const res = NextResponse.json({ ok: true, username })
    setSessionCookie(res, username, ver)
    return res
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
