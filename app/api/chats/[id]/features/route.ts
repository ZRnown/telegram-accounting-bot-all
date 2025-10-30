import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { DEFAULT_FEATURES } from '@/bot/constants'

type FeatureInput = { feature: string; enabled: boolean }

// GET /api/chats/[id]/features - 获取群组的功能开关
export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: chatId } = await context.params
    
    // 检查群组是否存在
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true }
    })
    if (!chat) {
      return new Response('Chat not found', { status: 404 })
    }
    
    const flags = await prisma.chatFeatureFlag.findMany({
      where: { chatId },
      select: { feature: true, enabled: true },
      orderBy: { feature: 'asc' },
    })
    
    if (!flags.length) {
      // 🔥 如果没有功能开关，返回默认的全部启用状态
      const defaultItems = DEFAULT_FEATURES.map(f => ({ feature: f, enabled: false }))
      return Response.json({ items: defaultItems, isDefault: true })
    }
    return Response.json({ items: flags, isDefault: false })
  } catch (e) {
    console.error('[GET /api/chats/[id]/features]', e)
    return new Response('Server error', { status: 500 })
  }
}

// PUT /api/chats/[id]/features - 更新群组的功能开关
export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: chatId } = await context.params
    const body = await req.json().catch(() => ({})) as { features?: FeatureInput[] }
    
    if (!Array.isArray(body.features)) {
      return new Response('Invalid payload', { status: 400 })
    }

    // 检查群组是否存在
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      select: { id: true }
    })
    if (!chat) {
      return new Response('Chat not found', { status: 404 })
    }

    // 删除现有的功能开关，重新创建
    await prisma.chatFeatureFlag.deleteMany({ where: { chatId } })
    
    if (body.features.length) {
      await prisma.chatFeatureFlag.createMany({
        data: body.features.map((f) => ({
          chatId,
          feature: f.feature,
          enabled: Boolean(f.enabled),
        })),
      })
    }

    const flags = await prisma.chatFeatureFlag.findMany({
      where: { chatId },
      select: { feature: true, enabled: true },
      orderBy: { feature: 'asc' },
    })
    
    return Response.json({ items: flags })
  } catch (e) {
    console.error('[PUT /api/chats/[id]/features]', e)
    return new Response('Server error', { status: 500 })
  }
}

