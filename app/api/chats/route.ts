import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertAdmin } from '@/app/api/_auth'

function buildSubscriptionExpiryKey(chatId: string) {
  return `subscription_chat_expires:${chatId}`
}

export async function GET(req: NextRequest) {
  try {
    const unauth = assertAdmin(req)
    if (unauth) return unauth
    const { searchParams } = new URL(req.url)
    const botId = searchParams.get('botId') || undefined
    const status = searchParams.get('status') || undefined

    // 🔥 内存优化：异步清理未绑定机器人的群组（不阻塞主请求）
    // 将清理任务移到后台，避免每次请求都等待
    const cleanupOrphans = async () => {
      try {
        const orphanChats = await prisma.chat.findMany({ where: { botId: null }, select: { id: true }, take: 10 })
        if (orphanChats.length) {
          const orphanIds = orphanChats.map((c: { id: string }) => c.id)
          const bills = await prisma.bill.findMany({ where: { chatId: { in: orphanIds } }, select: { id: true } })
          const billIds = bills.map((b: { id: string }) => b.id)
          if (billIds.length) {
            await prisma.billItem.deleteMany({ where: { billId: { in: billIds } } })
            await prisma.bill.deleteMany({ where: { id: { in: billIds } } })
          }
          await prisma.commission.deleteMany({ where: { chatId: { in: orphanIds } } })
          await prisma.dispatch.deleteMany({ where: { chatId: { in: orphanIds } } })
          await prisma.income.deleteMany({ where: { chatId: { in: orphanIds } } })
          await prisma.operator.deleteMany({ where: { chatId: { in: orphanIds } } })
          await prisma.setting.deleteMany({ where: { chatId: { in: orphanIds } } })
          await prisma.chatFeatureFlag.deleteMany({ where: { chatId: { in: orphanIds } } })
          await prisma.chat.deleteMany({ where: { id: { in: orphanIds } } })
        }
      } catch (e) {
        console.error('[cleanup-orphans] 失败', e)
      }
    }
    // 异步执行，不等待结果
    cleanupOrphans().catch(() => {})

    const where: any = {
      id: { startsWith: '-' },
      ...(botId ? { botId } : {}),
      ...(status ? { status } : {}),
      // UI 仅展示已绑定机器人的群组
      botId: { not: null },
    }

    // 🔥 优化：直接返回群组数据，移除实时验证（避免群组消失）
    // 验证逻辑移到后台任务，不阻塞API响应
    // 🔥 直接查询所有字段（包括 invitedBy 和 invitedByUsername）
    const chats = await prisma.chat.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        allowed: true,
        createdAt: true,
        botId: true,
        invitedBy: true, // 邀请人ID
        invitedByUsername: true, // 邀请人用户名
        groupId: true, // 🔥 新增：分组ID
        bot: { select: { id: true, name: true } }, // ❌ 移除token字段，避免泄露
        group: { select: { id: true, name: true } }, // 🔥 新增：分组信息
      },
    })

    const keys = chats.map((item: { id: string }) => buildSubscriptionExpiryKey(item.id))
    const subRows = keys.length > 0
      ? await prisma.globalConfig.findMany({
        where: { key: { in: keys } },
        select: { key: true, value: true }
      })
      : []
    const subMap = new Map(subRows.map((row: { key: string; value: string }) => [row.key, row.value]))
    const withSubscription = chats.map((item: { id: string }) => ({
      ...item,
      subscriptionExpiresAt: subMap.get(buildSubscriptionExpiryKey(item.id)) || null
    }))
    
    // 🔥 移除实时验证，直接返回数据（提升加载速度）
    // 验证逻辑已移除，避免阻塞响应和导致群组消失
    
    return NextResponse.json({ items: withSubscription })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
