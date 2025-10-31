import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    // 🔥 内存优化：减少查询字段，移除 featureFlags（已废弃，改用 chatFeatureFlags）
    // 减少 chats 字段查询深度
    const bots = await prisma.bot.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { chats: true }
        },
      },
    })
    return Response.json({ items: bots })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      name?: string
      description?: string
      token?: string
      enabled?: boolean
    }

    if (!body.name || !body.token) {
      return new Response('Missing name or token', { status: 400 })
    }

    const bot = await prisma.bot.create({
      data: {
        name: body.name,
        description: body.description,
        token: body.token,
        enabled: body.enabled ?? true,
      },
      select: {
        id: true,
        name: true,
        description: true,
        enabled: true,
      },
    })
    return Response.json(bot, { status: 201 })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
