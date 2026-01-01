import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { ProxyAgent } from 'undici'
import { assertAdmin } from '@/app/api/_auth'

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth

    const { id } = await context.params
    const body = await req.json().catch(() => ({})) as { 
      message?: string
      chatIds?: string[] // 🔥 新增：指定要发送的群组ID列表
      groupIds?: string[] // 🔥 新增：指定要发送的分组ID列表
    }
    const message = (body.message || '').trim()
    if (!message) return Response.json({ error: '缺少 message' }, { status: 400 })

    const bot = await prisma.bot.findUnique({
      where: { id },
      select: { token: true, enabled: true },
    })
    if (!bot || !bot.token) return Response.json({ error: '未找到机器人' }, { status: 404 })
    if (!bot.enabled) return Response.json({ error: '机器人未启用，无法群发' }, { status: 400 })

    // 🔥 构建查询条件
    const where: any = {
      botId: id,
      status: 'APPROVED'
    }

    // 🔥 如果指定了 chatIds，只发送到这些群组
    if (body.chatIds && body.chatIds.length > 0) {
      where.id = { in: body.chatIds }
    }
    // 🔥 如果指定了 groupIds，发送到这些分组的所有群组
    else if (body.groupIds && body.groupIds.length > 0) {
      where.groupId = { in: body.groupIds }
    }

    // 只获取群组（ID为负数），排除私聊用户（ID为正数）
    const chats = await prisma.chat.findMany({
      where,
      select: { id: true },
    })
    
    // 过滤出群组（ID 以 - 开头，即负数）
    const groupChats = chats.filter((chat: any) => chat.id.startsWith('-'))
    
    if (!groupChats.length) return Response.json({ error: '暂无已允许使用的群组' }, { status: 400 })

    const url = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/sendMessage`
    const proxyUrl = (process.env.PROXY_URL || '').trim()
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

    let sent = 0
    // 先过滤掉机器人不在群内的 chat（避免报错）
    const checkUrlBase = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/getChatMember`
    const validChats: { id: string }[] = []
    for (const chat of groupChats) {
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
      } catch {}
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
        if (resp.ok) {
          sent += 1
        }
      } catch (e) {
        console.error('broadcast sendMessage failed', e)
      }
    }

    return Response.json({ ok: true, sent, total: groupChats.length })
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
