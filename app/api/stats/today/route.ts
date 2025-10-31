import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * 日切时间函数 - 支持自定义小时
 */
function startOfDay(d: Date, cutoffHour: number = 0) {
  const x = new Date(d)
  x.setHours(cutoffHour, 0, 0, 0)
  
  // 如果当前时间在日切点之前，需要退到前一天的日切点
  if (d.getHours() < cutoffHour) {
    x.setDate(x.getDate() - 1)
  }
  
  return x
}

function endOfDay(d: Date, cutoffHour: number = 0) {
  const x = new Date(d)
  x.setDate(x.getDate() + 1)
  x.setHours(cutoffHour, 0, 0, 0)
  
  // 如果当前时间在日切点之前，endOfDay 也要相应调整
  if (d.getHours() < cutoffHour) {
    x.setDate(x.getDate() - 1)
  }
  
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
        dateRangeStart: new Date(),
        dateRangeEnd: new Date(),
      })
    }

    // 🔥 获取日切时间设置
    const settings = await prisma.setting.findUnique({
      where: { chatId },
      select: {
        feePercent: true,
        fixedRate: true,
        realtimeRate: true,
        accountingMode: true,
        dailyCutoffHour: true,
      }
    })

    // 🔥 使用日切时间计算日期范围
    const cutoffHour = settings?.dailyCutoffHour ?? 0
    const gte = startOfDay(now, cutoffHour)
    const lt = endOfDay(now, cutoffHour)

    // 🔥 重新查询账单（使用正确的日切时间）
    const billsData = await prisma.bill.findMany({
      where: { chatId, openedAt: { gte, lt } },
      select: { id: true, openedAt: true, status: true },
      orderBy: { openedAt: 'asc' }
    })

    const billIds = billsData.map((b: any) => b.id)
    const billItems = billIds.length
      ? await prisma.billItem.findMany({
          where: { billId: { in: billIds } },
          select: {
            billId: true,
            type: true,
            amount: true,
            rate: true,
            usdt: true,
            replier: true,
            operator: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' }
        })
      : []
    const feePercent = settings?.feePercent ?? 0
    const fixedRate = settings?.fixedRate ?? null
    const realtimeRate = settings?.realtimeRate ?? null
    // Build per-bill aggregates and records
    const billsAgg: any[] = []
    const billsRecords: { incomeRecords: any[]; dispatchRecords: any[] }[] = []
    // 🔥 使用 billsData 而不是 bills（bills 是空数组）
    for (const b of billsData) {
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
      // 🔥 修复：支持负数，不强制为0
      const shouldB = tIncome - feeB
      const toUSDTB = (n: number) => (rateB ? Number((n / rateB).toFixed(2)) : 0)
      const incomeRecordsSaved = incs.map((i: any) => {
        const gross = Number(i.amount) || 0
        // 🔥 修复：支持负数，不强制为0
        const net = gross - (gross * (feePercent || 0)) / 100
        const r = i.rate ? Number(i.rate) : rateB
        const usdt = r ? Number((Math.abs(net) / r).toFixed(2)) * (net < 0 ? -1 : 1) : 0
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
        // 🔥 修复：支持负数，不强制为0
        notDispatched: shouldB - tDisp,
        notDispatchedUSDT: toUSDTB(shouldB - tDisp),
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
    const selectedBillId = billsData[selIdx]?.id
    const selItems = selectedBillId ? billItems.filter((x: any) => x.billId === selectedBillId) : []
    const selIncs = selItems.filter((x: any) => x.type === 'INCOME')
    selIncs.forEach((i: any) => {
      const amount = Number(i.amount) || 0
      const rate = Number(i.rate || 0) || undefined
      if (i.replier) incomeByReplier[i.replier] = (incomeByReplier[i.replier] || 0) + amount
      if (i.operator) incomeByOperator[i.operator] = (incomeByOperator[i.operator] || 0) + amount
      if (rate) incomeByRate[rate.toString()] = (incomeByRate[rate.toString()] || 0) + amount
    })
    // 🔥 改为按操作人（operator）分类统计
    const dispatchByOperator: Record<string, number> = {}
    const selDisps = selItems.filter((x: any) => x.type === 'DISPATCH')
    selDisps.forEach((d: any) => {
      const amount = Number(d.amount) || 0
      // 优先使用operator，如果没有则使用replier作为后备
      const operator = d.operator || d.replier || '未知'
      if (operator) dispatchByOperator[operator] = (dispatchByOperator[operator] || 0) + amount
    })

    const selected = selectedBillAgg

    // carry-over: add yesterday's notDispatched into today's should/notDispatched
    let carryOver = 0
    if (settings?.accountingMode === 'CARRY_OVER') {
      try {
        const yGte = startOfDay(addDays(gte, -1))
        const yLt = startOfDay(gte)
        // 🔥 内存优化：只选择必要的字段
        const yBills = await prisma.bill.findMany({
          where: { chatId, openedAt: { gte: yGte, lt: yLt } },
          select: { id: true },
          orderBy: { openedAt: 'asc' }
        })
        const yBillIds = yBills.map((b: any) => b.id)
        const yItems = yBillIds.length
          ? await prisma.billItem.findMany({
              where: { billId: { in: yBillIds } },
              select: { type: true, amount: true }
            })
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
      dispatchByOperator, // 🔥 改为按操作人分类
      // 🔥 返回实际的日期范围（考虑日切时间）
      dateRangeStart: gte,
      dateRangeEnd: lt,
      dailyCutoffHour: cutoffHour,
    })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
