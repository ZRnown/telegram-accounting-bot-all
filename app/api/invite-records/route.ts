import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET: 获取邀请记录
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const size = parseInt(searchParams.get('size') || '20')
    
    const skip = (page - 1) * size

    const [records, total] = await Promise.all([
      prisma.inviteRecord.findMany({
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

