import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/db'

const COOKIE_NAME = 'adm_sess'
const MAX_AGE = 60 * 60 * 8 // 8h

function getSecret() {
  const base = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PWD_SALT || 'session_secret_fallback'
  const rotate = process.env.ADMIN_SESSION_ROTATE || ''
  return `${base}:${rotate}`
}

function sign(data: string) {
  return crypto.createHmac('sha256', getSecret()).update(data).digest('hex')
}

export function createSession(username: string, ver: number = 0) {
  const payload = JSON.stringify({ u: username, ver, iat: Date.now(), exp: Date.now() + MAX_AGE * 1000 })
  const b64 = Buffer.from(payload).toString('base64url')
  const sig = sign(b64)
  return `${b64}.${sig}`
}

export function verifySession(raw: string | null) {
  if (!raw) return null
  const [b64, sig] = raw.split('.')
  if (!b64 || !sig) return null
  if (sign(b64) !== sig) return null
  try {
    const json = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
    if (!json || !json.exp || Date.now() > json.exp) return null
    return json
  } catch {
    return null
  }
}

export function setSessionCookie(res: NextResponse, username: string, ver: number = 0) {
  const v = createSession(username, ver)
  res.cookies.set({
    name: COOKIE_NAME,
    value: v,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export function getSession(req: NextRequest) {
  const raw = req.cookies.get(COOKIE_NAME)?.value || null
  return verifySession(raw)
}

export function requireAdmin(req: NextRequest) {
  const s = getSession(req)
  if (!s) return false
  return !!s.u
}

export function assertAdmin(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin')
    const host = req.headers.get('host')
    if (origin && host) {
      try {
        const u = new URL(origin)
        if (u.host !== host) {
          return NextResponse.json({ error: 'Bad Origin' }, { status: 403 })
        }
      } catch {}
    }
  }
  return null
}

export async function rotateAllSessionsSecret() {
  const salt = crypto.randomBytes(16).toString('hex')
  process.env.ADMIN_SESSION_ROTATE = salt
  try {
    await prisma.globalConfig.upsert({
      where: { key: 'admin_session_rotate' },
      create: { key: 'admin_session_rotate', value: salt, description: 'Session rotation salt' },
      update: { value: salt, updatedAt: new Date(), updatedBy: 'system' }
    })
  } catch {}
}

// ===== Per-user session versioning (invalidate other sessions) =====
const VER_CACHE = new Map<string, { v: number; exp: number }>()
async function getUserSessionVersion(username: string): Promise<number> {
  const now = Date.now()
  const hit = VER_CACHE.get(username)
  if (hit && hit.exp > now) return hit.v
  try {
    const row = await prisma.globalConfig.findUnique({ where: { key: `admin_session_ver:${username}` } })
    const v = row?.value ? Number(row.value) || 0 : 0
    VER_CACHE.set(username, { v, exp: now + 5 * 60 * 1000 })
    return v
  } catch {
    return 0
  }
}

export async function bumpUserSessionVersion(username: string) {
  try {
    const cur = await getUserSessionVersion(username)
    const next = cur + 1
    await prisma.globalConfig.upsert({
      where: { key: `admin_session_ver:${username}` },
      create: { key: `admin_session_ver:${username}`, value: String(next), description: 'Per-user session version', updatedBy: username },
      update: { value: String(next), updatedAt: new Date(), updatedBy: username },
    })
    VER_CACHE.set(username, { v: next, exp: Date.now() + 5 * 60 * 1000 })
  } catch {}
}

export async function assertAdminAsync(req: NextRequest) {
  const sess = getSession(req)
  if (!sess || !sess.u) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Version check
  const curVer = await getUserSessionVersion(String(sess.u))
  if (Number(sess.ver || 0) !== curVer) {
    return NextResponse.json({ error: 'Session expired' }, { status: 401 })
  }
  // 简单的 same-origin/Origin 校验（仅对修改类请求）
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin')
    const host = req.headers.get('host')
    if (origin && host) {
      try {
        const u = new URL(origin)
        if (u.host !== host) {
          return NextResponse.json({ error: 'Bad Origin' }, { status: 403 })
        }
      } catch {}
    }
  }
  return null
}

export async function auditAdmin(username: string, action: string, ip: string, target?: string) {
  const DDL = `CREATE TABLE IF NOT EXISTS AdminAuditLog (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    username TEXT, action TEXT, target TEXT, ip TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  );`
  try { await prisma.$executeRawUnsafe(DDL) } catch {}
  try {
    await prisma.$executeRaw`INSERT INTO AdminAuditLog (username, action, target, ip) VALUES (${username}, ${action}, ${target || null}, ${ip || ''})`
  } catch {}
}

// ===== Simple in-memory rate limiter (per-process) =====
type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

export function getClientIp(req: NextRequest) {
  const xf = req.headers.get('x-forwarded-for')
  if (xf) return xf.split(',')[0].trim()
  const xr = req.headers.get('x-real-ip')
  if (xr) return xr.trim()
  try {
    const remote = (req as any)?.ip || ''
    if (remote) return String(remote)
  } catch {}
  return ''
}

export function rateLimit(req: NextRequest, key: string, limit: number, windowMs: number) {
  const ip = getClientIp(req)
  const k = `${key}:${ip}`
  const now = Date.now()
  const b = buckets.get(k)
  if (!b || now > b.resetAt) {
    buckets.set(k, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }
  if (b.count >= limit) return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) }
  b.count++
  return { ok: true }
}
