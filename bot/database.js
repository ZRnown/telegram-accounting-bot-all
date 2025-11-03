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
 * 检查并处理跨日情况（如果是每日清零模式，清空内存数据）
 * @param {object} chat - 内存中的聊天对象
 * @param {string} chatId - 聊天ID
 * @returns {Promise<boolean>} - 如果跨日返回true
 */
export async function checkAndClearIfNewDay(chat, chatId) {
  try {
    if (!chat || !chatId) return false
    
    const settings = await prisma.setting.findUnique({
      where: { chatId },
      select: { accountingMode: true }
    })
    
    const accountingMode = settings?.accountingMode || 'DAILY_RESET'
    
    // 只有每日清零模式才需要清空内存数据
    if (accountingMode !== 'DAILY_RESET') return false
    
    const cutoffHour = await getGlobalDailyCutoffHour()
    const now = new Date()
    
    // 🔥 修复：基于当前本地日期计算今天的日切开始时间，与 getOrCreateTodayBill 保持一致
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const todayStr = `${year}-${month}-${day}` // 使用本地日期 YYYY-MM-DD
    const todayStart = new Date(todayStr + 'T00:00:00')
    todayStart.setHours(cutoffHour, 0, 0, 0)
    
    // 检查最后同步的日期（如果有）
    const lastBillDate = chat._lastBillDate
    if (!lastBillDate) {
      // 首次使用，记录今天的日期
      chat._lastBillDate = todayStart.getTime()
      return false
    }
    
    // 检查是否跨日
    const lastDate = new Date(lastBillDate)
    const isNewDay = todayStart.getTime() > lastDate.getTime()
    
    if (isNewDay) {
      // 跨日了，清空内存中的当前账单数据
      chat.current.incomes = []
      chat.current.dispatches = []
      chat._billLastSync = 0 // 清除同步标记，强制重新同步
      chat._lastBillDate = todayStart.getTime()
      console.log(`[日切检查] 检测到跨日，已清空内存数据`, { chatId, lastDate: lastDate.toISOString(), today: todayStart.toISOString() })
      return true
    }
    
    return false
  } catch (e) {
    console.error('[checkAndClearIfNewDay] 检查跨日失败', e)
    return false
  }
}

/**
 * 获取或创建当天的OPEN账单
 * 🔥 修复：使用当前日期的日切时间范围，而不是根据当前时间判断
 * 这样即使在日切点之前记账，也会归入当天的账单
 */
export async function getOrCreateTodayBill(chatId) {
  const cutoffHour = await getGlobalDailyCutoffHour()
  const now = new Date()
  
  // 🔥 修复：基于当前本地日期计算今天的日切范围，使用本地时区而不是UTC
  // 例如：3号凌晨1点记账，应该归入3号的账单（3号2点-4号2点），而不是2号
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const todayStr = `${year}-${month}-${day}` // 使用本地日期 YYYY-MM-DD
  const gte = new Date(todayStr + 'T00:00:00')
  gte.setHours(cutoffHour, 0, 0, 0)
  const lt = new Date(gte)
  lt.setDate(lt.getDate() + 1)
  
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

/**
 * 🔥 自动日切检查：检查并关闭昨天的账单，确保数据正确保存
 * 这个函数会检查所有有OPEN账单的群组，如果检测到跨日，则关闭昨天的账单
 * @param {function} getChat - 获取聊天对象的函数 (botId, chatId) => chat
 * @returns {Promise<number>} - 处理的群组数量
 */
export async function performAutoDailyCutoff(getChat) {
  try {
    const cutoffHour = await getGlobalDailyCutoffHour()
    const now = new Date()
    const todayStart = startOfDay(now, cutoffHour)
    const yesterdayEnd = new Date(todayStart)
    yesterdayEnd.setTime(yesterdayEnd.getTime() - 1) // 昨天的最后一刻
    
    // 查找所有昨天还有OPEN账单的群组（使用groupBy获取唯一的chatId）
    const yesterdayBillsGrouped = await prisma.bill.groupBy({
      by: ['chatId'],
      where: {
        status: 'OPEN',
        openedAt: { lt: todayStart }
      },
      _count: {
        id: true
      }
    })
    
    // 转换为简单数组格式
    const yesterdayBills = yesterdayBillsGrouped.map(g => ({ chatId: g.chatId }))
    
    if (yesterdayBills.length === 0) {
      return 0
    }
    
    // 🔥 性能优化：批量查询所有群组的设置，避免N+1查询问题
    const chatIds = yesterdayBills.map(b => b.chatId)
    const allSettings = await prisma.setting.findMany({
      where: { chatId: { in: chatIds } },
      select: { chatId: true, accountingMode: true }
    })
    const settingsMap = new Map(allSettings.map(s => [s.chatId, s]))
    
    let processedCount = 0
    
    for (const bill of yesterdayBills) {
      try {
        const chatId = bill.chatId
        
        // 🔥 从缓存中获取设置，避免重复查询
        const settings = settingsMap.get(chatId)
        const accountingMode = settings?.accountingMode || 'DAILY_RESET'
        
        // 只有每日清零模式才需要关闭昨天的账单
        if (accountingMode === 'DAILY_RESET') {
          // 查找所有昨天的OPEN账单并关闭它们
          const billsToClose = await prisma.bill.findMany({
            where: {
              chatId,
              status: 'OPEN',
              openedAt: { lt: todayStart }
            }
          })
          
          // 🔥 性能优化：批量更新账单状态，而不是逐个更新
          if (billsToClose.length > 0) {
            const billIds = billsToClose.map(b => b.id)
            await prisma.bill.updateMany({
              where: { id: { in: billIds } },
              data: {
                status: 'CLOSED',
                savedAt: new Date()
              }
            })
          }
          
          // 如果有内存中的聊天对象，清空其内存数据
          // 注意：这里无法直接访问state，需要通过回调函数
          if (getChat && typeof getChat === 'function') {
            try {
              // getChat 函数的签名是 (botId, chatId) => chat
              // 这里需要传入botId，但我们在定时任务中无法直接获取，所以先尝试用 BOT_TOKEN
              const botId = process.env.BOT_TOKEN
              if (botId) {
                const chat = getChat(botId, chatId)
                if (chat) {
                  chat.current.incomes = []
                  chat.current.dispatches = []
                  chat._billLastSync = 0
                  chat._lastBillDate = todayStart.getTime()
                }
              }
            } catch (e) {
              // 如果获取失败，忽略（可能是群组不在内存中）
            }
          }
          
          processedCount++
          console.log(`[自动日切] 已关闭群组 ${chatId} 的昨日账单，共 ${billsToClose.length} 个账单`)
        }
      } catch (e) {
        console.error(`[自动日切] 处理群组 ${bill.chatId} 失败:`, e)
      }
    }
    
    if (processedCount > 0) {
      console.log(`[自动日切] 完成，共处理 ${processedCount} 个群组的日切`)
    }
    
    return processedCount
  } catch (e) {
    console.error('[自动日切] 执行失败:', e)
    return 0
  }
}

