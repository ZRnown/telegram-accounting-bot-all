import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET: 获取邀请记录
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const size = Math.min(100, Math.max(1, parseInt(searchParams.get('size') || '20')))
    
    const skip = (page - 1) * size

    // 🔥 优化：只选择必要字段，并行查询
    const [records, total] = await Promise.all([
      prisma.inviteRecord.findMany({
        select: {
          id: true,
          chatId: true,
          chatTitle: true,
          inviterId: true,
          inviterUsername: true,
          autoAllowed: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: size
      }),
      prisma.inviteRecord.count()
    ])

    return NextResponse.json({ items: records, total, page, size })
  } catch (error) {
    console.error('[invite-records][GET]', error)
    return NextResponse.json({ error: 'Failed to fetch invite records' }, { status: 500 })
  }
}

// DELETE: 删除邀请记录
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    await prisma.inviteRecord.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[invite-records][DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete invite record' }, { status: 500 })
  }
}

