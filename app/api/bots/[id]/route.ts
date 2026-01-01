import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin } from '@/app/api/_auth'

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth

    const { id } = await context.params
    const bot = await prisma.bot.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        featureFlags: { select: { feature: true, enabled: true } },
        chats: {
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
    if (!bot) return new Response('Not Found', { status: 404 })
    return Response.json(bot)
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth

    const { id } = await context.params
    const body = await req.json().catch(() => ({})) as {
      name?: string
      description?: string | null
      enabled?: boolean
      token?: string | null
    }

    const data: any = {}
    if (typeof body.name === 'string') data.name = body.name
    if (body.description !== undefined) data.description = body.description
    if (typeof body.enabled === 'boolean') data.enabled = body.enabled
    if (body.token !== undefined && body.token !== null) {
      data.token = body.token
      // 重新生成token哈希
      const { hashToken } = await import('@/lib/token-security')
      data.tokenHash = await hashToken(body.token)
    }

    if (Object.keys(data).length === 0) return new Response('Bad Request', { status: 400 })

    const bot = await prisma.bot.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        description: true,
        enabled: true,
        updatedAt: true,
      },
    })
    return Response.json(bot)
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth

    const { id } = await context.params
    await prisma.bot.delete({ where: { id } })
    return new Response(null, { status: 204 })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
