import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin } from '@/app/api/_auth'

// 获取所有分组
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req) // 🔥 添加安全检查
    if (unauth) return unauth

    const { id } = await context.params
    const groups: any[] = await prisma.chatGroup.findMany({
      where: { botId: id },
      include: {
        _count: {
          select: { chats: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    })
    return Response.json(groups.map((g: any) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      chatCount: g._count.chats
    })))
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}

// 创建分组
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req) // 🔥 添加安全检查
    if (unauth) return unauth

    const { id } = await context.params
    const body = await req.json().catch(() => ({})) as { name?: string; description?: string }
    const name = (body.name || '').trim()
    if (!name) return Response.json({ error: '缺少 name' }, { status: 400 })

    // 检查是否已存在同名分组
    const existing = await prisma.chatGroup.findUnique({
      where: { botId_name: { botId: id, name } }
    })
    if (existing) {
      return Response.json({ error: '分组名称已存在' }, { status: 400 })
    }

    const group = await prisma.chatGroup.create({
      data: {
        botId: id,
        name,
        description: body.description?.trim() || null
      }
    })

    return Response.json({
      id: group.id,
      name: group.name,
      description: group.description,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      chatCount: 0
    })
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}

