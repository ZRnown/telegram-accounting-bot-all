import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

// 更新分组
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string; groupId: string }> }) {
  try {
    const { id, groupId } = await context.params
    const body = await req.json().catch(() => ({})) as { name?: string; description?: string }
    
    // 验证分组是否存在且属于该机器人
    const existing = await prisma.chatGroup.findFirst({
      where: { id: groupId, botId: id }
    })
    if (!existing) {
      return Response.json({ error: '分组不存在' }, { status: 404 })
    }

    // 如果更新名称，检查是否与其他分组重名
    if (body.name && body.name.trim() !== existing.name) {
      const name = body.name.trim()
      const duplicate = await prisma.chatGroup.findUnique({
        where: { botId_name: { botId: id, name } }
      })
      if (duplicate) {
        return Response.json({ error: '分组名称已存在' }, { status: 400 })
      }
    }

    const group = await prisma.chatGroup.update({
      where: { id: groupId },
      data: {
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description?.trim() || null } : {})
      },
      include: {
        _count: {
          select: { chats: true }
        }
      }
    })

    return Response.json({
      id: group.id,
      name: group.name,
      description: group.description,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      chatCount: group._count.chats
    })
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}

// 删除分组
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string; groupId: string }> }) {
  try {
    const { id, groupId } = await context.params
    
    // 验证分组是否存在且属于该机器人
    const existing = await prisma.chatGroup.findFirst({
      where: { id: groupId, botId: id }
    })
    if (!existing) {
      return Response.json({ error: '分组不存在' }, { status: 404 })
    }

    // 删除分组（会自动将关联的群组 groupId 设为 null）
    await prisma.chatGroup.delete({
      where: { id: groupId }
    })

    return Response.json({ ok: true })
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}

