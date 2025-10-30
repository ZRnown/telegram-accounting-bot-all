import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { ProxyAgent } from 'undici'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
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
        if (!bot?.token) return new Response('机器人不存在', { status: 400 })
        const getChatUrl = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/getChat?chat_id=${encodeURIComponent(id)}`
        const resp = await fetch(getChatUrl, { method: 'GET' })
        if (!resp.ok) return new Response('机器人未加入该群，无法绑定', { status: 400 })
        const json = await resp.json().catch(() => null)
        if (!json?.ok) return new Response('机器人未加入该群，无法绑定', { status: 400 })
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
    if (Object.keys(data).length === 0) return new Response('Bad Request', { status: 400 })

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
    return Response.json(updated)
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
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
    if (!chat) return new Response('Not Found', { status: 404 })
    return Response.json(chat)
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    // Ensure chat exists
    const exists = await prisma.chat.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return new Response('Not Found', { status: 404 })

    // Delete related data first to satisfy FKs
    try { await prisma.billItem.deleteMany({ where: { bill: { chatId: id } } }) } catch {}
    try { await prisma.bill.deleteMany({ where: { chatId: id } }) } catch {}
    try { await prisma.operator.deleteMany({ where: { chatId: id } }) } catch {}
    try { await prisma.setting.deleteMany({ where: { chatId: id } }) } catch {}

    // Finally delete chat
    await prisma.chat.delete({ where: { id } })
    return new Response(null, { status: 204 })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
