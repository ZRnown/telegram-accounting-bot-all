import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin, rateLimit, auditAdmin, getSession, getClientIp } from '@/app/api/_auth'

async function ensureDDL() {
  // SQLite DDL for broadcast groups
  const createGroups = `CREATE TABLE IF NOT EXISTS BroadcastGroup (
    id TEXT PRIMARY KEY,
    botId TEXT NOT NULL,
    name TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`
  const createGroupChat = `CREATE TABLE IF NOT EXISTS BroadcastGroupChat (
    groupId TEXT NOT NULL,
    chatId TEXT NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (groupId, chatId)
  )`
  try {
    // use Unsafe for static DDL string (SQLite)
    // @ts-ignore
    await prisma.$executeRawUnsafe(createGroups)
    // @ts-ignore
    await prisma.$executeRawUnsafe(createGroupChat)
  } catch {}
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'broadcast_groups_get', 60, 60_000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })

    const { id: botId } = await params
    await ensureDDL()

    const url = new URL(req.url)
    const withChats = url.searchParams.get('withChats') === '1'

    // fetch groups
    const groups = await prisma.$queryRawUnsafe(
      `SELECT id, botId, name, createdAt, updatedAt FROM BroadcastGroup WHERE botId = ? ORDER BY createdAt DESC`,
      botId
    ) as any[]

    if (!withChats) {
      // count chats per group
      const counts = await prisma.$queryRawUnsafe(
        `SELECT groupId, COUNT(*) as cnt FROM BroadcastGroupChat WHERE groupId IN (${groups.map(() => '?').join(',') || "''"}) GROUP BY groupId`,
        ...groups.map((g: any) => g.id)
      ).catch(() => []) as any[]
      const map: Record<string, number> = {}
      for (const r of counts as any[]) map[String(r.groupId)] = Number((r as any).cnt || 0)
      return NextResponse.json({ items: (groups as any[]).map((g: any) => ({ ...g, count: map[g.id] || 0 })) }, { headers: { 'Cache-Control': 'no-store' } })
    }

    // with chats
    const groupIds = (groups as any[]).map((g: any) => g.id)
    const rows = groupIds.length > 0 ? await prisma.$queryRawUnsafe(
      `SELECT gc.groupId, c.id, c.title FROM BroadcastGroupChat gc JOIN Chat c ON c.id = gc.chatId WHERE gc.groupId IN (${groupIds.map(() => '?').join(',')}) ORDER BY c.createdAt DESC`,
      ...groupIds
    ) as any[] : []

    const byGroup: Record<string, Array<{ id: string, title: string }>> = {}
    for (const r of rows as any[]) {
      (byGroup[r.groupId] ||= []).push({ id: String(r.id), title: String(r.title || r.id) })
    }
    const items = (groups as any[]).map((g: any) => ({ ...g, chats: byGroup[g.id] || [], count: (byGroup[g.id] || []).length }))
    return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'broadcast_groups_post', 30, 60_000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })

    const { id: botId } = await params
    const body = await req.json().catch(() => ({})) as { name?: string }
    const name = (body.name || '').trim()
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

    await ensureDDL()
    const groupId = `bg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // @ts-ignore
    await prisma.$executeRawUnsafe(`INSERT INTO BroadcastGroup (id, botId, name, createdAt, updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, groupId, botId, name)

    const sess = getSession(req)
    const ip = getClientIp(req)
    await auditAdmin(String(sess?.u || ''), 'broadcast_group_create', ip, `${botId}:${groupId}:${name}`)
    return NextResponse.json({ id: groupId, botId, name })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
