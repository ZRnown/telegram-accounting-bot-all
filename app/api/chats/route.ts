import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
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
        bot: { select: { id: true, name: true, token: true } },
      },
    })
    
    // 🔥 后台异步验证（不阻塞响应，不修改返回数据）
    // 验证失败不会导致群组从UI消失
    setImmediate(async () => {
      try {
        const chatsToValidate = chats.slice(0, 10).filter(ch => ch.botId && ch.bot?.token)
        if (chatsToValidate.length === 0) return
        
        const validationResults = await Promise.allSettled(
          chatsToValidate.map(async (ch) => {
            try {
              const url = `https://api.telegram.org/bot${encodeURIComponent(ch.bot!.token)}/getChat?chat_id=${encodeURIComponent(ch.id)}`
              const resp = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2000) })
              const ok = resp.ok && (await resp.json().catch(() => null))?.ok
              return { chatId: ch.id, valid: !!ok }
            } catch {
              return { chatId: ch.id, valid: false }
            }
          })
        )
        
        // 只在确认无效时才更新（不更新返回的数据）
        const invalidChats = validationResults
          .filter((r) => r.status === 'fulfilled' && !r.value.valid)
          .map((r: any) => r.value.chatId)
        
        // 🔥 延迟更新，避免频繁操作数据库
        if (invalidChats.length > 0) {
          setTimeout(async () => {
            await prisma.chat.updateMany({
              where: { id: { in: invalidChats } },
              data: { botId: null }
            }).catch(() => {})
          }, 5000) // 5秒后更新
        }
      } catch (e) {
        // 静默失败，不影响主流程
      }
    })
    
    return Response.json({ items: chats })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
