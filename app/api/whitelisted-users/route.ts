import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET: 获取白名单用户列表
export async function GET(req: NextRequest) {
  try {
    const users = await prisma.whitelistedUser.findMany({
      orderBy: { createdAt: 'desc' }
    })
    
    // 🔥 为没有用户名的用户自动填充（从邀请记录中获取）
    const updatedUsers = await Promise.all(
      users.map(async (user: any) => {
        if (!user.username) {
          // 尝试从邀请记录中获取最新的用户名
          const inviteRecord = await prisma.inviteRecord.findFirst({
            where: { inviterId: user.userId },
            orderBy: { createdAt: 'desc' },
            select: { inviterUsername: true }
          })
          
          if (inviteRecord?.inviterUsername) {
            // 更新数据库中的用户名
            await prisma.whitelistedUser.update({
              where: { userId: user.userId },
              data: { username: inviteRecord.inviterUsername }
            }).catch(() => {}) // 忽略更新失败
            
            return { ...user, username: inviteRecord.inviterUsername }
          }
        }
        return user
      })
    )
    
    return NextResponse.json({ items: updatedUsers })
  } catch (error) {
    console.error('[whitelisted-users][GET]', error)
    return NextResponse.json({ error: 'Failed to fetch whitelisted users' }, { status: 500 })
  }
}

// POST: 添加白名单用户
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    let { userId, username, note } = body

    if (!userId || !userId.trim()) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    // 检查是否已存在
    const existing = await prisma.whitelistedUser.findUnique({
      where: { userId: userId.trim() }
    })

    if (existing) {
      return NextResponse.json({ error: '该用户ID已在白名单中' }, { status: 409 })
    }

    // 🔥 自动从邀请记录中获取用户名（如果没有提供）
    if (!username || !username.trim()) {
      const inviteRecord = await prisma.inviteRecord.findFirst({
        where: { inviterId: userId.trim() },
        orderBy: { createdAt: 'desc' },
        select: { inviterUsername: true }
      })
      if (inviteRecord?.inviterUsername) {
        username = inviteRecord.inviterUsername
      }
    }

    const user = await prisma.whitelistedUser.create({
      data: {
        userId: userId.trim(),
        username: username?.trim() || null,
        note: note?.trim() || null
      }
    })

    return NextResponse.json(user)
  } catch (error: any) {
    console.error('[whitelisted-users][POST]', error)
    if (error.code === 'P2002') {
      return NextResponse.json({ error: '该用户ID已在白名单中' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to add whitelisted user' }, { status: 500 })
  }
}

// DELETE: 删除白名单用户
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    await prisma.whitelistedUser.delete({
      where: { userId }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[whitelisted-users][DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete whitelisted user' }, { status: 500 })
  }
}

