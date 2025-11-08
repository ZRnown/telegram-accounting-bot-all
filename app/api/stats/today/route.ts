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
    // 🔥 累计模式：查询当天的所有账单（OPEN和CLOSED），包括已保存的账单
    // 🔥 同时查询昨日未保存的账单（OPEN状态），放在今日第一笔
    // 🔥 清零模式：只查询当天的OPEN账单
    const isCumulativeMode = settings?.accountingMode === 'CARRY_OVER'
    
    // 🔥 计算昨天的日期范围
    const yGte = new Date(gte)
    yGte.setDate(yGte.getDate() - 1)
    const yLt = new Date(gte) // 今天的开始就是昨天的结束
    
    // 🔥 查询昨日未保存的账单（OPEN状态）
    const yesterdayOpenBills = isCumulativeMode 
      ? await prisma.bill.findMany({
          where: { 
            chatId, 
            openedAt: { gte: yGte, lt: yLt },
            status: 'OPEN' // 🔥 只查询OPEN状态的，未保存的
          },
          select: { id: true, openedAt: true, status: true },
          orderBy: { openedAt: 'asc' }
        })
      : []
    
    // 🔥 查询当天的所有账单
    const todayBills = await prisma.bill.findMany({
      where: { 
        chatId, 
        openedAt: { gte, lt }, // 🔥 查询当天的所有账单
        ...(isCumulativeMode ? {} : { status: 'OPEN' }) // 🔥 累计模式：包括CLOSED状态；清零模式：只查询OPEN
      },
      select: { id: true, openedAt: true, status: true },
      orderBy: { openedAt: 'asc' }
    })
    
    // 🔥 合并账单：昨日未保存的账单放在最前面（今日第一笔）
    const billsData = [...yesterdayOpenBills, ...todayBills]

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
        // 🔥 计算当前选中账单的历史数据（昨天及之前的所有账单，但不包括已删除的）
        const selectedBill = billsData[selIdx]
        // 🔥 如果没有选中的账单，确保 carryOver 为 0
        if (!selectedBill) {
          carryOver = 0
        } else if (selectedBill) {
          // 计算昨天的日期范围（用于判断昨日未保存的账单）
          let yGteForLabel: Date
          if (dateStr) {
            const todayStart = startOfDateRange(dateStr, cutoffHour)
            yGteForLabel = new Date(todayStart)
            yGteForLabel.setDate(yGteForLabel.getDate() - 1)
          } else {
            yGteForLabel = new Date(gte)
            yGteForLabel.setDate(yGteForLabel.getDate() - 1)
          }
          const yLtForLabel = new Date(gte) // 今天的开始就是昨天的结束
          
          // 计算昨天的日期范围（用于历史数据计算）
          let yGte: Date
          if (dateStr) {
            const todayStart = startOfDateRange(dateStr, cutoffHour)
            yGte = new Date(todayStart)
            yGte.setDate(yGte.getDate() - 1)
          } else {
            yGte = new Date(gte)
            yGte.setDate(yGte.getDate() - 1)
          }
          const yLt = new Date(gte) // 今天的开始就是昨天的结束
          
          // 🔥 查询昨天的最后一笔账单（用于判断状态）- 性能优化：只查询最后一笔
          const lastYesterdayBill = await prisma.bill.findFirst({
            where: { 
              chatId, 
              openedAt: { gte: yGte, lt: yLt }
            },
            select: { id: true, openedAt: true, status: true },
            orderBy: { openedAt: 'desc' } // 🔥 降序排列，第一个就是最后一笔
          })
          
          // 🔥 判断昨天最后一笔账单的状态
          const shouldIncludeYesterday = lastYesterdayBill?.status === 'OPEN'
          
          // 🔥 查询历史账单：昨天及之前的所有账单
          // 🔥 如果昨天最后一笔是CLOSED，则不包括昨天的账单（因为昨天的账单已经保存，不计入历史未下发）
          // 🔥 如果是OPEN，则包括（因为昨天的账单未保存，需要计入历史未下发）
          // 🔥 但是历史入款应该始终显示（包括所有已保存和未保存的历史账单）
          const historicalBillsWhere: any = {
            chatId,
            openedAt: { lt: selectedBill.openedAt }
          }
          
          // 🔥 查询所有历史账单（用于计算历史入款）
          const allHistoricalBills = await prisma.bill.findMany({
            where: {
              chatId,
              openedAt: { lt: selectedBill.openedAt }
            },
            select: { id: true, openedAt: true, status: true },
            orderBy: { openedAt: 'asc' }
          })
          
          // 🔥 如果昨天最后一笔是CLOSED，排除昨天的账单（用于计算历史未下发）
          // 🔥 但历史入款仍然包括所有历史账单
          if (!shouldIncludeYesterday && lastYesterdayBill) {
            historicalBillsWhere.openedAt = { 
              lt: yGte // 只查询昨天之前的账单（用于计算历史未下发）
            }
          }
          
          const historicalBills = await prisma.bill.findMany({
            where: historicalBillsWhere,
            select: { id: true, openedAt: true, status: true },
            orderBy: { openedAt: 'asc' }
          })
          
          // 🔥 为每个账单生成标签（累计模式：显示开启日期，如果跨天了）
          const todayStart = dateStr ? startOfDateRange(dateStr, cutoffHour) : gte
          const todayEnd = dateStr ? endOfDateRange(dateStr, cutoffHour) : lt
          
          billLabels = billsData.map((bill: any, idx: number) => {
            const billDate = new Date(bill.openedAt)
            const currentTodayStart = new Date(todayStart)
            const currentTodayEnd = new Date(todayEnd)
            const isClosed = bill.status === 'CLOSED'
            
            // 🔥 判断是否是昨日未保存的账单（OPEN状态，且openedAt在昨天范围内）
            const isYesterdayOpen = !isClosed && billDate >= yGteForLabel && billDate < yLtForLabel
            
            // 🔥 累计模式：如果账单不在今天的日期范围内，显示开启日期
            if (billDate < currentTodayStart || billDate >= currentTodayEnd) {
              const billYear = billDate.getFullYear()
              const billMonth = billDate.getMonth() + 1
              const billDay = billDate.getDate()
              const nowYear = new Date().getFullYear()
              
              // 如果是今年，只显示月日；否则显示年月日
              const dateStr = billYear === nowYear 
                ? `${billMonth}月${billDay}日开启的`
                : `${billYear}年${billMonth}月${billDay}日开启的`
              
              // 🔥 昨日未保存的账单：显示"昨日第X笔订单"
              if (isYesterdayOpen) {
                return `昨日第${idx + 1}笔订单（未保存）`
              }
              
              return `${dateStr}第${idx + 1}笔订单${isClosed ? '（已保存）' : ''}`
            }
            
            // 今天的账单：显示"第X笔"，如果已保存则标注
            return `第 ${idx + 1} 笔${isClosed ? '（已保存）' : ''}`
          })
          
          // 🔥 计算历史入款：使用所有历史账单（包括已保存和未保存的）
          const allHistoricalBillIds = allHistoricalBills.map((b: any) => b.id)
          const allHistoricalItems = allHistoricalBillIds.length
            ? await prisma.billItem.findMany({
                where: { billId: { in: allHistoricalBillIds } },
                select: { type: true, amount: true, feeRate: true }
              })
            : []
          
          // 🔥 计算历史入款（原始金额，用于显示）
          let hTotalGrossIncome = 0
          for (const item of allHistoricalItems) {
            if (item.type === 'INCOME') {
              const amount = Number(item.amount) || 0
              const itemFeeRate = item.feeRate ? Number(item.feeRate) : null
              if (itemFeeRate && itemFeeRate > 0 && itemFeeRate <= 1) {
                // 有单笔费率：amount是扣除费率后的，需要还原原始金额
                hTotalGrossIncome += amount / itemFeeRate
              } else {
                // 没有单笔费率：直接使用金额
                hTotalGrossIncome += amount
              }
            }
          }
          historicalIncome = hTotalGrossIncome
          
          // 🔥 计算历史未下发：只使用未保存的历史账单（用于计算未下发）
          if (historicalBills.length === 0) {
            carryOver = 0
          } else {
            const historicalBillIds = historicalBills.map((b: any) => b.id)
            // 🔥 性能优化：一次性查询所有账单项，避免多次查询
            const historicalItems = await prisma.billItem.findMany({
              where: { billId: { in: historicalBillIds } },
              select: { type: true, amount: true, feeRate: true }
            })
            
            // 🔥 性能优化：使用单次遍历计算，避免多次filter和reduce
            let hTotalNetIncome = 0 // 扣除费率后的历史入款（用于计算未下发）
            let hTotalDispatched = 0
            
            for (const item of historicalItems) {
              const amount = Number(item.amount) || 0
              if (item.type === 'INCOME') {
                const itemFeeRate = item.feeRate ? Number(item.feeRate) : null
                if (itemFeeRate && itemFeeRate > 0 && itemFeeRate <= 1) {
                  hTotalNetIncome += amount // 已经是扣除费率后的
                } else {
                  hTotalNetIncome += amount - (amount * (feePercent || 0)) / 100
                }
              } else if (item.type === 'DISPATCH') {
                hTotalDispatched += amount
              }
            }
            
            // 🔥 确保历史未下发不为负数（如果历史下发超过历史入款，则为0）
            carryOver = Math.max(0, hTotalNetIncome - hTotalDispatched)
          }
        }
        
        // 🔥 计算累计总入款：从最早到现在所有的入款（包括今天）
        // 注意：已删除的账单不会出现在查询结果中，因为删除是物理删除
        const allBills = await prisma.bill.findMany({
          where: { chatId, openedAt: { lt } }, // 所有早于今天结束时间的账单（包含今天）
          select: { id: true },
          orderBy: { openedAt: 'asc' }
        })
        const allBillIds = allBills.map((b: any) => b.id)
        // 🔥 只查询存在的账单的账单项（已删除的账单项不会出现在查询结果中）
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
    })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
