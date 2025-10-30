import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = params.id
    const bill = await prisma.bill.findUnique({ where: { id } })
    if (!bill) return new Response('Not Found', { status: 404 })
    const items = await prisma.billItem.findMany({ where: { billId: id }, orderBy: { createdAt: 'asc' } })

    // 汇总
    const incomes = items.filter((i) => i.type === 'INCOME')
    const dispatches = items.filter((i) => i.type === 'DISPATCH')
    const totalIncome = incomes.reduce((s: number, i: { amount: number }) => s + i.amount, 0)
    const totalDispatch = dispatches.reduce((s: number, d: { amount: number }) => s + d.amount, 0)

    return Response.json({ bill, items, summary: { totalIncome, totalDispatch, incomeCount: incomes.length, dispatchCount: dispatches.length } })
  } catch (e) {
    console.error(e)
    return new Response('Server error', { status: 500 })
  }
}
