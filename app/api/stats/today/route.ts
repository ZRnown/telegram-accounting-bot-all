import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * 日切时间函数 - 支持自定义小时
 * 🔥 修复：统一日切逻辑，与后端保持一致
 * 用于实时查询：根据当前时间判断应该归入的账单周期的开始时间
 * 
 * 逻辑说明：
 * - 如果当前时间是3号上午10点，日切是2点，返回3号02:00（今天账单的开始）
 * - 如果当前时间是3号凌晨1点，日切是2点，返回2号02:00（昨天账单的开始）
 */
function startOfDay(d: Date, cutoffHour: number = 0) {
  const now = new Date(d)
  
  // 计算今天的日切开始时间
  const todayCutoff = new Date()
  todayCutoff.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
  todayCutoff.setHours(cutoffHour, 0, 0, 0)
  
  // 判断当前时间是否已经过了今天的日切点
  if (now >= todayCutoff) {
    // 当前时间 >= 今天的日切时间，返回今天账单的开始时间
    return new Date(todayCutoff)
  } else {
    // 当前时间 < 今天的日切时间，返回昨天账单的开始时间
    const yesterdayCutoff = new Date(todayCutoff)
    yesterdayCutoff.setDate(yesterdayCutoff.getDate() - 1)
    return yesterdayCutoff
  }
}

/**
 * 日切时间函数 - 计算当前应该归入的账单周期的结束时间
 */
function endOfDay(d: Date, cutoffHour: number = 0) {
  const start = startOfDay(d, cutoffHour)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return end
}

/**
 * 从日期字符串计算日期范围的起始时间
 * 用于查询指定日期的数据范围，不会因为时间判断而退到前一天
 * @param dateStr - 日期字符串，格式 YYYY-MM-DD
 * @param cutoffHour - 日切小时（0-23）
 * 
 * 示例：如果 dateStr = "2025-11-03", cutoffHour = 2
 * 返回：2025/11/03 02:00:00（该日期的日切开始时间）
 */
function startOfDateRange(dateStr: string, cutoffHour: number = 0) {
  // 🔥 修复：使用本地时间创建日期，避免时区问题
  // 从 YYYY-MM-DD 解析出年月日
  const [year, month, day] = dateStr.split('-').map(Number)
  // 创建本地时间日期对象（不是UTC）
  // 使用 Date.UTC 然后转换回本地时间，或者直接用本地时间构造函数
  // 这里直接使用本地时间构造函数，确保时间就是本地时间的 02:00:00
  const d = new Date(year, month - 1, day, cutoffHour, 0, 0, 0)
  // 🔥 确保返回的是本地时间的日期对象
  return d
}

/**
 * 从日期字符串计算日期范围的结束时间
 * @param dateStr - 日期字符串，格式 YYYY-MM-DD
 * @param cutoffHour - 日切小时（0-23）
 * 
 * 示例：如果 dateStr = "2025-11-03", cutoffHour = 2
 * 返回：2025/11/04 02:00:00（该日期的下一天日切时间）
 */
