import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ProxyAgent } from 'undici'
import { assertAdmin, rateLimit, auditAdmin, getClientIp, getSession } from '@/app/api/_auth'

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

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    // auth & rate limit
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'broadcast', 5, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })

    const { id } = await context.params
    const body = await req.json().catch(() => ({})) as { message?: string; chatIds?: string[]; groupIds?: string[] }
    const message = (body.message || '').trim()
    if (!message) return Response.json({ error: '缺少 message' }, { status: 400 })

    const bot = await prisma.bot.findUnique({
      where: { id },
      select: { token: true, enabled: true },
    })
    if (!bot || !bot.token) return Response.json({ error: '未找到机器人' }, { status: 404 })
    if (!bot.enabled) return Response.json({ error: '机器人未启用，无法群发' }, { status: 400 })

    // 获取该 bot 已绑定且已批准的群聊
    const chats = await prisma.chat.findMany({
      where: { botId: id, status: 'APPROVED' },
      select: { id: true },
    })
    const allGroupChats = chats.filter((chat: any) => chat.id.startsWith('-'))
    if (!allGroupChats.length) return Response.json({ error: '暂无已允许使用的群组' }, { status: 400 })

    // 展开 groupIds -> chatIds，并与手动 chatIds 合并去重
    let selectedIds = new Set<string>()
    if (Array.isArray(body.groupIds) && body.groupIds.length > 0) {
      await ensureDDL()
      const gids = body.groupIds.map(String)
      const rows = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT gc.chatId AS id FROM BroadcastGroupChat gc JOIN BroadcastGroup g ON g.id = gc.groupId WHERE g.botId = ? AND g.id IN (${gids.map(() => '?').join(',')})`,
        id, ...gids
      ).catch(() => []) as any[]
      for (const r of rows as any[]) {
        const cid = String((r as any).id || '')
        if (cid) selectedIds.add(cid)
      }
    }

    // 合并显式 chatIds
    if (Array.isArray(body.chatIds)) {
      for (const raw of body.chatIds) {
        if (typeof raw === 'string') {
          const v = raw.trim()
          if (v) selectedIds.add(v)
        }
      }
    }

    // 如果既未传 groupIds 又未传 chatIds，则默认全量
    if (selectedIds.size === 0 && !Array.isArray(body.chatIds) && !Array.isArray(body.groupIds)) {
      for (const c of allGroupChats) selectedIds.add(c.id)
    }

    // 如最后仍为空，报错
    if (selectedIds.size === 0) return Response.json({ error: 'chatIds 为空' }, { status: 400 })

    // 校验：必须属于该 bot 已批准群，且是群聊（-开头）
    const allowed = new Set(allGroupChats.map((c: any) => c.id))
    const invalid: string[] = []
    const selectedGroupChats: { id: string }[] = []
    for (const cid of selectedIds) {
      if (!cid.startsWith('-') || !allowed.has(cid)) invalid.push(cid)
      else selectedGroupChats.push({ id: cid })
    }
    if (invalid.length > 0) return Response.json({ error: '包含无效的 chatIds', invalid }, { status: 400 })
    
    // selectedGroupChats 已就绪

    const url = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/sendMessage`
    const proxyUrl = (process.env.PROXY_URL || '').trim()
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

    let sent = 0
    const failedIds: string[] = []
    // 先过滤掉机器人不在群内的 chat（避免报错）
    const checkUrlBase = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/getChatMember`
    const validChats: { id: string }[] = []
    for (const chat of selectedGroupChats) {
      try {
        const checkUrl = `${checkUrlBase}?chat_id=${encodeURIComponent(chat.id)}&user_id=${encodeURIComponent(''+0)}`
        // 上面只是占位，实际应查询机器人自身是否在群内：Telegram 不允许 getChatMember 查询自己，
        // 因此改用 getChatAdministrators/或尝试发送前先 getChat（若被踢会报错）。这里采用 getChat 方式。
        const getChatUrl = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/getChat?chat_id=${encodeURIComponent(chat.id)}`
        const resp = await fetch(getChatUrl, { method: 'GET', ...(dispatcher ? { dispatcher } : {}) } as any)
        if (!resp.ok) throw new Error('getChat failed')
        const j = await resp.json().catch(() => null)
        if (j && j.ok) {
          validChats.push(chat)
        }
      } catch {
        failedIds.push(chat.id)
      }
    }

    for (const chat of validChats) {
      try {
        const payload = { chat_id: chat.id, text: message }
        const init: any = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          ...(dispatcher ? { dispatcher } : {}),
        }
        const resp = await fetch(url, init)
        if (resp.ok) sent += 1
        else failedIds.push(chat.id)
      } catch (e) {
        // 保留最小错误信息，避免大量日志
        failedIds.push(chat.id)
      }
    }

    const tried = validChats.length
    const total = selectedGroupChats.length

    // 审计日志
    try {
      const sess = getSession(req)
      const username = String(sess?.u || '')
      const ip = getClientIp(req)
      const groupMeta = Array.isArray(body.groupIds) ? ` groups:${body.groupIds.length}` : ''
      await auditAdmin(username || 'admin', 'broadcast', ip, `bot:${id}; total:${total}; tried:${tried}; sent:${sent}; failed:${failedIds.length};${groupMeta}`)
    } catch {}

    return Response.json({ ok: true, sent, tried, total, failedIds })
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
