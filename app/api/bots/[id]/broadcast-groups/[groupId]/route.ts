import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin, rateLimit, auditAdmin, getSession, getClientIp } from '@/app/api/_auth'

async function ensureDDL() {
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
    // @ts-ignore
    await prisma.$executeRawUnsafe(createGroups)
    // @ts-ignore
    await prisma.$executeRawUnsafe(createGroupChat)
  } catch {}
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string, groupId: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'broadcast_groups_patch', 60, 60_000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })

    const { id: botId, groupId } = await params
    await ensureDDL()

    const body = await req.json().catch(() => ({})) as { name?: string, addChatIds?: string[], removeChatIds?: string[] }

    // 校验分组归属
    const g = await prisma.$queryRawUnsafe(`SELECT id, botId, name FROM BroadcastGroup WHERE id = ?`, groupId) as any[]
    if (!g || g.length === 0 || String(g[0].botId) !== String(botId)) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 })
    }

    if (typeof body.name === 'string' && body.name.trim()) {
      // @ts-ignore
      await prisma.$executeRawUnsafe(`UPDATE BroadcastGroup SET name = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, body.name.trim(), groupId)
    }

    // 处理 add/remove
    const add = Array.isArray(body.addChatIds) ? body.addChatIds.map(String) : []
    const remove = Array.isArray(body.removeChatIds) ? body.removeChatIds.map(String) : []

    let invalidAdd: string[] = []
    if (add.length > 0) {
      // 校验 chatIds 属于该 bot，且为群聊
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id FROM Chat WHERE id IN (${add.map(() => '?').join(',')}) AND botId = ? AND substr(id,1,1)='-'`,
        ...add, botId
      ) as any[]
      const okSet = new Set(rows.map(r => String(r.id)))
      invalidAdd = add.filter(x => !okSet.has(String(x)))
      const valids = add.filter(x => okSet.has(String(x)))
      for (const cid of valids) {
        // @ts-ignore
        await prisma.$executeRawUnsafe(`INSERT OR IGNORE INTO BroadcastGroupChat (groupId, chatId, createdAt) VALUES (?, ?, CURRENT_TIMESTAMP)`, groupId, cid)
      }
    }

    if (remove.length > 0) {
      // @ts-ignore
      await prisma.$executeRawUnsafe(
        `DELETE FROM BroadcastGroupChat WHERE groupId = ? AND chatId IN (${remove.map(() => '?').join(',')})`,
        groupId, ...remove
      )
    }

    const sess = getSession(req)
    const ip = getClientIp(req)
    await auditAdmin(String(sess?.u || ''), 'broadcast_group_update', ip, `${botId}:${groupId}`)

    return NextResponse.json({ ok: true, invalidAdd })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string, groupId: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'broadcast_groups_delete', 30, 60_000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })

    const { id: botId, groupId } = await params
    await ensureDDL()

    // 校验分组归属
    const g = await prisma.$queryRawUnsafe(`SELECT id, botId FROM BroadcastGroup WHERE id = ?`, groupId) as any[]
    if (!g || g.length === 0 || String(g[0].botId) !== String(botId)) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 })
    }

    // 先删映射，再删分组
    // @ts-ignore
    await prisma.$executeRawUnsafe(`DELETE FROM BroadcastGroupChat WHERE groupId = ?`, groupId)
    // @ts-ignore
    await prisma.$executeRawUnsafe(`DELETE FROM BroadcastGroup WHERE id = ?`, groupId)

    const sess = getSession(req)
    const ip = getClientIp(req)
    await auditAdmin(String(sess?.u || ''), 'broadcast_group_delete', ip, `${botId}:${groupId}`)

    return new NextResponse(null, { status: 204 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
