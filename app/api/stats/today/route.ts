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
    // 🔥 累计模式：查询所有账单（不限制日期），按openedAt排序
    // 🔥 清零模式：只查询当天的OPEN账单
    const isCumulativeMode = settings?.accountingMode === 'CARRY_OVER'
    
    let billsData: any[] = []
    
    if (isCumulativeMode) {
      // 🔥 累计模式：查询所有账单（不限制日期）
      billsData = await prisma.bill.findMany({
        where: { chatId },
        select: { id: true, openedAt: true, closedAt: true, status: true },
        orderBy: { openedAt: 'asc' }
      })
    } else {
      // 🔥 清零模式：只查询当天的OPEN账单
      billsData = await prisma.bill.findMany({
        where: { 
          chatId, 
          openedAt: { gte, lt },
          status: 'OPEN'
        },
        select: { id: true, openedAt: true, closedAt: true, status: true },
        orderBy: { openedAt: 'asc' }
      })
    }

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
            createdAt: true, // 🔥 用于计算今日入款（累计模式）
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
      // 🔥 累计模式：计算今日入款（当日切日内的入款）
      let todayIncome = tIncome // 默认等于总入款
      if (isCumulativeMode) {
        // 计算当日切时间范围
        const todayStart = dateStr ? startOfDateRange(dateStr, cutoffHour) : gte
        const todayEnd = dateStr ? endOfDateRange(dateStr, cutoffHour) : lt
        
        // 只计算在当日切时间范围内的入款
        todayIncome = 0
        for (const inc of incs) {
          const itemDate = new Date(inc.createdAt)
          if (itemDate >= todayStart && itemDate < todayEnd) {
            const amount = Number(inc.amount) || 0
            const itemFeeRate = inc.feeRate ? Number(inc.feeRate) : null
            
            if (itemFeeRate && itemFeeRate > 0 && itemFeeRate <= 1) {
              // 有单笔费率：还原原始金额
              todayIncome += amount / itemFeeRate
            } else {
              // 没有单笔费率：直接使用金额
              todayIncome += amount
            }
          }
        }
      }
      
      billsAgg.push({
        totalIncome: tIncome, // 这个账单的总入款
        todayIncome: todayIncome, // 🔥 今日入款（当日切日内的入款，累计模式使用）
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
    // 🔥 性能优化：单次遍历同时分类和统计，减少内存分配
    const dispatchByOperator: Record<string, number> = {}
    for (const item of selItems) {
      const amount = Number(item.amount) || 0
      if (item.type === 'INCOME') {
        const rate = Number(item.rate || 0) || undefined
        if (item.replier) incomeByReplier[item.replier] = (incomeByReplier[item.replier] || 0) + amount
        if (item.operator) incomeByOperator[item.operator] = (incomeByOperator[item.operator] || 0) + amount
        if (rate) incomeByRate[rate.toString()] = (incomeByRate[rate.toString()] || 0) + amount
      } else if (item.type === 'DISPATCH') {
        // 优先使用operator，如果没有则使用replier作为后备
        const operator = item.operator || item.replier || '未知'
        if (operator) dispatchByOperator[operator] = (dispatchByOperator[operator] || 0) + amount
      }
    }

    const selected = selectedBillAgg

    // 🔥 累计模式：每个账单独立计算自己的历史数据
    let carryOver = 0
    let historicalIncome = 0 // 🔥 历史入款（原始金额，用于显示）
    let cumulativeTotalIncome = selected.totalIncome // 默认等于今日入款（非累计模式）
    let billLabels: string[] = [] // 🔥 账单标签（用于显示"昨日第X笔订单"）
    
    if (isCumulativeMode) {
      try {
        // 🔥 计算当前选中账单的历史数据
        const selectedBill = billsData[selIdx]
        // 🔥 如果没有选中的账单，确保 carryOver 为 0
        if (!selectedBill) {
          carryOver = 0
        } else if (selectedBill) {
          // 🔥 累计模式：简单的"第X笔"标签
          billLabels = billsData.map((bill: any, idx: number) => {
            return `第 ${idx + 1} 笔`
          })
          
          // 🔥 查询当前账单之前的所有OPEN状态账单（用于计算历史未下发）
          const historicalBills = await prisma.bill.findMany({
            where: {
              chatId,
              openedAt: { lt: selectedBill.openedAt },
              status: 'OPEN' // 🔥 只查询OPEN状态的账单（未保存的）
            },
            select: { id: true },
            orderBy: { openedAt: 'asc' }
          })
          
          // 🔥 计算历史未下发：只使用未保存的历史账单
          if (historicalBills.length === 0) {
            carryOver = 0
            historicalIncome = 0
          } else {
            const historicalBillIds = historicalBills.map((b: any) => b.id)
            // 🔥 性能优化：一次性查询所有账单项，避免多次查询
            const historicalItems = await prisma.billItem.findMany({
              where: { billId: { in: historicalBillIds } },
              select: { type: true, amount: true, feeRate: true }
            })
            
            // 🔥 性能优化：使用单次遍历计算，避免多次filter和reduce
            let hTotalNetIncome = 0 // 扣除费率后的历史入款（用于计算未下发）
            let hTotalGrossIncome = 0 // 原始历史入款（用于显示）
            let hTotalDispatched = 0
            
            for (const item of historicalItems) {
              const amount = Number(item.amount) || 0
              if (item.type === 'INCOME') {
                const itemFeeRate = item.feeRate ? Number(item.feeRate) : null
                if (itemFeeRate && itemFeeRate > 0 && itemFeeRate <= 1) {
                  // 有单笔费率：amount已经是扣除费率后的
                  hTotalNetIncome += amount
                  hTotalGrossIncome += amount / itemFeeRate // 还原原始金额
                } else {
                  // 没有单笔费率：需要扣除费率
                  hTotalNetIncome += amount - (amount * (feePercent || 0)) / 100
                  hTotalGrossIncome += amount
                }
              } else if (item.type === 'DISPATCH') {
                hTotalDispatched += amount
              }
            }
            
            // 🔥 确保历史未下发不为负数（如果历史下发超过历史入款，则为0）
            carryOver = Math.max(0, hTotalNetIncome - hTotalDispatched)
            historicalIncome = hTotalGrossIncome
          }
        }
        
        // 🔥 累计模式：不需要计算累计总入款（已移除该功能）
        cumulativeTotalIncome = selected.totalIncome
      } catch (e) {
        console.error('[累计模式计算错误]', e)
      }
    } else {
      // 非累计模式，生成普通标签
      billLabels = billsData.map((_: any, idx: number) => `第 ${idx + 1} 笔`)
    }

    return Response.json({
      billNumber: billsAgg.length,
      bills: billsAgg,
      billLabels: billLabels, // 🔥 账单标签（用于显示"昨日第X笔订单"）
      ...selected,
      ...(isCumulativeMode
        ? {
            // 🔥 累计模式：返回这个账单的总入款和今日入款
            todayIncome: selected.todayIncome ?? selected.totalIncome, // 🔥 今日入款（当日切日内的入款）
            totalIncome: selected.totalIncome, // 🔥 这个账单的总入款金额（不是累计总入款）
            historicalIncome: historicalIncome, // 🔥 历史入款（原始金额，用于显示）
            shouldDispatch: (selected.shouldDispatch || 0) + carryOver, // 这个账单的应下发 + 历史未下发
            shouldDispatchUSDT: (selected.shouldDispatchUSDT || 0) + (selected.exchangeRate ? Number((carryOver / selected.exchangeRate).toFixed(2)) : 0),
            notDispatched: (selected.notDispatched || 0) + carryOver, // 这个账单的未下发 + 历史未下发
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
      // 🔥 累计模式：返回账单的开始和结束时间
      ...(isCumulativeMode && billsData[selIdx] ? {
        billStartTime: billsData[selIdx].openedAt.toISOString(),
        billEndTime: billsData[selIdx].status === 'OPEN' 
          ? new Date().toISOString() // 🔥 最新账单显示当前服务器时间
          : (billsData[selIdx].closedAt?.toISOString() || billsData[selIdx].openedAt.toISOString()), // 🔥 已保存账单显示closedAt
        hasPreviousBill: selIdx > 0, // 🔥 是否有上一笔账单
        hasNextBill: selIdx < billsData.length - 1, // 🔥 是否有下一笔账单
        totalBills: billsData.length, // 🔥 总账单数
      } : {}),
    })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
