import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

// 计算历史未下发金额（用于累计模式）
async function getHistoricalNotDispatched(chatId: string, billOpenedAt: Date) {
  try {
    const today = new Date(billOpenedAt)
    today.setHours(0, 0, 0, 0)
    
    const historicalBills = await prisma.bill.findMany({
      where: { 
        chatId, 
        openedAt: { lt: today }
      },
      include: {
        items: {
          select: {
            type: true,
            amount: true,
            rate: true
          }
        }
      },
      orderBy: { openedAt: 'asc' }
    })
    
    let totalHistoricalIncome = 0
    let totalHistoricalDispatch = 0
    let totalHistoricalIncomeUSDT = 0
    let totalHistoricalDispatchUSDT = 0
    
    for (const bill of historicalBills) {
      const incomes = bill.items.filter((i: any) => i.type === 'INCOME')
      const dispatches = bill.items.filter((i: any) => i.type === 'DISPATCH')
      
      const billIncome = incomes.reduce((s: number, i: any) => s + Number(i.amount || 0), 0)
      const billDispatch = dispatches.reduce((s: number, d: any) => s + Number(d.amount || 0), 0)
      
      totalHistoricalIncome += billIncome
      totalHistoricalDispatch += billDispatch
      
      // 计算USDT（使用每笔的汇率或最后一笔的汇率）
      for (const i of incomes) {
        if (i.rate && i.rate > 0) {
          totalHistoricalIncomeUSDT += Number(i.amount || 0) / Number(i.rate)
        }
      }
      for (const d of dispatches) {
        if (d.rate && d.rate > 0) {
          totalHistoricalDispatchUSDT += Number(d.amount || 0) / Number(d.rate)
        }
      }
    }
    
    return {
      historicalIncome: totalHistoricalIncome,
      historicalDispatch: totalHistoricalDispatch,
      historicalNotDispatched: totalHistoricalIncome - totalHistoricalDispatch,
      historicalNotDispatchedUSDT: totalHistoricalIncomeUSDT - totalHistoricalDispatchUSDT
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
    
    if (!effectiveRate) {
      const lastIncWithRate = [...incomes].reverse().find((x: any) => x.rate && x.rate > 0)
      if (lastIncWithRate?.rate) effectiveRate = Number(lastIncWithRate.rate)
    }
    
    const fee = (totalIncome * feePercent) / 100
    const shouldDispatch = totalIncome - fee
    const shouldDispatchUSDT = effectiveRate ? Number((shouldDispatch / effectiveRate).toFixed(1)) : 0
    const dispatchedUSDT = effectiveRate ? Number((totalDispatch / effectiveRate).toFixed(1)) : 0
    const notDispatched = shouldDispatch - totalDispatch
    const notDispatchedUSDT = effectiveRate ? Number((notDispatched / effectiveRate).toFixed(1)) : 0

    // 🔥 如果是累计模式，计算历史未下发
    let historicalData = null
    const isCumulativeMode = settings?.accountingMode === 'CARRY_OVER'
    
    if (isCumulativeMode) {
      historicalData = await getHistoricalNotDispatched(bill.chatId, bill.openedAt)
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
