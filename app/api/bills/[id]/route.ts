import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

// 🔥 计算历史未下发金额（用于累计模式）- 每个账单独立计算自己的历史数据
async function getHistoricalNotDispatched(chatId: string, billOpenedAt: Date, feePercent: number = 0, cutoffHour: number = 0) {
  try {
    // 🔥 计算昨天的日期范围（用于判断昨天最后一笔账单的状态）
    const todayCutoff = new Date(billOpenedAt)
    todayCutoff.setHours(cutoffHour, 0, 0, 0)
    const yGte = new Date(todayCutoff)
    yGte.setDate(yGte.getDate() - 1)
    const yLt = new Date(todayCutoff)
    
    // 🔥 查询昨天的最后一笔账单（用于判断状态）
    const yesterdayBills = await prisma.bill.findMany({
      where: { 
        chatId, 
        openedAt: { gte: yGte, lt: yLt }
      },
      select: { id: true, openedAt: true, status: true },
      orderBy: { openedAt: 'desc' },
      take: 1 // 🔥 性能优化：只查询最后一笔
    })
    
    // 🔥 判断昨天最后一笔账单的状态
    const lastYesterdayBill = yesterdayBills.length > 0 ? yesterdayBills[0] : null
    const shouldIncludeYesterday = lastYesterdayBill?.status === 'OPEN'
    
    // 🔥 查询历史账单：只包括OPEN状态的账单（未保存的）
    // 🔥 不包括CLOSED状态的账单（已保存的）
    const historicalBillsWhere: any = {
      chatId,
      status: 'OPEN', // 🔥 只查询OPEN状态的账单（未保存的）
      openedAt: { lt: billOpenedAt }
    }
    
    if (!shouldIncludeYesterday && lastYesterdayBill) {
      historicalBillsWhere.openedAt = { lt: yGte }
    }
    
    // 🔥 性能优化：先查询账单ID，再批量查询账单项，避免N+1查询
    const historicalBills = await prisma.bill.findMany({
      where: historicalBillsWhere,
      select: { id: true },
      orderBy: { openedAt: 'asc' }
    })
    
    if (historicalBills.length === 0) {
      return {
        historicalIncome: 0,
        historicalDispatch: 0,
        historicalNotDispatched: 0,
        historicalNotDispatchedUSDT: 0
      }
    }
    
    const historicalBillIds = historicalBills.map((b: any) => b.id)
    
    // 🔥 性能优化：一次性查询所有账单项，避免N+1查询
    const historicalItems = await prisma.billItem.findMany({
      where: { billId: { in: historicalBillIds } },
      select: {
        type: true,
        amount: true,
        feeRate: true
      }
    })
    
    // 🔥 性能优化：使用单次遍历计算，避免多次filter和reduce
    let totalHistoricalNetIncome = 0
    let totalHistoricalDispatch = 0
    
    for (const item of historicalItems) {
      const amount = Number(item.amount || 0)
      if (item.type === 'INCOME') {
        const itemFeeRate = item.feeRate ? Number(item.feeRate) : null
        if (itemFeeRate && itemFeeRate > 0 && itemFeeRate <= 1) {
          totalHistoricalNetIncome += amount
        } else {
          totalHistoricalNetIncome += amount - (amount * (feePercent || 0)) / 100
        }
      } else if (item.type === 'DISPATCH') {
        totalHistoricalDispatch += amount
      }
    }
    
    const historicalNotDispatched = Math.max(totalHistoricalNetIncome - totalHistoricalDispatch, 0)
    
    return {
      historicalIncome: totalHistoricalNetIncome,
      historicalDispatch: totalHistoricalDispatch,
      historicalNotDispatched: historicalNotDispatched,
      historicalNotDispatchedUSDT: 0 // USDT计算在调用处处理
    }
  } catch (e) {
    console.error('计算历史未下发失败', e)
    return {
      historicalIncome: 0,
      historicalDispatch: 0,
      historicalNotDispatched: 0,
      historicalNotDispatchedUSDT: 0
    }
  }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = params.id
    const bill = await prisma.bill.findUnique({ where: { id } })
    if (!bill) return new Response('Not Found', { status: 404 })
    
    // 🔥 内存优化：只选择必要的字段
    const items = await prisma.billItem.findMany({
      where: { billId: id },
      select: {
        id: true,
        type: true,
        amount: true,
        rate: true,
        usdt: true,
        feeRate: true, // 🔥 添加费率字段
        remark: true, // 🔥 添加备注字段
        replier: true,
        operator: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' }
    })

    // 获取群组设置（判断是否累计模式）
    const settings = await prisma.setting.findUnique({
      where: { chatId: bill.chatId },
      select: {
        accountingMode: true,
        feePercent: true,
        fixedRate: true,
        realtimeRate: true,
        dailyCutoffHour: true, // 🔥 添加日切时间字段
      }
    })

    // 汇总（🔥 修复：支持负数入账）
    const incomes = items.filter((i: any) => i.type === 'INCOME')
    const dispatches = items.filter((i: any) => i.type === 'DISPATCH')
    const totalIncome = incomes.reduce((s: number, i: any) => s + Number(i.amount || 0), 0)
    const totalDispatch = dispatches.reduce((s: number, d: any) => s + Number(d.amount || 0), 0)
    
    // 计算汇率和USDT
    const feePercent = settings?.feePercent ?? 0
    const fixedRate = settings?.fixedRate
    const realtimeRate = settings?.realtimeRate
    let effectiveRate = fixedRate ?? realtimeRate ?? 0
    
    if (!effectiveRate && incomes.length > 0) {
      // 🔥 性能优化：从后往前查找，不需要reverse整个数组
      for (let i = incomes.length - 1; i >= 0; i--) {
        if (incomes[i].rate && Number(incomes[i].rate) > 0) {
          effectiveRate = Number(incomes[i].rate)
          break
        }
      }
    }
    
    const fee = (totalIncome * feePercent) / 100
    const shouldDispatch = totalIncome - fee
    const shouldDispatchUSDT = effectiveRate ? Number((shouldDispatch / effectiveRate).toFixed(1)) : 0
    const dispatchedUSDT = effectiveRate ? Number((totalDispatch / effectiveRate).toFixed(1)) : 0
    const notDispatched = shouldDispatch - totalDispatch
    const notDispatchedUSDT = effectiveRate ? Number((notDispatched / effectiveRate).toFixed(1)) : 0

    // 🔥 如果是累计模式，计算历史未下发（每个账单独立计算）
    let historicalData = null
    const isCumulativeMode = settings?.accountingMode === 'CARRY_OVER'
    
    if (isCumulativeMode) {
      // 🔥 获取日切时间（优先使用群组级别，否则使用全局配置）
      let cutoffHour = 0
      if (settings?.dailyCutoffHour != null && settings.dailyCutoffHour >= 0 && settings.dailyCutoffHour <= 23) {
        cutoffHour = settings.dailyCutoffHour
      } else {
        // 查询全局配置
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
          console.error('查询全局日切时间失败:', e)
        }
      }
      
      historicalData = await getHistoricalNotDispatched(bill.chatId, bill.openedAt, feePercent, cutoffHour)
      // 🔥 计算USDT
      if (effectiveRate > 0 && historicalData.historicalNotDispatched > 0) {
        historicalData.historicalNotDispatchedUSDT = Number((historicalData.historicalNotDispatched / effectiveRate).toFixed(2))
      }
    }

    return Response.json({
      bill,
      items,
      settings: {
        accountingMode: settings?.accountingMode ?? 'DAILY_RESET',
        feePercent,
        effectiveRate,
      },
      summary: {
        totalIncome,
        totalDispatch,
        incomeCount: incomes.length,
        dispatchCount: dispatches.length,
        shouldDispatch,
        shouldDispatchUSDT,
        dispatchedUSDT,
        notDispatched,
        notDispatchedUSDT,
        fee,
      },
      // 🔥 累计模式数据
      ...(isCumulativeMode && historicalData ? {
        cumulative: {
          todayIncome: totalIncome,
          historicalNotDispatched: historicalData.historicalNotDispatched,
          historicalNotDispatchedUSDT: Number(historicalData.historicalNotDispatchedUSDT.toFixed(1)),
          totalShouldDispatch: shouldDispatch + historicalData.historicalNotDispatched,
          totalShouldDispatchUSDT: Number((shouldDispatchUSDT + historicalData.historicalNotDispatchedUSDT).toFixed(1)),
          totalNotDispatched: notDispatched + historicalData.historicalNotDispatched,
          totalNotDispatchedUSDT: Number((notDispatchedUSDT + historicalData.historicalNotDispatchedUSDT).toFixed(1)),
        }
      } : {})
    })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
