import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin, rateLimit } from '@/app/api/_auth'
import { ProxyAgent } from 'undici'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'chat_patch', 30, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const { id } = await params
    const body = await req.json().catch(() => ({})) as {
      allowed?: boolean
      title?: string
      status?: string
      botId?: string | null
    }

    const data: any = {}
    if (typeof body.allowed === 'boolean') data.allowed = body.allowed
    if (typeof body.title === 'string') data.title = body.title
    if (typeof body.status === 'string') {
      data.status = body.status as any
      if (body.status === 'APPROVED') {
        data.allowed = true
      } else if (body.status === 'PENDING' || body.status === 'BLOCKED') {
        data.allowed = false
      }
    }
    if (body.botId !== undefined) {
      if (!body.botId) {
        data.bot = { disconnect: true }
      } else {
        // 验证该 bot 是否已加入该群
        const bot = await prisma.bot.findUnique({ 
          where: { id: body.botId }, 
          select: { token: true, featureFlags: { select: { feature: true, enabled: true } } } 
        })
        if (!bot?.token) return new NextResponse('机器人不存在', { status: 400 })
        const getChatUrl = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/getChat?chat_id=${encodeURIComponent(id)}`
        const resp = await fetch(getChatUrl, { method: 'GET' })
        if (!resp.ok) return new NextResponse('机器人未加入该群，无法绑定', { status: 400 })
        const json = await resp.json().catch(() => null)
        if (!json?.ok) return new NextResponse('机器人未加入该群，无法绑定', { status: 400 })
        data.bot = { connect: { id: body.botId } }
        
        // 自动为该群启用该机器人的所有功能
        const enabledFeatures = bot.featureFlags?.filter((f: { enabled: boolean; feature: string }) => f.enabled).map((f: { feature: string }) => f.feature) || []
        if (enabledFeatures.length > 0) {
          // 先删除该群的旧功能标志
          await prisma.chatFeatureFlag.deleteMany({ where: { chatId: id } })
          // 创建新的功能标志（继承机器人的启用功能）
          // SQLite 不支持 skipDuplicates，所以先删除再批量创建
          for (const feature of enabledFeatures) {
            await prisma.chatFeatureFlag.create({
              data: {
                chatId: id,
                feature,
                enabled: true,
              },
            }).catch(() => {}) // 忽略重复错误
          }
        }
      }
    }
    if (Object.keys(data).length === 0) return new NextResponse('Bad Request', { status: 400 })

    const updated = await prisma.chat.update({
      where: { id },
      data,
      select: {
        id: true,
        title: true,
        allowed: true,
        status: true,
        botId: true,
      },
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const { id } = await params
    const chat = await prisma.chat.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        allowed: true,
        status: true,
        createdAt: true,
        botId: true,
        bot: { select: { name: true } },
        featureFlags: { select: { feature: true, enabled: true } },
      },
    })
    if (!chat) return new NextResponse('Not Found', { status: 404 })
    return NextResponse.json(chat)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'chat_delete', 10, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const { id } = await params
    // Ensure chat exists
    const exists = await prisma.chat.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return new NextResponse('Not Found', { status: 404 })

    // 🔥 查询所有启用的机器人，检查它们是否在该群中，如果是则让它们退群
    const bots = await prisma.bot.findMany({
      where: { enabled: true },
      select: { id: true, token: true }
    })
    
    // 🔥 并发让所有在该群中的机器人退群
    const leavePromises = bots.map(async (bot: any) => {
      if (!bot.token) return
      try {
        // 先检查机器人是否在该群中
        const getChatUrl = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/getChat?chat_id=${encodeURIComponent(id)}`
        const resp = await fetch(getChatUrl, { 
          method: 'GET',
          signal: AbortSignal.timeout(2000) // 2秒超时
        })
        if (resp.ok) {
          const json = await resp.json().catch(() => null)
          if (json?.ok) {
            // 机器人确实在该群中，让它退群
            const leaveChatUrl = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/leaveChat?chat_id=${encodeURIComponent(id)}`
            await fetch(leaveChatUrl, { 
              method: 'POST',
              signal: AbortSignal.timeout(2000) // 2秒超时
            }).catch(() => {}) // 忽略错误，继续处理
            console.log('[删除群聊] 机器人已退群', { chatId: id, botId: bot.id })
          }
        }
      } catch (e) {
        // 忽略错误，继续处理下一个机器人
        console.error('[删除群聊] 检查/退群失败', { chatId: id, botId: bot.id, error: e })
      }
    })
    
    // 🔥 等待所有退群操作完成（最多等待5秒）
    try {
      await Promise.race([
        Promise.all(leavePromises),
        new Promise(resolve => setTimeout(resolve, 5000)) // 5秒超时
      ])
    } catch (e) {
      console.error('[删除群聊] 退群操作失败', e)
    }

    // Delete related data first to satisfy FKs
    try { await prisma.billItem.deleteMany({ where: { bill: { chatId: id } } }) } catch {}
    try { await prisma.bill.deleteMany({ where: { chatId: id } }) } catch {}
    try { await prisma.operator.deleteMany({ where: { chatId: id } }) } catch {}
    try { await prisma.setting.deleteMany({ where: { chatId: id } }) } catch {}

    // Finally delete chat
    await prisma.chat.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
