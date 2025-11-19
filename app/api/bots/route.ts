import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin } from '@/app/api/_auth'

export async function GET(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    // 🔥 内存优化：减少查询字段，移除 featureFlags（已废弃，改用 chatFeatureFlags）
    // 减少 chats 字段查询深度
    const bots = await prisma.bot.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        enabled: true,
        token: true, // 🔥 添加token字段，用于获取真实名字
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { chats: true }
        },
      },
    })
    
    // 🔥 尝试从Telegram API获取机器人真实名字
    const botsWithRealName = await Promise.all(
      bots.map(async (bot: any) => {
        if (!bot.token) {
          return { ...bot, realName: null }
        }
        try {
          const url = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/getMe`
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 5000)
          const resp = await fetch(url, { method: 'GET', signal: controller.signal })
          clearTimeout(timeout)
          
          if (resp.ok) {
            const data = await resp.json()
            if (data?.ok && data?.result) {
              // Telegram API返回first_name字段，这是机器人的真实显示名称
              const realName = data.result.first_name || null
              return { ...bot, realName, token: undefined } // 不返回token
            }
          }
        } catch (e) {
          // 静默失败，返回原始数据
        }
        return { ...bot, realName: null, token: undefined } // 不返回token
      })
    )
    
    return NextResponse.json({ items: botsWithRealName })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      name?: string
      description?: string
      token?: string
      enabled?: boolean
    }

    if (!body.name || !body.token) {
      return new Response('Missing name or token', { status: 400 })
    }

    const bot = await prisma.bot.create({
      data: {
        name: body.name,
        description: body.description,
        token: body.token,
        enabled: body.enabled ?? true,
      },
      select: {
        id: true,
        name: true,
        description: true,
        enabled: true,
      },
    })
    return Response.json(bot, { status: 201 })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
