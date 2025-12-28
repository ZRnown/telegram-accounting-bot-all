import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin, rateLimit } from '@/app/api/_auth'

// GET: 获取白名单用户列表
export async function GET(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    // 🔥 优化：直接返回数据，移除 N+1 查询
    const usersRaw = await prisma.whitelistedUser.findMany({
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

    // 🔥 改进：尝试通过 Telegram API 实时获取用户名，如果失败则使用存储的用户名或友好的显示名
    const users = []
    for (const u of usersRaw) {
      let displayName = u.username

      // 如果没有用户名，尝试实时获取
      if (!displayName) {
        try {
          const bot = await prisma.bot.findFirst({
            where: { enabled: true },
            select: { token: true }
          })

          if (bot?.token) {
            const response = await fetch(
              `https://api.telegram.org/bot${bot.token}/getChat?chat_id=${u.userId}`,
              { signal: AbortSignal.timeout(3000) }
            )
            const data = await response.json()

            if (data.ok && data.result) {
              const user = data.result
              displayName = user.username ? `@${user.username}` :
                          (user.first_name || user.last_name) ?
                          `${user.first_name || ''} ${user.last_name || ''}`.trim() :
                          `用户${u.userId}`

              // 顺便更新数据库中的用户名
              await prisma.whitelistedUser.update({
                where: { userId: u.userId },
                data: { username: displayName }
              }).catch(() => {})
            }
          }
        } catch (e) {
          // API调用失败，使用友好的默认名称
          displayName = `用户${u.userId}`
        }
      }

      users.push({
        ...u,
        username: displayName || `用户${u.userId}`
      })
    }
    
    return NextResponse.json({ items: users })
  } catch (error) {
    console.error('[whitelisted-users][GET]', error)
    return NextResponse.json({ error: 'Failed to fetch whitelisted users' }, { status: 500 })
  }
}

// POST: 添加白名单用户
export async function POST(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'wlu_post', 20, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
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

    // 🔥 优化：通过 Telegram Bot API 获取用户名
    if (!username || !username.trim()) {
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
                      `用户${userId}`

            console.log('[whitelisted-users][telegram-api-success]', { userId, username })
          }
        }
      } catch (e) {
        console.log('[whitelisted-users][telegram-api-failed]', userId, (e as Error).message)
      }
    }

    // 最终兜底：若仍无用户名，则使用 userId 代替，避免为 null
    const finalUsername =
      (username && username.trim()) ||
      (userId ? `user_${userId}` : null)

    const user = await prisma.whitelistedUser.create({
      data: {
        userId,
        username: finalUsername,
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
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'wlu_del', 20, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
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

