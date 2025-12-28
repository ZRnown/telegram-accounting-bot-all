import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin, rateLimit } from '@/app/api/_auth'

// 刷新单个用户的显示名
async function refreshUserDisplayName(userId: string) {
  try {
    const bot = await prisma.bot.findFirst({
      where: { enabled: true },
      select: { token: true }
    })

    if (!bot?.token) return null

    const response = await fetch(
      `https://api.telegram.org/bot${bot.token}/getChat?chat_id=${userId}`,
      { signal: AbortSignal.timeout(3000) }
    )
    const data = await response.json()

    if (data.ok && data.result) {
      const user = data.result
      const displayName = user.username ? `@${user.username}` :
                        (user.first_name || user.last_name) ?
                        `${user.first_name || ''} ${user.last_name || ''}`.trim() :
                        `用户${userId}`

      // 更新数据库
      await prisma.whitelistedUser.update({
        where: { userId },
        data: { username: displayName }
      }).catch(() => {})

      return displayName
    }
  } catch (e) {
    console.log('[refreshUserDisplayName] 失败:', e.message)
  }

  return null
}

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

    // 🔥 改进：总是尝试通过 Telegram API 获取最新的用户名，优先使用API结果
    const users = []
    for (const u of usersRaw) {
      let displayName = u.username

      // 总是尝试获取最新的用户信息（即使数据库中有用户名）
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
            const apiDisplayName = user.username ? `@${user.username}` :
                                (user.first_name || user.last_name) ?
                                `${user.first_name || ''} ${user.last_name || ''}`.trim() :
                                null

            if (apiDisplayName) {
              displayName = apiDisplayName

              // 更新数据库中的用户名
              if (displayName !== u.username) {
                await prisma.whitelistedUser.update({
                  where: { userId: u.userId },
                  data: { username: displayName }
                }).catch((e) => {
                  console.log('[whitelisted-users] 更新用户名失败:', e.message)
                })
              }
            }
          }
        }
      } catch (e) {
        console.log('[whitelisted-users] 获取用户名失败:', e.message)
        // API调用失败时，如果数据库中有用户名就使用数据库的，否则使用友好的默认名称
        if (!displayName || displayName.startsWith('user_') || displayName.startsWith('用户')) {
          displayName = `用户${u.userId}`
        }
      }

      // 最后的兜底
      if (!displayName || displayName.startsWith('user_')) {
        displayName = `用户${u.userId}`
      }

      users.push({
      ...u,
        username: displayName
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

    // 🔥 强制验证：通过 Telegram Bot API 验证用户ID并获取用户名
    let userInfo = null
      try {
        const bot = await prisma.bot.findFirst({
          where: { enabled: true },
          select: { token: true }
        })

      if (!bot?.token) {
        return NextResponse.json({ error: '没有可用的机器人，无法验证用户ID' }, { status: 500 })
      }

      console.log('[whitelisted-users] 开始验证用户ID:', userId)

          const response = await fetch(
            `https://api.telegram.org/bot${bot.token}/getChat?chat_id=${userId}`,
        { signal: AbortSignal.timeout(10000) } // 增加超时时间到10秒
          )
          const data = await response.json()

      if (!data.ok) {
        console.log('[whitelisted-users] Telegram API错误:', data)
        if (data.error_code === 400 && data.description?.includes('chat not found')) {
          return NextResponse.json({ error: '用户ID不存在，请检查输入是否正确' }, { status: 400 })
        }
        return NextResponse.json({ error: '无法验证用户ID，请稍后重试' }, { status: 500 })
      }

      if (data.result) {
        userInfo = data.result
        console.log('[whitelisted-users] 用户验证成功:', {
          userId,
          username: userInfo.username,
          first_name: userInfo.first_name,
          last_name: userInfo.last_name
        })
      } else {
        return NextResponse.json({ error: '无法获取用户信息' }, { status: 400 })
          }

      } catch (e) {
      console.log('[whitelisted-users] API调用异常:', (e as Error).message)
      return NextResponse.json({ error: '验证用户ID时发生网络错误，请稍后重试' }, { status: 500 })
    }

    // 生成最终的用户名
    const finalUsername = username && username.trim() ? username.trim() :
      userInfo.username ? `@${userInfo.username}` :
      (userInfo.first_name || userInfo.last_name) ?
      `${userInfo.first_name || ''} ${userInfo.last_name || ''}`.trim() :
      `用户${userId}`

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

// PATCH: 刷新用户显示名
export async function PATCH(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth

    const body = await req.json().catch(() => ({}))
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    console.log('[whitelisted-users][PATCH] 开始刷新用户:', userId)

    const newDisplayName = await refreshUserDisplayName(userId)

    if (newDisplayName) {
      console.log('[whitelisted-users][PATCH] 刷新成功:', userId, newDisplayName)
      return NextResponse.json({
        success: true,
        username: newDisplayName
      })
    } else {
      console.log('[whitelisted-users][PATCH] 刷新失败:', userId)
      return NextResponse.json({ error: 'Failed to refresh username' }, { status: 500 })
    }
  } catch (error) {
    console.error('[whitelisted-users][PATCH] 异常:', error)
    return NextResponse.json({ error: 'Failed to refresh username' }, { status: 500 })
  }
}

