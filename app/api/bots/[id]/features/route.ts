import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

type FeatureInput = { feature: string; enabled: boolean }
// 🔥 简化功能开关：只保留基础记账
const DEFAULT_FEATURES: FeatureInput[] = [
  { feature: 'accounting_basic', enabled: true },
]

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const flags = await prisma.botFeatureFlag.findMany({
      where: { botId: id },
      select: { feature: true, enabled: true },
      orderBy: { feature: 'asc' },
    })
    if (!flags.length) {
      // 返回默认功能项（不入库，等待用户点击保存后再写入）
      return Response.json({ items: DEFAULT_FEATURES })
    }
    return Response.json({ items: flags })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const body = await req.json().catch(() => ({})) as { features?: FeatureInput[] }
    if (!Array.isArray(body.features)) {
      return new Response('Invalid payload', { status: 400 })
    }

    const bot = await prisma.bot.findUnique({ where: { id }, select: { id: true } })
    if (!bot) return new Response('Not Found', { status: 404 })

    await prisma.botFeatureFlag.deleteMany({ where: { botId: id } })
    if (body.features.length) {
      await prisma.botFeatureFlag.createMany({
        data: body.features.map((f) => ({
          botId: id,
          feature: f.feature,
          enabled: Boolean(f.enabled),
        })),
      })
    }

    const flags = await prisma.botFeatureFlag.findMany({
      where: { botId: id },
      select: { feature: true, enabled: true },
      orderBy: { feature: 'asc' },
    })
    return Response.json({ items: flags })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
