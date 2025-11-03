// 数据库操作模块
import { prisma } from '../lib/db.ts'
import { getGlobalDailyCutoffHour, startOfDay, endOfDay } from './utils.js'

/**
 * 🔥 统一的日期计算函数（导出供其他模块使用）
 */
export function calculateBillDateRange(now, cutoffHour) {
  const currentDate = new Date(now)
  const currentHour = currentDate.getHours()
  
  const billDate = new Date(currentDate)
  if (currentHour < cutoffHour) {
    billDate.setDate(billDate.getDate() - 1)
  }
  
  const gte = new Date(billDate)
  gte.setHours(cutoffHour, 0, 0, 0, 0)
  
  const lt = new Date(gte)
  lt.setDate(lt.getDate() + 1)
  
  return { gte, lt, billDate }
}

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
    const todayStart = new Date()
    todayStart.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
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
 * 🔥 重写：获取或创建当前账单
 * 确保记账到正确的日期范围，自动处理日切
 */
export async function getOrCreateTodayBill(chatId) {
  const cutoffHour = await getGlobalDailyCutoffHour()
  const now = new Date()
  const { gte, lt, billDate } = calculateBillDateRange(now, cutoffHour)
  
  if (process.env.DEBUG_BOT === 'true') {
    console.log('[getOrCreateTodayBill]', {
      chatId,
      now: now.toISOString(),
      currentHour: now.getHours(),
      cutoffHour,
      billDate: billDate.toISOString(),
      gte: gte.toISOString(),
      lt: lt.toISOString(),
      '账单范围': `${gte.toLocaleString('zh-CN')} - ${lt.toLocaleString('zh-CN')}`
    })
  }
  
  // 查找当前日期范围内的OPEN账单
  let bill = await prisma.bill.findFirst({ 
    where: { 
      chatId, 
      status: 'OPEN', 
      openedAt: { gte, lt } 
    }, 
    orderBy: { openedAt: 'asc' } 
  })
  
  if (!bill) {
    // 如果当前日期范围内没有OPEN账单，创建新的
    bill = await prisma.bill.create({ 
      data: { 
        chatId, 
        status: 'OPEN', 
        openedAt: new Date(gte),
        savedAt: new Date() 
      } 
    })
    if (process.env.DEBUG_BOT === 'true') {
      console.log('[getOrCreateTodayBill] 创建新账单', { 
        billId: bill.id, 
        openedAt: bill.openedAt.toISOString(),
        billDate: billDate.toISOString()
      })
    }
  }
  
  return { bill, gte, lt, billDate }
}

/**
 * 更新设置
 */
export async function updateSettings(chatId, data) {
  return prisma.setting.update({ where: { chatId }, data })
}

/**
 * 🔥 重写：同步设置和操作人到内存
 * 确保实时汇率优先从数据库加载（启动时已更新）
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
      // 同步费率
      if (typeof settings.feePercent === 'number') chat.feePercent = settings.feePercent
      
      // 同步汇率：固定汇率优先
      if (settings.fixedRate != null) {
        chat.fixedRate = settings.fixedRate
        chat.realtimeRate = null // 有固定汇率时清空实时汇率
      } else {
        // 🔥 重点：如果没有固定汇率，优先从数据库加载实时汇率
        if (settings.realtimeRate != null) {
          chat.realtimeRate = settings.realtimeRate
          chat.fixedRate = null
          if (process.env.DEBUG_BOT === 'true') {
            console.log('[syncSettingsToMemory] ✅ 实时汇率已同步到内存', { 
              chatId, 
              rate: settings.realtimeRate 
            })
          }
        }
      }
      
      // 同步其他设置
      if (settings.headerText != null) chat.headerText = settings.headerText
      if (typeof settings.everyoneAllowed === 'boolean') chat.everyoneAllowed = settings.everyoneAllowed
    }
    
    // 同步操作员列表
    if (chat && needOperators) {
      const operators = await prisma.operator.findMany({ 
        where: { chatId }, 
        select: { username: true } 
      })
      chat.operators.clear()
      for (const op of operators) {
        chat.operators.add(op.username)
      }
      chat._operatorsLastSync = Date.now()
    }
  } catch (e) {
    console.error('[syncSettingsToMemory] ❌ 同步失败', e)
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
 * 🔥 重写：自动日切检查
 * 检查所有群组，关闭昨天的账单，清空内存数据，为今天的新账单做准备
 * @param {function} getChat - 获取聊天对象的函数 (botId, chatId) => chat
 * @returns {Promise<number>} - 处理的群组数量
 */
export async function performAutoDailyCutoff(getChat) {
  try {
    const cutoffHour = await getGlobalDailyCutoffHour()
    const now = new Date()
    
    // 计算今天的开始时间（今天的日切点）
    const todayStart = new Date(now)
    todayStart.setHours(cutoffHour, 0, 0, 0, 0)
    // 如果当前时间在日切点之前，todayStart应该是昨天的日切点
    if (now.getHours() < cutoffHour) {
      todayStart.setDate(todayStart.getDate() - 1)
    }
    
    // 查找所有在todayStart之前还有OPEN账单的群组
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
    
    if (yesterdayBillsGrouped.length === 0) {
      return 0
    }
    
    // 批量查询所有群组的设置
    const chatIds = yesterdayBillsGrouped.map(g => g.chatId)
    const allSettings = await prisma.setting.findMany({
      where: { chatId: { in: chatIds } },
      select: { chatId: true, accountingMode: true }
    })
    const settingsMap = new Map(allSettings.map(s => [s.chatId, s]))
    
    let processedCount = 0
    
    for (const group of yesterdayBillsGrouped) {
      try {
        const chatId = group.chatId
        const settings = settingsMap.get(chatId)
        const accountingMode = settings?.accountingMode || 'DAILY_RESET'
        
        // 只有每日清零模式才需要关闭昨天的账单
        if (accountingMode === 'DAILY_RESET') {
          // 查找所有需要关闭的账单
          const billsToClose = await prisma.bill.findMany({
            where: {
              chatId,
              status: 'OPEN',
              openedAt: { lt: todayStart }
            },
            select: { id: true }
          })
          
          if (billsToClose.length > 0) {
            const billIds = billsToClose.map(b => b.id)
            
            // 批量关闭账单
            await prisma.bill.updateMany({
              where: { id: { in: billIds } },
              data: {
                status: 'CLOSED',
                savedAt: new Date(),
                closedAt: new Date()
              }
            })
            
            // 清空内存中的数据
            if (getChat && typeof getChat === 'function') {
              try {
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
                // 忽略内存清理失败
              }
            }
            
            processedCount++
            console.log(`[自动日切] ✅ 群组 ${chatId}：已关闭 ${billsToClose.length} 个昨日账单`)
          }
        }
      } catch (e) {
        console.error(`[自动日切] ❌ 处理群组 ${group.chatId} 失败:`, e)
      }
    }
    
    if (processedCount > 0) {
      console.log(`[自动日切] 📊 完成，共处理 ${processedCount} 个群组`)
    }
    
    return processedCount
  } catch (e) {
    console.error('[自动日切] ❌ 执行失败:', e)
    return 0
  }
}

