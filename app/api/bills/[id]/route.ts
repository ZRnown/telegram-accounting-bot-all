import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

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
    })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = params.id
    const bill = await prisma.bill.findUnique({ where: { id }, select: { id: true, chatId: true, status: true } })
    if (!bill) return new Response('Not Found', { status: 404 })
    
    // 🔥 删除账单和所有账单项（使用事务确保原子性）
    await prisma.$transaction(async (tx: any) => {
      await tx.billItem.deleteMany({ where: { billId: id } })
      await tx.bill.delete({ where: { id } })
    })
    
    return new Response(null, { status: 204 })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
