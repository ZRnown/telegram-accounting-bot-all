// 数据库操作模块
import { prisma } from '../lib/db.ts'
import { getGlobalDailyCutoffHour, startOfDay, endOfDay } from './utils.js'

/**
 * 确保数据库中的聊天记录存在（简化版本）
 */
export async function ensureDbChat(ctx, chat = null) {
  const chatId = String(ctx.chat?.id)
  let title = ctx.chat?.title || null
  
  if (!title && ctx.chat?.type === 'private') {
    const u = ctx.chat
    title = u.username ? `@${u.username}` : [u.first_name, u.last_name].filter(Boolean).join(' ') || null
  }
  
  if (!chatId) return null
  
  // 并行执行 upsert 操作
  await Promise.all([
    prisma.chat.upsert({
      where: { id: chatId },
      update: { title },
      create: { id: chatId, title, status: 'PENDING', allowed: false },
    }),
    prisma.setting.upsert({
      where: { chatId },
      update: {},
      create: { chatId },
    })
  ])
  
  // 如果有 chat 对象，同步设置到内存
  if (chat) {
    await syncSettingsToMemory(ctx, chat, chatId)
  }
  
  return chatId
}

/**
 * 获取或创建当天的OPEN账单
 */
export async function getOrCreateTodayBill(chatId) {
  const cutoffHour = await getGlobalDailyCutoffHour()
  const now = new Date()
  const gte = startOfDay(now, cutoffHour)
  const lt = endOfDay(now, cutoffHour)
  
  let bill = await prisma.bill.findFirst({ 
    where: { chatId, status: 'OPEN', openedAt: { gte, lt } }, 
    orderBy: { openedAt: 'asc' } 
  })
  
  if (!bill) {
    bill = await prisma.bill.create({ 
      data: { 
        chatId, 
        status: 'OPEN', 
        openedAt: new Date(gte),
        savedAt: new Date() 
      } 
    })
  }
  
  return { bill, gte, lt }
}

/**
 * 更新设置
 */
export async function updateSettings(chatId, data) {
  return prisma.setting.update({ where: { chatId }, data })
}

/**
 * 同步设置和操作人到内存
 */
export async function syncSettingsToMemory(ctx, chat, chatId) {
  try {
    const [settings, needOperators] = await Promise.all([
      prisma.setting.findUnique({ 
        where: { chatId },
        select: {
          feePercent: true,
          fixedRate: true,
          realtimeRate: true,
          headerText: true,
          everyoneAllowed: true
        }
      }),
      chat ? (async () => {
        const lastSyncTime = chat._operatorsLastSync || 0
        const now = Date.now()
        return (now - lastSyncTime > 5 * 60 * 1000 || chat.operators.size === 0)
      })() : Promise.resolve(false)
    ])
    
    if (settings && chat) {
      if (typeof settings.feePercent === 'number') chat.feePercent = settings.feePercent
      if (settings.fixedRate != null) chat.fixedRate = settings.fixedRate
      if (settings.realtimeRate != null) chat.realtimeRate = settings.realtimeRate
      if (settings.headerText != null) chat.headerText = settings.headerText
      if (typeof settings.everyoneAllowed === 'boolean') chat.everyoneAllowed = settings.everyoneAllowed
    }
    
    if (chat && needOperators) {
      const operators = await prisma.operator.findMany({ where: { chatId }, select: { username: true } })
      chat.operators.clear()
      for (const op of operators) {
        chat.operators.add(op.username)
      }
      chat._operatorsLastSync = Date.now()
    }
  } catch (e) {
    console.error('同步设置到内存失败', e)
  }
}

/**
 * 计算历史未下发金额（用于累计模式）
 */
export async function getHistoricalNotDispatched(chatId, settings) {
  try {
    if (settings?.accountingMode !== 'CARRY_OVER') {
      return { notDispatched: 0, notDispatchedUSDT: 0 }
    }

    const cutoffHour = await getGlobalDailyCutoffHour()
    const today = startOfDay(new Date(), cutoffHour)
    
    const historicalBills = await prisma.bill.findMany({
      where: { chatId, openedAt: { lt: today } },
      include: { 
        items: {
          select: { type: true, amount: true, rate: true }
        }
      },
      orderBy: { openedAt: 'asc' }
    })

    const feePercent = settings?.feePercent ?? 0
    const fixedRate = settings?.fixedRate ?? null
    const realtimeRate = settings?.realtimeRate ?? null

    let totalHistoricalIncome = 0
    let totalHistoricalDispatch = 0
    let totalHistoricalIncomeUSDT = 0
    let totalHistoricalDispatchUSDT = 0

    for (const bill of historicalBills) {
      const incomes = bill.items.filter(i => i.type === 'INCOME')
      const dispatches = bill.items.filter(i => i.type === 'DISPATCH')

      const billIncome = incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0)
      const billDispatch = dispatches.reduce((s, d) => s + (Number(d.amount) || 0), 0)

      let rate = fixedRate ?? realtimeRate ?? 0
      if (!rate) {
        const lastIncWithRate = [...incomes].reverse().find(i => i.rate && i.rate > 0)
        if (lastIncWithRate?.rate) rate = Number(lastIncWithRate.rate)
      }

      const fee = (billIncome * feePercent) / 100
      const shouldDispatch = billIncome - fee
      const shouldDispatchUSDT = rate ? Number((shouldDispatch / rate).toFixed(2)) : 0

      totalHistoricalIncome += shouldDispatch
      totalHistoricalDispatch += billDispatch
      totalHistoricalIncomeUSDT += shouldDispatchUSDT
      totalHistoricalDispatchUSDT += rate ? Number((billDispatch / rate).toFixed(2)) : 0
    }

    const notDispatched = totalHistoricalIncome - totalHistoricalDispatch
    const notDispatchedUSDT = totalHistoricalIncomeUSDT - totalHistoricalDispatchUSDT

    return { notDispatched, notDispatchedUSDT }
  } catch (e) {
    console.error('计算历史未下发金额失败', e)
    return { notDispatched: 0, notDispatchedUSDT: 0 }
  }
}

/**
 * 删除最后一条入款记录
 */
export async function deleteLastIncome(chatId) {
  const { bill } = await getOrCreateTodayBill(chatId)
  if (!bill) return false
  
  const lastItem = await prisma.billItem.findFirst({
    where: { billId: bill.id, type: 'INCOME' },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!lastItem) return false
  
  await prisma.billItem.delete({ where: { id: lastItem.id } })
  return { amount: Number(lastItem.amount), rate: lastItem.rate ? Number(lastItem.rate) : undefined }
}

/**
 * 删除最后一条下发记录
 */
export async function deleteLastDispatch(chatId) {
  const { bill } = await getOrCreateTodayBill(chatId)
  if (!bill) return false
  
  const lastItem = await prisma.billItem.findFirst({
    where: { billId: bill.id, type: 'DISPATCH' },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!lastItem) return false
  
  await prisma.billItem.delete({ where: { id: lastItem.id } })
  return { amount: Number(lastItem.amount), usdt: lastItem.usdt ? Number(lastItem.usdt) : 0 }
}

