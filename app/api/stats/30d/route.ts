import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const chatIdParam = searchParams.get('chatId')
    const endStr = searchParams.get('end') // YYYY-MM-DD (inclusive end)

    const today = endStr ? new Date(endStr) : new Date()
    const end = startOfDay(today)
    const start = startOfDay(addDays(end, -29))

    // pick chatId: prefer latest bill if not given
    let chatId = chatIdParam || ''
    if (!chatId) {
      const latestBill = await prisma.bill.findFirst({ orderBy: { savedAt: 'desc' } })
      chatId = latestBill?.chatId || ''
    }
    if (!chatId) {
      return Response.json({
        totalIncome: 0,
        totalIncomeUSDT: 0,
        totalDispatch: 0,
        totalDispatchUSDT: 0,
        totalBills: 0,
        averageRate: 0,
        averageFee: 0,
        notDispatched: 0,
        notDispatchedUSDT: 0,
      })
    }

    const [settings, bills] = await Promise.all([
      prisma.setting.findUnique({ where: { chatId } }),
      prisma.bill.findMany({ where: { chatId, savedAt: { gte: start, lt: addDays(end, 1) } }, orderBy: { savedAt: 'asc' } }),
    ])

    const billIds = bills.map(b => b.id)
    const items = billIds.length
      ? await prisma.billItem.findMany({ where: { billId: { in: billIds } } })
      : []

    const incomeItems = items.filter(i => i.type === 'INCOME')
    const dispatchItems = items.filter(i => i.type === 'DISPATCH')

    const totalIncome = incomeItems.reduce((s: number, i: any) => s + (Number(i.amount) || 0), 0)
    const totalDispatch = dispatchItems.reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0)

    const feeRate = settings?.feePercent ?? 0
    const fixedRate = settings?.fixedRate ?? null
    const realtimeRate = settings?.realtimeRate ?? null
    let rate = fixedRate ?? realtimeRate ?? 0
    if (!rate) {
      const lastIncomeWithRate = [...incomeItems].reverse().find((i: any) => i.rate && i.rate > 0)
      if (lastIncomeWithRate?.rate) rate = Number(lastIncomeWithRate.rate)
    }

    const fee = (totalIncome * feeRate) / 100
    const shouldDispatch = Math.max(totalIncome - fee, 0)

    const toUSDT = (rmb: number) => (rate ? Number((rmb / rate).toFixed(2)) : 0)

    const totalIncomeUSDT = toUSDT(totalIncome)
    const totalDispatchUSDT = toUSDT(totalDispatch)
    const notDispatched = Math.max(shouldDispatch - totalDispatch, 0)
    const notDispatchedUSDT = toUSDT(notDispatched)

    return Response.json({
      totalIncome,
      totalIncomeUSDT,
      totalDispatch,
      totalDispatchUSDT,
      totalBills: incomeItems.length,
      averageRate: rate,
      averageFee: feeRate,
      notDispatched,
      notDispatchedUSDT,
    })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
