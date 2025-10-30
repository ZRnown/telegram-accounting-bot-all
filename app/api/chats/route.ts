import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const botId = searchParams.get('botId') || undefined
    const status = searchParams.get('status') || undefined

    // 自动清理未绑定机器人的群组（连带删除依赖数据，避免外键报错）
    const orphanChats = await prisma.chat.findMany({ where: { botId: null }, select: { id: true } })
    if (orphanChats.length) {
      const orphanIds = orphanChats.map((c: { id: string }) => c.id)
      // 找出这些群的账单，先删 BillItem 再删 Bill
      const bills = await prisma.bill.findMany({ where: { chatId: { in: orphanIds } }, select: { id: true } })
      const billIds = bills.map((b: { id: string }) => b.id)
      if (billIds.length) {
        await prisma.billItem.deleteMany({ where: { billId: { in: billIds } } })
        await prisma.bill.deleteMany({ where: { id: { in: billIds } } })
      }
      // 逐表删除与 chatId 关联的数据
      await prisma.commission.deleteMany({ where: { chatId: { in: orphanIds } } })
      await prisma.dispatch.deleteMany({ where: { chatId: { in: orphanIds } } })
      await prisma.income.deleteMany({ where: { chatId: { in: orphanIds } } })
      await prisma.operator.deleteMany({ where: { chatId: { in: orphanIds } } })
      await prisma.setting.deleteMany({ where: { chatId: { in: orphanIds } } })
      await prisma.chatFeatureFlag.deleteMany({ where: { chatId: { in: orphanIds } } })
      // 最后删除 chat 本身
      await prisma.chat.deleteMany({ where: { id: { in: orphanIds } } })
    }

    const where: any = {
      id: { startsWith: '-' },
      ...(botId ? { botId } : {}),
      ...(status ? { status } : {}),
      // UI 仅展示已绑定机器人的群组
      botId: { not: null },
    }

    let chats = await prisma.chat.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        allowed: true,
        createdAt: true,
        botId: true,
        bot: { select: { id: true, name: true, token: true } },
        featureFlags: { select: { feature: true, enabled: true } },
      },
    })
    // 惰性校验：若绑定了机器人但机器人不在群内，则自动解绑
    const fixed: typeof chats = [] as any
    for (const ch of chats) {
      if (ch.botId && ch.bot?.token) {
        try {
          const url = `https://api.telegram.org/bot${encodeURIComponent(ch.bot.token)}/getChat?chat_id=${encodeURIComponent(ch.id)}`
          const resp = await fetch(url, { method: 'GET' })
          const ok = resp.ok && (await resp.json().catch(() => null))?.ok
          if (!ok) {
            await prisma.chat.update({ where: { id: ch.id }, data: { bot: { disconnect: true } } })
            fixed.push({ ...ch, botId: null, bot: null })
            continue
          }
        } catch {
          await prisma.chat.update({ where: { id: ch.id }, data: { bot: { disconnect: true } } }).catch(() => {})
          fixed.push({ ...ch, botId: null, bot: null })
          continue
        }
      }
      fixed.push(ch)
    }
    chats = fixed
    return Response.json({ items: chats })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
