import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function endOfDay(d = new Date()) {
  const x = new Date(d)
  x.setDate(x.getDate() + 1)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d: Date, n: number) {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

function formatTimeLocal(d: Date) {
  const dt = new Date(d)
  try {
    return dt.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch (_) {
    // fallback
    const hh = String(dt.getHours()).padStart(2, '0')
    const mm = String(dt.getMinutes()).padStart(2, '0')
    const ss = String(dt.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const dateStr = searchParams.get('date') // YYYY-MM-DD
    const chatIdParam = searchParams.get('chatId')
    const billIndexParam = searchParams.get('bill')
    const now = dateStr ? new Date(dateStr) : new Date()
    const gte = startOfDay(now)
    const lt = endOfDay(now)

    // pick chatId: prefer latest bill if not explicitly provided
    let chatId = chatIdParam || ''
    if (!chatId) {
      const latestBill = await prisma.bill.findFirst({ orderBy: { savedAt: 'desc' } })
      chatId = latestBill?.chatId || ''
    }
    if (!chatId) {
      return Response.json({
        billNumber: 0,
        totalIncome: 0,
        exchangeRate: 0,
        feeRate: 0,
        shouldDispatch: 0,
        shouldDispatchUSDT: 0,
        dispatched: 0,
        dispatchedUSDT: 0,
        notDispatched: 0,
        notDispatchedUSDT: 0,
        incomeRecords: [],
        dispatchRecords: [],
        incomeByReplier: {},
        incomeByOperator: {},
        incomeByRate: {},
        dispatchByReplier: {},
      })
    }

    const [settings, bills] = await Promise.all([
      prisma.setting.findUnique({ where: { chatId } }),
      prisma.bill.findMany({ where: { chatId, openedAt: { gte, lt } }, orderBy: { openedAt: 'asc' } }),
    ])

    const billIds = bills.map((b: any) => b.id)
    const billItems = billIds.length
      ? await prisma.billItem.findMany({ where: { billId: { in: billIds } }, orderBy: { createdAt: 'asc' } })
      : []
    const feePercent = settings?.feePercent ?? 0
    const fixedRate = settings?.fixedRate ?? null
    const realtimeRate = settings?.realtimeRate ?? null
    // Build per-bill aggregates and records
    const billsAgg: any[] = []
    const billsRecords: { incomeRecords: any[]; dispatchRecords: any[] }[] = []
    for (const b of bills as any[]) {
      const its = billItems.filter((x: any) => x.billId === b.id)
      const incs = its.filter((x: any) => x.type === 'INCOME')
      const disps = its.filter((x: any) => x.type === 'DISPATCH')
      const tIncome = incs.reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0)
      const tDisp = disps.reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0)
      let rateB = fixedRate ?? realtimeRate ?? 0
      if (!rateB) {
        const lastIncWithRate = [...incs].reverse().find((x: any) => x.rate && x.rate > 0)
        if (lastIncWithRate?.rate) rateB = Number(lastIncWithRate.rate)
      }
      const feeB = (tIncome * feePercent) / 100
      const shouldB = Math.max(tIncome - feeB, 0)
      const toUSDTB = (n: number) => (rateB ? Number((n / rateB).toFixed(2)) : 0)
      const incomeRecordsSaved = incs.map((i: any) => {
        const gross = Number(i.amount) || 0
        const net = Math.max(gross - (gross * (feePercent || 0)) / 100, 0)
        const r = i.rate ? Number(i.rate) : rateB
        const usdt = r ? Number((net / r).toFixed(2)) : 0
        return {
          time: formatTimeLocal(i.createdAt as Date),
          amount: `${net}${r ? ` / ${r}=${usdt}` : ''}`,
          amountValue: gross,
          rate: (i.rate ? Number(i.rate) : null),
          replier: i.replier || '',
          operator: i.operator || '',
        }
      })
      const dispatchRecordsSaved = disps.map((d: any) => ({
        time: formatTimeLocal(d.createdAt as Date),
        amount: `${d.amount}`,
        replier: d.replier || '',
        operator: d.operator || '',
      }))
      billsAgg.push({
        totalIncome: tIncome,
        exchangeRate: rateB,
        feeRate: feePercent,
        shouldDispatch: shouldB,
        shouldDispatchUSDT: toUSDTB(shouldB),
        dispatched: tDisp,
        dispatchedUSDT: toUSDTB(tDisp),
        notDispatched: Math.max(shouldB - tDisp, 0),
        notDispatchedUSDT: toUSDTB(Math.max(shouldB - tDisp, 0)),
      })
      billsRecords.push({ incomeRecords: incomeRecordsSaved, dispatchRecords: dispatchRecordsSaved })
    }

    // Determine selected bill (1-based). Default latest.
    let selIdx = billsAgg.length ? (billsAgg.length - 1) : 0
    if (billIndexParam) {
      const v = Math.max(1, Math.min(Number(billIndexParam) || 1, billsAgg.length))
      selIdx = v - 1
    }
    const selectedBillAgg = billsAgg[selIdx] || {
      totalIncome: 0,
      exchangeRate: settings?.fixedRate ?? settings?.realtimeRate ?? 0,
      feeRate: settings?.feePercent ?? 0,
      shouldDispatch: 0,
      shouldDispatchUSDT: 0,
      dispatched: 0,
      dispatchedUSDT: 0,
      notDispatched: 0,
      notDispatchedUSDT: 0,
    }
    const incomeRecords = billsRecords[selIdx]?.incomeRecords || []
    const dispatchRecords = billsRecords[selIdx]?.dispatchRecords || []

    // Build breakdowns based on selected bill
    const incomeByReplier: Record<string, number> = {}
    const incomeByOperator: Record<string, number> = {}
    const incomeByRate: Record<string, number> = {}
    const selectedBillId = bills[selIdx]?.id
    const selItems = selectedBillId ? billItems.filter((x: any) => x.billId === selectedBillId) : []
    const selIncs = selItems.filter((x: any) => x.type === 'INCOME')
    selIncs.forEach((i: any) => {
      const amount = Number(i.amount) || 0
      const rate = Number(i.rate || 0) || undefined
      if (i.replier) incomeByReplier[i.replier] = (incomeByReplier[i.replier] || 0) + amount
      if (i.operator) incomeByOperator[i.operator] = (incomeByOperator[i.operator] || 0) + amount
      if (rate) incomeByRate[rate.toString()] = (incomeByRate[rate.toString()] || 0) + amount
    })
    const dispatchByReplier: Record<string, number> = {}
    const selDisps = selItems.filter((x: any) => x.type === 'DISPATCH')
    selDisps.forEach((d: any) => {
      const amount = Number(d.amount) || 0
      if (d.replier) dispatchByReplier[d.replier] = (dispatchByReplier[d.replier] || 0) + amount
    })

    const selected = selectedBillAgg

    // carry-over: add yesterday's notDispatched into today's should/notDispatched
    let carryOver = 0
    if (settings?.accountingMode === 'CARRY_OVER') {
      try {
        const yGte = startOfDay(addDays(gte, -1))
        const yLt = startOfDay(gte)
        const yBills = await prisma.bill.findMany({ where: { chatId, openedAt: { gte: yGte, lt: yLt } }, orderBy: { openedAt: 'asc' } })
        const yBillIds = yBills.map((b: any) => b.id)
        const yItems = yBillIds.length
          ? await prisma.billItem.findMany({ where: { billId: { in: yBillIds } } })
          : []
        const yIncs = yItems.filter((x: any) => x.type === 'INCOME')
        const yDisps = yItems.filter((x: any) => x.type === 'DISPATCH')
        const yTotalIncome = yIncs.reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0)
        const yTotalDispatched = yDisps.reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0)
        const feeRate = settings?.feePercent ?? 0
        const fee = (yTotalIncome * feeRate) / 100
        const yShould = Math.max(yTotalIncome - fee, 0)
        carryOver = Math.max(yShould - yTotalDispatched, 0)
      } catch {}
    }

    return Response.json({
      billNumber: billsAgg.length,
      bills: billsAgg,
      ...selected,
      ...(carryOver > 0
        ? {
            shouldDispatch: (selected.shouldDispatch || 0) + carryOver,
            shouldDispatchUSDT: (selected.shouldDispatchUSDT || 0) + (selected.exchangeRate ? Number((carryOver / selected.exchangeRate).toFixed(2)) : 0),
            notDispatched: (selected.notDispatched || 0) + carryOver,
            notDispatchedUSDT: (selected.notDispatchedUSDT || 0) + (selected.exchangeRate ? Number((carryOver / selected.exchangeRate).toFixed(2)) : 0),
            carryOver,
          }
        : {}),
      selectedBillIndex: selIdx + 1,
      incomeRecords,
      dispatchRecords,
      incomeByReplier,
      incomeByOperator,
      incomeByRate,
      dispatchByReplier,
    })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
