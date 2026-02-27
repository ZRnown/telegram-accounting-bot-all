import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin, rateLimit } from '@/app/api/_auth'
import { ProxyAgent } from 'undici'

function buildSubscriptionExpiryKey(chatId: string) {
  return `subscription_chat_expires:${chatId}`
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'chat_patch', 30, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const { id } = await params
    const body = await req.json().catch(() => ({})) as {
      allowed?: boolean
      title?: string
      status?: string
      botId?: string | null
      subscriptionExpiresAt?: string | null
    }

    const data: any = {}
    if (typeof body.allowed === 'boolean') data.allowed = body.allowed
    if (typeof body.title === 'string') data.title = body.title
    if (typeof body.status === 'string') {
      data.status = body.status as any
      if (body.status === 'APPROVED') {
        data.allowed = true
      } else if (body.status === 'PENDING' || body.status === 'BLOCKED') {
        data.allowed = false
      }
    }
    if (body.botId !== undefined) {
      if (!body.botId) {
        data.bot = { disconnect: true }
      } else {
        // 验证该 bot 是否已加入该群
        const bot = await prisma.bot.findUnique({ 
          where: { id: body.botId }, 
          select: { token: true, featureFlags: { select: { feature: true, enabled: true } } } 
        })
        if (!bot?.token) return new NextResponse('机器人不存在', { status: 400 })
        const getChatUrl = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/getChat?chat_id=${encodeURIComponent(id)}`
        const resp = await fetch(getChatUrl, { method: 'GET' })
        if (!resp.ok) return new NextResponse('机器人未加入该群，无法绑定', { status: 400 })
        const json = await resp.json().catch(() => null)
        if (!json?.ok) return new NextResponse('机器人未加入该群，无法绑定', { status: 400 })
        data.bot = { connect: { id: body.botId } }
        
        // 自动为该群启用该机器人的所有功能
        const enabledFeatures = bot.featureFlags?.filter((f: { enabled: boolean; feature: string }) => f.enabled).map((f: { feature: string }) => f.feature) || []
        if (enabledFeatures.length > 0) {
          // 先删除该群的旧功能标志
          await prisma.chatFeatureFlag.deleteMany({ where: { chatId: id } })
          // 创建新的功能标志（继承机器人的启用功能）
          // SQLite 不支持 skipDuplicates，所以先删除再批量创建
          for (const feature of enabledFeatures) {
            await prisma.chatFeatureFlag.create({
              data: {
                chatId: id,
                feature,
                enabled: true,
              },
            }).catch(() => {}) // 忽略重复错误
          }
        }
      }
    }
    if (Object.keys(data).length === 0) return new NextResponse('Bad Request', { status: 400 })

    const updated = await prisma.chat.update({
      where: { id },
      data,
      select: {
        id: true,
        title: true,
        allowed: true,
        status: true,
        botId: true,
      },
    })

    if (body.subscriptionExpiresAt !== undefined) {
      const key = buildSubscriptionExpiryKey(id)
      if (!body.subscriptionExpiresAt) {
        await prisma.globalConfig.deleteMany({ where: { key } })
      } else {
        const expiresAt = new Date(body.subscriptionExpiresAt)
        if (!Number.isFinite(expiresAt.getTime())) {
          return NextResponse.json({ error: 'Invalid subscriptionExpiresAt' }, { status: 400 })
        }
        await prisma.globalConfig.upsert({
          where: { key },
          create: {
            key,
            value: expiresAt.toISOString(),
            description: '群组订阅到期时间',
            updatedBy: 'admin-api'
          },
          update: {
            value: expiresAt.toISOString(),
            updatedAt: new Date(),
            updatedBy: 'admin-api'
          }
        })
      }
    }

    const subCfg = await prisma.globalConfig.findUnique({
      where: { key: buildSubscriptionExpiryKey(id) },
      select: { value: true }
    })

    const subscriptionExpiresAt = subCfg?.value || null
    return NextResponse.json({ ...updated, subscriptionExpiresAt })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const { id } = await params
    const chat = await prisma.chat.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        allowed: true,
        status: true,
        createdAt: true,
        botId: true,
        bot: { select: { name: true } },
        featureFlags: { select: { feature: true, enabled: true } },
      },
    })
    if (!chat) return new NextResponse('Not Found', { status: 404 })
    const subCfg = await prisma.globalConfig.findUnique({
      where: { key: buildSubscriptionExpiryKey(id) },
      select: { value: true }
    })
    return NextResponse.json({ ...chat, subscriptionExpiresAt: subCfg?.value || null })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const rl = rateLimit(req, 'chat_delete', 10, 60 * 1000)
    if (!rl.ok) return NextResponse.json({ error: `Too many requests. Retry after ${rl.retryAfter}s` }, { status: 429 })
    const { id } = await params
    // Ensure chat exists
    const exists = await prisma.chat.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return new NextResponse('Not Found', { status: 404 })

    // 🔥 查询所有启用的机器人，检查它们是否在该群中，如果是则让它们退群
    const bots = await prisma.bot.findMany({
      where: { enabled: true },
      select: { id: true, token: true }
    })
    
    // 🔥 修复：并发让所有在该群中的机器人退群，增加超时时间和重试机制
    const leavePromises = bots.map(async (bot: any) => {
      if (!bot.token) return

      const leaveBot = async (retryCount = 0): Promise<void> => {
      try {
        // 先检查机器人是否在该群中
        const getChatUrl = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/getChat?chat_id=${encodeURIComponent(id)}`
        const resp = await fetch(getChatUrl, { 
          method: 'GET',
            signal: AbortSignal.timeout(5000) // 🔥 增加到5秒超时
        })

        if (resp.ok) {
          const json = await resp.json().catch(() => null)
          if (json?.ok) {
            // 机器人确实在该群中，让它退群
            const leaveChatUrl = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/leaveChat?chat_id=${encodeURIComponent(id)}`
              const leaveResp = await fetch(leaveChatUrl, {
              method: 'POST',
                signal: AbortSignal.timeout(5000) // 🔥 增加到5秒超时
              })

              if (leaveResp.ok) {
                const leaveJson = await leaveResp.json().catch(() => null)
                if (leaveJson?.ok) {
                  console.log('[删除群聊] 机器人已成功退群', { chatId: id, botId: bot.id })
                } else {
                  console.warn('[删除群聊] 机器人退群API返回错误', { chatId: id, botId: bot.id, error: leaveJson })
                }
              } else {
                throw new Error(`Leave chat HTTP ${leaveResp.status}`)
              }
            } else {
              console.log('[删除群聊] 机器人不在该群中，跳过退群', { chatId: id, botId: bot.id })
          }
          } else {
            throw new Error(`Get chat HTTP ${resp.status}`)
        }
      } catch (e) {
          // 🔥 添加重试机制，最多重试2次
          if (retryCount < 2 && (e.name === 'TimeoutError' || e.message?.includes('timeout'))) {
            console.log(`[删除群聊] 超时重试 ${retryCount + 1}/2`, { chatId: id, botId: bot.id })
            await new Promise(resolve => setTimeout(resolve, 1000)) // 等待1秒后重试
            return leaveBot(retryCount + 1)
          }

          console.error('[删除群聊] 检查/退群失败', { chatId: id, botId: bot.id, error: e.message, retryCount })
      }
      }

      return leaveBot()
    })
    
    // 🔥 等待所有退群操作完成（最多等待5秒）
    try {
      await Promise.race([
        Promise.all(leavePromises),
        new Promise(resolve => setTimeout(resolve, 5000)) // 5秒超时
      ])
    } catch (e) {
      console.error('[删除群聊] 退群操作失败', e)
    }

    // 🔥 修复删除顺序：严格按照外键依赖关系从子表到父表删除，避免外键约束违反
    try {
      // 1. 删除所有子表记录
      await Promise.all([
        prisma.chatFeatureFlag.deleteMany({ where: { chatId: id } }).catch(() => {}),
        prisma.addressVerification.deleteMany({ where: { chatId: id } }).catch(() => {}),
        prisma.featureWarningLog.deleteMany({ where: { chatId: id } }).catch(() => {}),
        prisma.operator.deleteMany({ where: { chatId: id } }).catch(() => {}),
        prisma.commission.deleteMany({ where: { chatId: id } }).catch(() => {}),
        prisma.income.deleteMany({ where: { chatId: id } }).catch(() => {}),
        prisma.dispatch.deleteMany({ where: { chatId: id } }).catch(() => {}),
        prisma.billItem.deleteMany({ where: { bill: { chatId: id } } }).catch(() => {}),
        prisma.bill.deleteMany({ where: { chatId: id } }).catch(() => {})
      ])

      // 2. 删除setting（有chatId外键）
      await prisma.setting.deleteMany({ where: { chatId: id } }).catch(() => {})

      // 3. 最后删除chat主表
    await prisma.chat.delete({ where: { id } })

      console.log('[删除群聊] 数据清理完成', { chatId: id })
    } catch (e) {
      console.error('[删除群聊] 数据清理失败', { chatId: id, error: e })
      // 即使删除失败，也要继续，因为前端已经删除了记录
    }
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
