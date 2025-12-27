import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ProxyAgent } from 'undici'
import { ensureDefaultFeatures } from '@/bot/constants'
import { assertAdmin, rateLimit } from '@/app/api/_auth'

export async function POST(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'chat_manual_add', 10, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const body = await req.json().catch(() => ({})) as { chatId?: string; botId?: string }
    const chatId = (body.chatId || '').trim()
    const botId = (body.botId || '').trim()
    if (!chatId || !botId) return new NextResponse('缺少 chatId 或 botId', { status: 400 })

    const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { token: true, id: true, proxyUrl: true } })
    if (!bot?.token) return new NextResponse('机器人不存在', { status: 400 })

    // 支持代理配置（优先使用bot的proxyUrl，其次使用全局PROXY_URL）
    const proxyUrl = (bot.proxyUrl || process.env.PROXY_URL || '').trim()
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined

    const url = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/getChat?chat_id=${encodeURIComponent(chatId)}`
    const resp = await fetch(url, { 
      method: 'GET',
      // @ts-ignore - undici dispatcher is compatible
      dispatcher 
    })
    
    if (!resp.ok) {
      const errorText = await resp.text().catch(() => '')
      console.error('getChat 调用失败:', { chatId, status: resp.status, error: errorText })
      return new NextResponse(`getChat 调用失败 (HTTP ${resp.status}): ${errorText || '请检查chatId格式（群组ID通常是负数，如-121321）和Bot是否在群内'}`, { status: 400 })
    }
    
    const j = await resp.json().catch(() => null)
    if (!j?.ok) {
      console.error('getChat 返回错误:', j)
      return new NextResponse(`机器人不在该群或 chatId 无效: ${j?.description || '未知错误'}`, { status: 400 })
    }

    // upsert chat and bind to bot
    const title = (j.result?.title || '') as string
    const chat = await prisma.chat.upsert({
      where: { id: chatId },
      update: { title, bot: { connect: { id: botId } } },
      create: { 
        id: chatId, 
        title, 
        status: 'PENDING', 
        allowed: false, 
        bot: { connect: { id: botId } },
        invitedBy: null, // 🔥 手动添加标记为空
        invitedByUsername: '手动' // 🔥 手动添加标记为"手动"
      },
      select: { id: true, title: true, status: true, botId: true },
    })

    // 🔥 为手动添加的群组自动开启所有功能开关
    await ensureDefaultFeatures(chatId, prisma)

    return NextResponse.json(chat)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