function endOfDateRange(dateStr: string, cutoffHour: number = 0) {
  // 🔥 修复：使用本地时间创建日期，避免时区问题
  // 从 YYYY-MM-DD 解析出年月日
  const [year, month, day] = dateStr.split('-').map(Number)
  // 创建下一天的本地时间日期对象（不是UTC）
  const d = new Date(year, month - 1, day + 1, cutoffHour, 0, 0, 0)
  // 🔥 确保返回的是本地时间的日期对象
  return d
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
    // 🔥 修复：如果提供了dateStr，直接使用它，不要转换为Date再转换（避免时区问题）
    const now = dateStr ? new Date() : new Date() // now只用于实时查询，不用于日期字符串查询

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

    // 🔥 使用日切时间计算日期范围（优先使用群组级别，否则使用全局配置）
    let cutoffHour = 0 // 默认值
    if (settings?.dailyCutoffHour != null && settings.dailyCutoffHour >= 0 && settings.dailyCutoffHour <= 23) {
      cutoffHour = settings.dailyCutoffHour
    } else {
      // 🔥 查询全局配置获取默认日切时间
      try {
        const globalConfig = await prisma.globalConfig.findUnique({
          where: { key: 'daily_cutoff_hour' },
          select: { value: true }
        })
        if (globalConfig?.value) {
          const hour = parseInt(globalConfig.value, 10)
          if (!isNaN(hour) && hour >= 0 && hour <= 23) {
            cutoffHour = hour
          }
        }
      } catch (e) {
        // 查询失败时使用默认值0
        console.error('[stats/today] 查询全局日切时间失败:', e)
      }
    }
    // 如果是从日期字符串查询，使用专门的函数；否则使用实时查询函数
    let gte: Date
    let lt: Date
    if (dateStr) {
      // 从日期字符串查询：直接使用该日期的日切时间范围
      gte = startOfDateRange(dateStr, cutoffHour)
      lt = endOfDateRange(dateStr, cutoffHour)
    } else {
      // 实时查询：根据当前时间判断今天的范围
      gte = startOfDay(now, cutoffHour)
      lt = endOfDay(now, cutoffHour)
    }

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
            feeRate: true, // 🔥 添加单笔费率字段，用于正确计算
            replier: true,
            operator: true,
            remark: true, // 🔥 添加备注字段
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' }
        })
      : []
    
    // 🔥 性能优化：使用 Map 预先分组，避免多次 filter
    const itemsByBillId = new Map<string, any[]>()
    for (const item of billItems) {
      const billId = item.billId
      if (!itemsByBillId.has(billId)) {
        itemsByBillId.set(billId, [])
      }
      itemsByBillId.get(billId)!.push(item)
    }
    
    const feePercent = settings?.feePercent ?? 0
    const fixedRate = settings?.fixedRate ?? null
    const realtimeRate = settings?.realtimeRate ?? null
    // Build per-bill aggregates and records
    const billsAgg: any[] = []
    const billsRecords: { incomeRecords: any[]; dispatchRecords: any[] }[] = []
    // 🔥 使用 billsData 而不是 bills（bills 是空数组）
    for (const b of billsData) {
      const its = itemsByBillId.get(b.id) || []
      // 🔥 性能优化：一次性分类，避免多次遍历
      const incs: any[] = []
      const disps: any[] = []
      for (const item of its) {
        if (item.type === 'INCOME') {
          incs.push(item)
        } else if (item.type === 'DISPATCH') {
          disps.push(item)
        }
      }
      // 🔥 修复费率计算：区分单笔费率（feeRate）和群组费率（feePercent）
      // 对于有单笔费率的记录，金额已经是扣除费率后的，不需要再用群组费率扣除
      // 对于没有单笔费率的记录，才用群组费率扣除
      let totalGrossIncome = 0 // 原始总金额（用于显示）
      let totalNetIncome = 0 // 扣除费率后的总金额（用于计算应下发）
      
      for (const inc of incs) {
        const amount = Number(inc.amount) || 0
        const itemFeeRate = inc.feeRate ? Number(inc.feeRate) : null
        
        if (itemFeeRate && itemFeeRate > 0 && itemFeeRate <= 1) {
          // 有单笔费率：金额已经是扣除费率后的，需要还原原始金额用于显示
          const grossAmount = amount / itemFeeRate
          totalGrossIncome += grossAmount
          totalNetIncome += amount // 已经是扣除费率后的
        } else {
          // 没有单笔费率：使用群组费率
          const grossAmount = amount
          totalGrossIncome += grossAmount
          const netAmount = amount - (amount * (feePercent || 0)) / 100
          totalNetIncome += netAmount
        }
      }
      
      const tIncome = totalGrossIncome // 用于显示的总入款（原始金额）
      const tDisp = disps.reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0)
      let rateB = fixedRate ?? realtimeRate ?? 0
      if (!rateB) {
        // 🔥 性能优化：从后往前找第一个有汇率的记录，不需要 reverse
        for (let i = incs.length - 1; i >= 0; i--) {
          if (incs[i].rate && Number(incs[i].rate) > 0) {
            rateB = Number(incs[i].rate)
            break
          }
        }
      }
      // 🔥 修复：应下发使用扣除费率后的总金额（已经考虑了单笔费率和群组费率）
      const shouldB = totalNetIncome
      const toUSDTB = (n: number) => (rateB ? Number((n / rateB).toFixed(2)) : 0)
      const incomeRecordsSaved = incs.map((i: any) => {
        const amount = Number(i.amount) || 0
        const itemFeeRate = i.feeRate ? Number(i.feeRate) : null
        
        // 🔥 修复：计算原始金额（gross）和扣除费率后的金额（net）
        let gross: number
        let net: number
        
        if (itemFeeRate && itemFeeRate > 0 && itemFeeRate <= 1) {
          // 有单笔费率：数据库中的amount已经是扣除费率后的，需要还原原始金额
          gross = amount / itemFeeRate
          net = amount // 已经是扣除费率后的
        } else {
          // 没有单笔费率：使用群组费率
          gross = amount
          net = amount - (amount * (feePercent || 0)) / 100
        }
        
        const r = i.rate ? Number(i.rate) : rateB
        // 🔥 修复：USDT计算使用扣除费率后的金额（net）
        const usdt = r ? Number((Math.abs(net) / r).toFixed(2)) * (net < 0 ? -1 : 1) : 0
        return {
          time: formatTimeLocal(i.createdAt as Date),
          amount: `${gross}${r ? ` / ${r}=${usdt}` : ''}`, // 🔥 修复：显示原始金额gross
          amountValue: gross,
          rate: (i.rate ? Number(i.rate) : null),
          replier: i.replier || '',
          operator: i.operator || '',
          remark: i.remark || null, // 🔥 添加备注字段
        }
      })
      const dispatchRecordsSaved = disps.map((d: any) => ({
        time: formatTimeLocal(d.createdAt as Date),
        amount: `${d.amount}`,
        replier: d.replier || '',
        operator: d.operator || '',
      }))
      billsAgg.push({
        totalIncome: tIncome, // 🔥 今日入款（当前日期范围内的入款）
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
    const selItems = selectedBillId ? (itemsByBillId.get(selectedBillId) || []) : []
    // 🔥 性能优化：一次性分类
    const selIncs: any[] = []
    for (const item of selItems) {
      if (item.type === 'INCOME') {
        selIncs.push(item)
      }
    }
    selIncs.forEach((i: any) => {
      const amount = Number(i.amount) || 0
      const rate = Number(i.rate || 0) || undefined
      if (i.replier) incomeByReplier[i.replier] = (incomeByReplier[i.replier] || 0) + amount
      if (i.operator) incomeByOperator[i.operator] = (incomeByOperator[i.operator] || 0) + amount
      if (rate) incomeByRate[rate.toString()] = (incomeByRate[rate.toString()] || 0) + amount
    })
    // 🔥 改为按操作人（operator）分类统计
    const dispatchByOperator: Record<string, number> = {}
    const selDisps: any[] = []
    for (const item of selItems) {
      if (item.type === 'DISPATCH') {
        selDisps.push(item)
      }
    }
    selDisps.forEach((d: any) => {
      const amount = Number(d.amount) || 0
      // 优先使用operator，如果没有则使用replier作为后备
      const operator = d.operator || d.replier || '未知'
      if (operator) dispatchByOperator[operator] = (dispatchByOperator[operator] || 0) + amount
    })

    const selected = selectedBillAgg

    // 🔥 累计模式：计算今日入款和累计总入款
    let carryOver = 0
    let cumulativeTotalIncome = selected.totalIncome // 默认等于今日入款（非累计模式）
    const isCumulativeMode = settings?.accountingMode === 'CARRY_OVER'
    
    if (isCumulativeMode) {
      try {
        // 计算昨天的日期范围（用于计算历史未下发）
        let yGte: Date
        if (dateStr) {
          // 从日期字符串查询：计算昨天
          const todayStart = startOfDateRange(dateStr, cutoffHour)
          yGte = new Date(todayStart)
          yGte.setDate(yGte.getDate() - 1) // 退到昨天
        } else {
          // 实时查询：昨天就是今天的前一天
          yGte = new Date(gte)
          yGte.setDate(yGte.getDate() - 1)
        }
        const yLt = new Date(gte) // 今天的开始就是昨天的结束
        
        // 🔥 计算历史未下发金额（从昨天开始往前累计）
        const yBills = await prisma.bill.findMany({
          where: { chatId, openedAt: { gte: yGte, lt: yLt } },
          select: { id: true },
          orderBy: { openedAt: 'asc' }
        })
        const yBillIds = yBills.map((b: any) => b.id)
        const yItems = yBillIds.length
          ? await prisma.billItem.findMany({
              where: { billId: { in: yBillIds } },
              select: { type: true, amount: true, feeRate: true }
            })
          : []
        const yIncs = yItems.filter((x: any) => x.type === 'INCOME')
        const yDisps = yItems.filter((x: any) => x.type === 'DISPATCH')
        
        // 🔥 修复：正确计算昨天的入款（考虑单笔费率）
        let yTotalGrossIncome = 0
        let yTotalNetIncome = 0
        for (const inc of yIncs) {
          const amount = Number(inc.amount) || 0
          const itemFeeRate = inc.feeRate ? Number(inc.feeRate) : null
          if (itemFeeRate && itemFeeRate > 0 && itemFeeRate <= 1) {
            const grossAmount = amount / itemFeeRate
            yTotalGrossIncome += grossAmount
            yTotalNetIncome += amount
          } else {
            yTotalGrossIncome += amount
            yTotalNetIncome += amount - (amount * (feePercent || 0)) / 100
          }
        }
        const yTotalDispatched = yDisps.reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0)
        carryOver = Math.max(yTotalNetIncome - yTotalDispatched, 0)
        
        // 🔥 计算累计总入款：从最早到现在所有的入款（包括今天）
        const allBills = await prisma.bill.findMany({
          where: { chatId, openedAt: { lt } }, // 所有早于今天结束时间的账单（包含今天）
          select: { id: true },
          orderBy: { openedAt: 'asc' }
        })
        const allBillIds = allBills.map((b: any) => b.id)
        const allItems = allBillIds.length
          ? await prisma.billItem.findMany({
              where: { billId: { in: allBillIds }, type: 'INCOME' },
              select: { amount: true, feeRate: true }
            })
          : []
        
        // 🔥 计算累计总入款（原始金额，用于显示）
        cumulativeTotalIncome = 0
        for (const item of allItems) {
          const amount = Number(item.amount) || 0
          const itemFeeRate = item.feeRate ? Number(item.feeRate) : null
          if (itemFeeRate && itemFeeRate > 0 && itemFeeRate <= 1) {
            cumulativeTotalIncome += amount / itemFeeRate // 还原原始金额
          } else {
            cumulativeTotalIncome += amount
          }
        }
      } catch (e) {
        console.error('[累计模式计算错误]', e)
      }
    }

    // 🔥 累计模式：计算今日入款（当前查询日期范围内的入款，不管是否累计模式都要返回）
    // 无论累计模式还是非累计模式，todayIncome都应该显示当前查询日期范围内的入款
    const todayIncome = selected.totalIncome // 当前查询日期范围内的入款（gross）
    
    return Response.json({
      billNumber: billsAgg.length,
      bills: billsAgg,
      ...selected,
      // 🔥 修复：无论是否累计模式，都返回todayIncome（当前查询日期范围内的入款）
      todayIncome,
      ...(isCumulativeMode
        ? {
            // 🔥 累计模式：返回今日入款和累计总入款
            totalIncome: cumulativeTotalIncome, // 累计总入款（从最早到现在）
            shouldDispatch: (selected.shouldDispatch || 0) + carryOver,
            shouldDispatchUSDT: (selected.shouldDispatchUSDT || 0) + (selected.exchangeRate ? Number((carryOver / selected.exchangeRate).toFixed(2)) : 0),
            notDispatched: (selected.notDispatched || 0) + carryOver,
            notDispatchedUSDT: (selected.notDispatchedUSDT || 0) + (selected.exchangeRate ? Number((carryOver / selected.exchangeRate).toFixed(2)) : 0),
            carryOver,
          }
        : carryOver > 0
        ? {
            // 非累计模式，但有历史数据（兼容旧逻辑）
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
      // 注意：Date对象会被JSON序列化为ISO字符串（UTC），前端解析时会自动转换为本地时间
      dateRangeStart: gte.toISOString(),
      dateRangeEnd: lt.toISOString(),
      dailyCutoffHour: cutoffHour,
    })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
