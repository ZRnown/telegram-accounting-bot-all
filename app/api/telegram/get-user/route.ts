import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin, rateLimit } from '@/app/api/_auth'

/**
 * 通过 Bot API 获取 Telegram 用户信息
 */
export async function POST(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'tg_get_user', 20, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const body = await req.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    // 获取任一可用的 bot token
    const bot = await prisma.bot.findFirst({
      where: { enabled: true },
      select: { token: true }
    })

    if (!bot || !bot.token) {
      return NextResponse.json({ error: 'No active bot found' }, { status: 404 })
    }

    // 调用 Telegram Bot API 获取用户信息
    const telegramApiUrl = `https://api.telegram.org/bot${bot.token}/getChat?chat_id=${userId}`
    
    const response = await fetch(telegramApiUrl)
    const data = await response.json()

    if (!data.ok) {
      console.error('[telegram-api][get-user][error]', data)
      return NextResponse.json({ 
        error: 'Failed to fetch user info from Telegram',
        details: data.description 
      }, { status: 400 })
    }

    const user = data.result
    const username = user.username ? `@${user.username}` : null
    const firstName = user.first_name || ''
    const lastName = user.last_name || ''
    const displayName = [firstName, lastName].filter(Boolean).join(' ') || username || userId

    return NextResponse.json({
      userId,
      username,
      firstName,
      lastName,
      displayName
    })
  } catch (error: any) {
    console.error('[telegram-api][get-user][exception]', error)
    return NextResponse.json({ 
      error: 'Failed to fetch user info',
      message: error.message 
    }, { status: 500 })
  }
}

