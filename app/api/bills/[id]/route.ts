import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

// 🔥 计算历史未下发金额（用于累计模式）- 每个账单独立计算自己的历史数据
async function getHistoricalNotDispatched(chatId: string, billOpenedAt: Date, feePercent: number = 0) {
  try {
    // 🔥 查询早于当前账单的所有账单（OPEN和CLOSED状态，不包括已删除的）
    const historicalBills = await prisma.bill.findMany({
      where: { 
        chatId, 
        openedAt: { lt: billOpenedAt } // 早于当前账单的所有账单
      },
      include: {
        items: {
          select: {
            type: true,
            amount: true,
            rate: true,
            feeRate: true // 🔥 添加费率字段
          }
        }
      },
      orderBy: { openedAt: 'asc' }
    })
    
    let totalHistoricalNetIncome = 0 // 扣除费率后的历史入款
    let totalHistoricalDispatch = 0
    
    for (const bill of historicalBills) {
      const incomes = bill.items.filter((i: any) => i.type === 'INCOME')
      const dispatches = bill.items.filter((i: any) => i.type === 'DISPATCH')
      
      // 🔥 计算历史入款（考虑单笔费率）
      for (const inc of incomes) {
        const amount = Number(inc.amount || 0)
        const itemFeeRate = inc.feeRate ? Number(inc.feeRate) : null
        if (itemFeeRate && itemFeeRate > 0 && itemFeeRate <= 1) {
          totalHistoricalNetIncome += amount // 已经是扣除费率后的
        } else {
          totalHistoricalNetIncome += amount - (amount * (feePercent || 0)) / 100
        }
      }
      
      const billDispatch = dispatches.reduce((s: number, d: any) => s + Number(d.amount || 0), 0)
      totalHistoricalDispatch += billDispatch
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
      historicalData = await getHistoricalNotDispatched(bill.chatId, bill.openedAt, feePercent)
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
