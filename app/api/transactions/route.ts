import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

function parseDate(s: string | null) {
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const chatId = searchParams.get('chatId') || undefined
    const type = (searchParams.get('type') || 'all').toLowerCase() as 'all'|'income'|'dispatch'
    const from = parseDate(searchParams.get('from'))
    const to = parseDate(searchParams.get('to'))
    const page = Math.max(1, Number(searchParams.get('page') || '1'))
    const size = Math.min(100, Math.max(1, Number(searchParams.get('size') || '20')))

    // 🔥 从 BillItem 表获取数据（新的存储方式）
    let chatIdFinal = chatId
    if (!chatIdFinal) {
      // 获取最近有活动的群组
      const latestBill = await prisma.bill.findFirst({ 
        orderBy: { openedAt: 'desc' },
        select: { chatId: true }
      })
      chatIdFinal = latestBill?.chatId || undefined
    }

    // 构建日期过滤：通过 bill 的 openedAt 来过滤
    const billWhere: any = {}
    if (chatIdFinal) billWhere.chatId = chatIdFinal
    if (from || to) {
      billWhere.openedAt = {}
      if (from) billWhere.openedAt.gte = from
      if (to) {
        const toEnd = new Date(to)
        toEnd.setHours(23, 59, 59, 999)
        billWhere.openedAt.lte = toEnd
      }
    }

    // 获取符合条件的账单
    const bills = await prisma.bill.findMany({
      where: billWhere,
      select: { id: true }
    })
    const billIds = bills.map(b => b.id)

    if (billIds.length === 0) {
      return Response.json({ page, size, total: 0, items: [] })
    }

    // 构建 BillItem 查询条件
    const itemWhere: any = { billId: { in: billIds } }
    if (type === 'income') {
      itemWhere.type = 'INCOME'
    } else if (type === 'dispatch') {
      itemWhere.type = 'DISPATCH'
    }

    // 获取记录
    const [total, items] = await Promise.all([
      prisma.billItem.count({ where: itemWhere }),
      prisma.billItem.findMany({
        where: itemWhere,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      })
    ])

    // 格式化数据
    const formattedItems = items.map((item) => {
      if (item.type === 'INCOME') {
        return {
          id: item.id,
          type: 'income' as const,
          amount: Number(item.amount),
          usdt: item.usdt ? Number(item.usdt) : null,
          rate: item.rate ? Number(item.rate) : null,
          feeRate: item.feeRate ? Number(item.feeRate) : null, // 🔥 添加费率
          remark: item.remark || null, // 🔥 添加备注
          replier: item.replier || null,
          operator: item.operator || null,
          createdAt: item.createdAt,
        }
      } else {
        return {
          id: item.id,
          type: 'dispatch' as const,
          amount: Number(item.amount),
          usdt: item.usdt ? Number(item.usdt) : null,
          rate: item.rate ? Number(item.rate) : null,
          feeRate: item.feeRate ? Number(item.feeRate) : null, // 🔥 添加费率
          remark: item.remark || null, // 🔥 添加备注
          replier: item.replier || null,
          operator: item.operator || null,
          createdAt: item.createdAt,
        }
      }
    })

    return Response.json({ page, size, total, items: formattedItems })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
