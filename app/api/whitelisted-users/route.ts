import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET: 获取白名单用户列表
export async function GET(req: NextRequest) {
  try {
    // 🔥 优化：直接返回数据，移除 N+1 查询
    const users = await prisma.whitelistedUser.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        username: true,
        note: true,
        createdAt: true,
        updatedAt: true
      }
    })
    
    return NextResponse.json({ items: users })
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

    userId = userId.trim()

    // 检查是否已存在
    const existing = await prisma.whitelistedUser.findUnique({
      where: { userId }
    })

    if (existing) {
      return NextResponse.json({ error: '该用户ID已在白名单中' }, { status: 409 })
    }

    // 🔥 优化：按优先级获取用户名
    if (!username || !username.trim()) {
      // 1. 尝试从邀请记录获取
      const inviteRecord = await prisma.inviteRecord.findFirst({
        where: { inviterId: userId },
        orderBy: { createdAt: 'desc' },
        select: { inviterUsername: true }
      })
      
      if (inviteRecord?.inviterUsername) {
        username = inviteRecord.inviterUsername
      } else {
        // 2. 尝试通过 Telegram Bot API 获取
        try {
          const bot = await prisma.bot.findFirst({
            where: { enabled: true },
            select: { token: true }
          })

          if (bot?.token) {
            const response = await fetch(
              `https://api.telegram.org/bot${bot.token}/getChat?chat_id=${userId}`,
              { signal: AbortSignal.timeout(5000) }
            )
            const data = await response.json()

            if (data.ok && data.result) {
              const user = data.result
              username = user.username ? `@${user.username}` : 
                        (user.first_name || user.last_name) ? 
                        `${user.first_name || ''} ${user.last_name || ''}`.trim() :
                        null
              
              console.log('[whitelisted-users][telegram-api-success]', { userId, username })
            }
          }
        } catch (e) {
          console.log('[whitelisted-users][telegram-api-failed]', userId, (e as Error).message)
        }
      }
    }

    const user = await prisma.whitelistedUser.create({
      data: {
        userId,
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

