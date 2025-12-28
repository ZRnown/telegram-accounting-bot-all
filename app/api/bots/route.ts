import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin } from '@/app/api/_auth'
import { hashToken } from '@/lib/token-security'

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
        token: false, // ❌ 移除token字段，避免泄露
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { chats: true }
        },
      },
    })
    
    // 🔥 尝试从Telegram API获取机器人真实名字（需要token，临时查询）
    const botsWithRealName = await Promise.all(
      bots.map(async (bot: any) => {
        try {
          // 临时查询token用于API调用
          const botWithToken = await prisma.bot.findUnique({
            where: { id: bot.id },
            select: { token: true }
          })

          if (!botWithToken?.token) {
            return { ...bot, realName: null }
          }

          const url = `https://api.telegram.org/bot${encodeURIComponent(botWithToken.token)}/getMe`
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 5000)
          const resp = await fetch(url, { method: 'GET', signal: controller.signal })
          clearTimeout(timeout)

          if (resp.ok) {
            const data = await resp.json()
            if (data?.ok && data?.result) {
              // Telegram API返回first_name字段，这是机器人的真实显示名称
              const realName = data.result.first_name || null
              return { ...bot, realName }
            }
          }
        } catch (e) {
          // 静默失败，返回原始数据
        }
        return { ...bot, realName: null }
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

    // 🔥 安全：哈希token后存储
    const tokenHash = await hashToken(body.token)

    const bot = await prisma.bot.create({
      data: {
        name: body.name,
        description: body.description,
        token: body.token, // ⚠️  保留明文用于向后兼容，后续可移除
        tokenHash, // 🔥 存储哈希token
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
