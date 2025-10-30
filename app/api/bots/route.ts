import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET() {
  try {
    const bots = await prisma.bot.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        chats: { select: { id: true, status: true } },
        featureFlags: { select: { feature: true, enabled: true } },
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
