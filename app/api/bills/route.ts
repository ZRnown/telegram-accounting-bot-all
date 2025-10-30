import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const chatId = searchParams.get('chatId') || undefined
    const page = Math.max(1, Number(searchParams.get('page') || '1'))
    const size = Math.min(100, Math.max(1, Number(searchParams.get('size') || '20')))

    const where = chatId ? { chatId } : {}
    const [total, bills] = await Promise.all([
      prisma.bill.count({ where }),
      prisma.bill.findMany({
        where,
        orderBy: { savedAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
    ])

    return Response.json({
      page,
      size,
      total,
      items: bills,
    })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
