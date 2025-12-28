import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: botId } = await context.params

    // 获取机器人的所有群组的非白名单提醒消息（取第一个非空的）
    const settings = await prisma.setting.findFirst({
      where: {
        chat: { botId },
        nonWhitelistWelcomeMessage: { not: null }
      },
      select: { nonWhitelistWelcomeMessage: true },
      orderBy: { createdAt: 'desc' }
    })

    return Response.json({
      botId,
      message: settings?.nonWhitelistWelcomeMessage || ''
    })
  } catch (e) {
    console.error('[GET /api/bots/[id]/non-whitelist-message]', e)
    return new Response('Server error', { status: 500 })
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: botId } = await context.params
    const body = await req.json().catch(() => ({}))

    // 验证机器人是否存在
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      select: { id: true, name: true }
    })

    if (!bot) {
      return new Response('Bot not found', { status: 404 })
    }

    const { message } = body

    // 验证消息长度
    if (message && message.length > 4000) {
      return new Response('Message too long (max 4000 characters)', { status: 400 })
    }

    // 获取机器人下的所有群组，为每个群组设置相同的非白名单提醒消息
    const chats = await prisma.chat.findMany({
      where: { botId },
      select: { id: true }
    })

    // 为每个群组更新设置
    for (const chat of chats) {
      await prisma.setting.upsert({
        where: { chatId: chat.id },
        create: {
          chatId: chat.id,
          nonWhitelistWelcomeMessage: message || null
        },
        update: {
          nonWhitelistWelcomeMessage: message || null
        }
      })
    }

    return Response.json({
      success: true,
      message: 'Non-whitelist message setting saved successfully',
      updatedChats: chats.length
    })
  } catch (e) {
    console.error('[POST /api/bots/[id]/non-whitelist-message]', e)
    return new Response('Server error', { status: 500 })
  }
}
