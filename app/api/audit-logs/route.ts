import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin, rateLimit } from '@/app/api/_auth'

export async function GET(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'audit_logs_get', 60, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, Number(searchParams.get('page') || '1'))
    const size = Math.min(100, Math.max(1, Number(searchParams.get('size') || '20')))
    const username = (searchParams.get('username') || '').trim()
    const ip = (searchParams.get('ip') || '').trim()
    const action = (searchParams.get('action') || '').trim()
    const from = searchParams.get('from') ? new Date(searchParams.get('from') as string) : null
    const to = searchParams.get('to') ? new Date(searchParams.get('to') as string) : null

    // ensure table exists (DDL)
    const DDL = `CREATE TABLE IF NOT EXISTS AdminAuditLog (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      username TEXT, action TEXT, target TEXT, ip TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );`
    try { await prisma.$executeRawUnsafe(DDL) } catch {}

    const where: any = {}
    if (username) where.username = username
    if (action) where.action = action
    if (ip) where.ip = ip
    if (from || to) {
      where.createdAt = {}
      if (from) (where.createdAt as any).gte = from
      if (to) (where.createdAt as any).lte = to
    }

    const [total, items] = await Promise.all([
      prisma.adminAuditLog.count({ where } as any).catch(async () => {
        // fallback for when Prisma model not generated; use raw
        const clauses: string[] = []
        const params: any[] = []
        if (username) { clauses.push('username = ?'); params.push(username) }
        if (action) { clauses.push('action = ?'); params.push(action) }
        if (ip) { clauses.push('ip = ?'); params.push(ip) }
        if (from) { clauses.push('createdAt >= ?'); params.push(from) }
        if (to) { clauses.push('createdAt <= ?'); params.push(to) }
        const whereSql = clauses.length ? ('WHERE ' + clauses.join(' AND ')) : ''
        const rows: any = await prisma.$queryRawUnsafe(`SELECT COUNT(1) as c FROM AdminAuditLog ${whereSql}`, ...params)
        return Array.isArray(rows) ? Number(rows[0]?.c || 0) : 0
      }),
      prisma.adminAuditLog.findMany({
        where
      } as any).catch(async () => {
        const clauses: string[] = []
        const params: any[] = []
        if (username) { clauses.push('username = ?'); params.push(username) }
        if (action) { clauses.push('action = ?'); params.push(action) }
        if (ip) { clauses.push('ip = ?'); params.push(ip) }
        if (from) { clauses.push('createdAt >= ?'); params.push(from) }
        if (to) { clauses.push('createdAt <= ?'); params.push(to) }
        const whereSql = clauses.length ? ('WHERE ' + clauses.join(' AND ')) : ''
        params.push(size)
        params.push((page - 1) * size)
        const rows: any = await prisma.$queryRawUnsafe(
          `SELECT id, username, action, target, ip, createdAt FROM AdminAuditLog ${whereSql} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
          ...params
        )
        return rows
      })
    ])

    return NextResponse.json({ page, size, total, items })
  } catch (e) {
    console.error('[audit-logs][GET]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
