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
      select: { nonWhitelistWelcomeMessage: true }
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

    // 🔥 并发优化：使用Promise.all并行更新所有群组，避免顺序执行导致的超时
    const updatePromises = chats.map(chat =>
      prisma.setting.upsert({
        where: { chatId: chat.id },
        create: {
          chatId: chat.id,
          nonWhitelistWelcomeMessage: message || null
        },
        update: {
          nonWhitelistWelcomeMessage: message || null
        }
      }).catch(error => {
        console.error(`[non-whitelist-message] 更新群组 ${chat.id} 失败:`, error.message)
        // 继续处理其他群组，不因单个失败而中断
        return null
      })
    )

    // 等待所有更新完成
    await Promise.all(updatePromises)

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
