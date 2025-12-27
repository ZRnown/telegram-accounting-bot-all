import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: botId } = await context.params

    // 获取机器人及其欢迎消息
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      select: { id: true, name: true, welcomeMessage: true }
    })

    if (!bot) {
      return new Response('Bot not found', { status: 404 })
    }

    return Response.json({
      bot: { id: bot.id, name: bot.name },
      message: bot.welcomeMessage || ''
    })
  } catch (e) {
    console.error('[GET /api/bots/[id]/welcome-message]', e)
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

    // 更新机器人的欢迎消息
    await prisma.bot.update({
      where: { id: botId },
      data: { welcomeMessage: message || null }
    })

    return Response.json({
      success: true,
      message: 'Welcome message setting saved successfully'
    })
  } catch (e) {
    console.error('[POST /api/bots/[id]/welcome-message]', e)
    return new Response('Server error', { status: 500 })
  }
}
