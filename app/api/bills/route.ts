import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin } from '@/app/api/_auth'

export async function GET(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const { searchParams } = new URL(req.url)
    const chatId = searchParams.get('chatId') || undefined
    const page = Math.max(1, Number(searchParams.get('page') || '1'))
    const size = Math.min(100, Math.max(1, Number(searchParams.get('size') || '20')))

    const where = chatId ? { chatId } : {}
    const [total, bills] = await Promise.all([
      prisma.bill.count({ where }),
      prisma.bill.findMany({
        where,
        // 🔥 内存优化：只选择必要的字段
        select: {
          id: true,
          chatId: true,
          status: true,
          openedAt: true,
          closedAt: true,
          savedAt: true,
        },
        orderBy: { savedAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
    ])

    return NextResponse.json({
      page,
      size,
      total,
      items: bills,
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
