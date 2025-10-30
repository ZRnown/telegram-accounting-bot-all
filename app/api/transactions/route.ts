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

    // figure chatId default: last active
    let chatIdFinal = chatId
    if (!chatIdFinal) {
      const latestIncome = await prisma.income.findFirst({ orderBy: { createdAt: 'desc' } })
      const latestDispatch = await prisma.dispatch.findFirst({ orderBy: { createdAt: 'desc' } })
      chatIdFinal = latestIncome?.chatId || latestDispatch?.chatId || undefined
    }

    const dateFilter: any = {}
    if (from) dateFilter.gte = from
    if (to) dateFilter.lte = to

    const whereIncome: any = { ...(chatIdFinal ? { chatId: chatIdFinal } : {}), ...(from || to ? { createdAt: dateFilter } : {}) }
    const whereDispatch: any = { ...(chatIdFinal ? { chatId: chatIdFinal } : {}), ...(from || to ? { createdAt: dateFilter } : {}) }

    let incomeCount = 0, dispatchCount = 0, incomes: any[] = [], dispatches: any[] = []
    if (type === 'all' || type === 'income') {
      incomeCount = await prisma.income.count({ where: whereIncome })
      incomes = await prisma.income.findMany({ where: whereIncome, orderBy: { createdAt: 'desc' }, skip: (page - 1) * size, take: size })
    }
    if (type === 'all' || type === 'dispatch') {
      dispatchCount = await prisma.dispatch.count({ where: whereDispatch })
      dispatches = await prisma.dispatch.findMany({ where: whereDispatch, orderBy: { createdAt: 'desc' }, skip: (page - 1) * size, take: size })
    }

    // compute usdt for incomes when possible
    let rate = 0
    if (chatIdFinal) {
      const settings = await prisma.setting.findUnique({ where: { chatId: chatIdFinal } })
      rate = settings?.fixedRate ?? settings?.realtimeRate ?? 0
    }

    const incomeItems = incomes.map((i) => ({
      id: i.id,
      type: 'income' as const,
      amount: i.amount,
      usdt: Number(((i.rate ?? rate) ? (i.amount / (i.rate ?? rate)) : 0).toFixed(2)),
      rate: ((i.rate ?? rate) || null),
      replier: i.replier || null,
      operator: i.operator || null,
      createdAt: i.createdAt,
    }))
    const dispatchItems = dispatches.map((d) => ({
      id: d.id,
      type: 'dispatch' as const,
      amount: d.amount,
      usdt: d.usdt,
      rate: rate || null,
      replier: d.replier || null,
      operator: d.operator || null,
      createdAt: d.createdAt,
    }))

    const items = (type === 'income' ? incomeItems : type === 'dispatch' ? dispatchItems : [...incomeItems, ...dispatchItems])
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, size)

    const total = (type === 'income' ? incomeCount : type === 'dispatch' ? dispatchCount : incomeCount + dispatchCount)

    return Response.json({ page, size, total, items })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
