import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

// 设置群组的分组
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const body = await req.json().catch(() => ({})) as { groupId?: string | null }
    
    const chat = await prisma.chat.findUnique({
      where: { id },
      select: { botId: true }
    })
    if (!chat) {
      return Response.json({ error: '群组不存在' }, { status: 404 })
    }

    // 如果提供了 groupId，验证分组是否存在且属于该机器人
    if (body.groupId) {
      const group = await prisma.chatGroup.findFirst({
        where: { id: body.groupId, botId: chat.botId || '' }
      })
      if (!group) {
        return Response.json({ error: '分组不存在' }, { status: 404 })
      }
    }

    await prisma.chat.update({
      where: { id },
      data: { groupId: body.groupId || null }
    })

    return Response.json({ ok: true })
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}

