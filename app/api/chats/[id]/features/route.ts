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
    
    // 🔥 简化功能开关：只返回基础记账功能，过滤掉其他不需要的功能
    const validFeatures = new Set(DEFAULT_FEATURES)
    const filteredFlags = flags.filter(f => validFeatures.has(f.feature))
    
    if (!filteredFlags.length) {
      // 🔥 如果没有功能开关，返回默认的基础记账功能（默认启用）
      const defaultItems = DEFAULT_FEATURES.map(f => ({ feature: f, enabled: true }))
      return Response.json({ items: defaultItems, isDefault: true })
    }
    
    // 🔥 只返回基础记账功能
    return Response.json({ items: filteredFlags, isDefault: false })
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

    // 🔥 只保存基础记账功能，删除其他不需要的功能开关
    const validFeatures = new Set(DEFAULT_FEATURES)
    const validFeaturesToSave = body.features.filter(f => validFeatures.has(f.feature))
    
    // 删除所有现有的功能开关（包括不需要的）
    await prisma.chatFeatureFlag.deleteMany({ where: { chatId } })
    
    // 只创建基础记账功能开关
    if (validFeaturesToSave.length) {
      await prisma.chatFeatureFlag.createMany({
        data: validFeaturesToSave.map((f) => ({
          chatId,
          feature: f.feature,
          enabled: Boolean(f.enabled),
        })),
      })
    }

    // 返回只包含基础记账功能的结果
    const flags = await prisma.chatFeatureFlag.findMany({
      where: { chatId },
      select: { feature: true, enabled: true },
      orderBy: { feature: 'asc' },
    })
    
    // 再次过滤，确保只返回有效的功能
    const filteredFlags = flags.filter(f => validFeatures.has(f.feature))
    return Response.json({ items: filteredFlags })
  } catch (e) {
    console.error('[PUT /api/chats/[id]/features]', e)
    return new Response('Server error', { status: 500 })
  }
}

