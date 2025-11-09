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
      create: { chatId, accountingEnabled: true }, // 🔥 默认开启记账
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
      select: { accountingMode: true, dailyCutoffHour: true }
    })
    
    const accountingMode = settings?.accountingMode || 'DAILY_RESET'
    
    // 只有每日清零模式才需要清空内存数据
    if (accountingMode !== 'DAILY_RESET') return false
    
    // 🔥 修复：优先使用群组级别的日切时间，与 getOrCreateTodayBill 保持一致
    const cutoffHour = settings?.dailyCutoffHour != null && settings.dailyCutoffHour >= 0 && settings.dailyCutoffHour <= 23
      ? settings.dailyCutoffHour
      : await getGlobalDailyCutoffHour()
    
    const now = new Date()
    
    // 🔥 修复：使用与 getOrCreateTodayBill 相同的日切逻辑计算当前账单周期的开始时间
    const todayCutoff = new Date()
    todayCutoff.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
    todayCutoff.setHours(cutoffHour, 0, 0, 0)
    
    let currentBillStart
    if (now >= todayCutoff) {
      // 当前时间 >= 今天的日切时间，使用今天的日切时间
      currentBillStart = new Date(todayCutoff)
    } else {
      // 当前时间 < 今天的日切时间，使用昨天的日切时间
      currentBillStart = new Date(todayCutoff)
      currentBillStart.setDate(currentBillStart.getDate() - 1)
    }
    
    // 检查最后同步的日期（如果有）
    const lastBillDate = chat._lastBillDate
    if (!lastBillDate) {
      // 首次使用，记录当前账单周期的开始时间
      chat._lastBillDate = currentBillStart.getTime()
      return false
    }
    
    // 检查是否跨日（进入新的账单周期）
    const lastDate = new Date(lastBillDate)
    const isNewDay = currentBillStart.getTime() > lastDate.getTime()
    
    if (isNewDay) {
      // 跨日了，清空内存中的当前账单数据
      chat.current.incomes = []
      chat.current.dispatches = []
      chat._billLastSync = 0 // 清除同步标记，强制重新同步
      chat._lastBillDate = currentBillStart.getTime()
      console.log(`[日切检查] 检测到跨日，已清空内存数据`, { chatId, lastDate: lastDate.toISOString(), currentBillStart: currentBillStart.toISOString() })
      return true
    }
    
    return false
  } catch (e) {
    console.error('[checkAndClearIfNewDay] 检查跨日失败', e)
    return false
  }
}

/**
 * 获取群组的日切时间（优先使用群组级别，否则使用全局配置）
 */
export async function getChatDailyCutoffHour(chatId) {
  try {
    const setting = await prisma.setting.findUnique({
      where: { chatId },
      select: { dailyCutoffHour: true }
    })
    // 🔥 修复：优先使用群组级别的日切时间，如果为null或undefined，则使用全局配置
    if (setting?.dailyCutoffHour != null && setting.dailyCutoffHour >= 0 && setting.dailyCutoffHour <= 23) {
      return setting.dailyCutoffHour
    }
  } catch (e) {
    console.error('[getChatDailyCutoffHour] 查询失败', e)
  }
  // 如果没有群组级别配置，使用全局配置
  return await getGlobalDailyCutoffHour()
}

/**
 * 获取或创建当天的OPEN账单
 * 🔥 修复日切逻辑：根据当前时间判断应该归入哪个账单周期
 * 🔥 修复：优先使用群组级别的日切时间，确保与前端一致
 * 
 * 日切逻辑说明：
 * - 如果日切时间是凌晨2点
 * - 那么3号的账单范围是：2025/11/03 02:00:00 — 2025/11/04 02:00:00
 * - 如果当前时间是3号上午10点（>= 3号02:00），归入3号的账单
 * - 如果当前时间是3号凌晨1点（< 3号02:00），归入2号的账单（2025/11/02 02:00:00 — 2025/11/03 02:00:00）
 */
export async function getOrCreateTodayBill(chatId) {
  // 🔥 先检查记账模式
  const settings = await prisma.setting.findUnique({
    where: { chatId },
    select: { accountingMode: true }
  })
  const accountingMode = settings?.accountingMode || 'DAILY_RESET'
  const isCumulativeMode = accountingMode === 'CARRY_OVER'
  const isSingleBillMode = accountingMode === 'SINGLE_BILL_PER_DAY'
  
  const now = new Date()
  
  // 🔥 累计模式：查找最新的 OPEN 账单，如果没有则创建新账单（openedAt 为当前时间）
  if (isCumulativeMode) {
    let bill = await prisma.bill.findFirst({ 
      where: { chatId, status: 'OPEN' }, 
      orderBy: { openedAt: 'desc' } 
    })
    
    if (!bill) {
      // 🔥 创建新账单，openedAt 为当前时间
      bill = await prisma.bill.create({ 
        data: { 
          chatId, 
          status: 'OPEN', 
          openedAt: now, // 🔥 使用当前时间作为开始时间
          savedAt: now 
        } 
      })
    }
    
    // 🔥 累计模式不需要返回 gte 和 lt，返回空对象
    return { bill, gte: null, lt: null }
  }
  
  // 🔥 其他模式：按日切逻辑查找或创建账单（每天只有一笔账单）
  const cutoffHour = await getChatDailyCutoffHour(chatId)
  
  // 🔥 计算今天的日切开始时间
  const todayCutoff = new Date()
  todayCutoff.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
  todayCutoff.setHours(cutoffHour, 0, 0, 0)
  
  // 🔥 判断当前时间是否已经过了今天的日切点
  let gte
  let lt
  
  if (now >= todayCutoff) {
    // 当前时间 >= 今天的日切时间，归入今天的账单（今天02:00 - 明天02:00）
    gte = new Date(todayCutoff)
    lt = new Date(todayCutoff)
    lt.setDate(lt.getDate() + 1)
  } else {
    // 当前时间 < 今天的日切时间，归入昨天的账单（昨天02:00 - 今天02:00）
    gte = new Date(todayCutoff)
    gte.setDate(gte.getDate() - 1)
    lt = new Date(todayCutoff)
  }
  
  // 🔥 单笔订单模式：如果当天已有OPEN账单，直接返回；否则创建新的
  // 🔥 其他模式：查找或创建当天的OPEN账单
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
 * 🔥 修复：确保实时汇率从数据库同步到内存
 * 🔥 新增：如果数据库中没有汇率，自动获取实时汇率并保存
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
          everyoneAllowed: true,
          accountingEnabled: true // 🔥 同步记账开关状态
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
      // 🔥 修复：优先使用数据库中的汇率，确保重启后能恢复
      if (settings.fixedRate != null) {
        chat.fixedRate = settings.fixedRate
        chat.realtimeRate = null // 设置固定汇率时清空实时汇率
      } else if (settings.realtimeRate != null) {
        chat.realtimeRate = settings.realtimeRate
        chat.fixedRate = null // 使用实时汇率时清空固定汇率
      } else {
        // 🔥 新增：如果数据库中没有汇率（既没有fixedRate也没有realtimeRate），自动获取实时汇率并保存
        try {
          const { fetchRealtimeRateUSDTtoCNY } = await import('./helpers.js')
          const rate = await fetchRealtimeRateUSDTtoCNY()
          if (rate) {
            chat.realtimeRate = rate
            chat.fixedRate = null
            // 保存到数据库
            await prisma.setting.update({
              where: { chatId },
              data: { realtimeRate: rate, fixedRate: null }
            })
            if (process.env.DEBUG_BOT === 'true') {
              console.log(`[syncSettingsToMemory] 自动获取并保存实时汇率: ${rate} (chatId: ${chatId})`)
            }
          }
        } catch (e) {
          console.error('[syncSettingsToMemory] 自动获取实时汇率失败:', e)
        }
      }
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
 * @param {string} chatId - 群组ID
 * @param {object} settings - 设置对象
 * @param {Date} currentBillOpenedAt - 当前账单的开启时间（可选，如果不提供则计算所有早于今天的账单）
 */
export async function getHistoricalNotDispatched(chatId, settings, currentBillOpenedAt = null) {
  try {
    if (settings?.accountingMode !== 'CARRY_OVER') {
      return { notDispatched: 0, notDispatchedUSDT: 0 }
    }

    // 🔥 修复：优先使用群组级别的日切时间
    const cutoffHour = settings?.dailyCutoffHour != null && settings.dailyCutoffHour >= 0 && settings.dailyCutoffHour <= 23
      ? settings.dailyCutoffHour
      : await getGlobalDailyCutoffHour()
    
    // 🔥 历史未下发只包括OPEN状态的账单（未保存的账单）
    // 🔥 不包括CLOSED状态的账单（已保存的账单）
    let historicalBillsWhere = { 
      chatId,
      status: 'OPEN' // 🔥 只查询OPEN状态的账单（未保存的）
    }
    
    if (currentBillOpenedAt) {
      // 🔥 计算当前账单所在天的开始时间
      const billDayStart = new Date(currentBillOpenedAt)
      billDayStart.setHours(cutoffHour, 0, 0, 0)
      if (currentBillOpenedAt < billDayStart) {
        billDayStart.setDate(billDayStart.getDate() - 1)
      }
      
      // 🔥 计算昨天的日期范围（用于判断昨天最后一笔账单的状态）
      const yGte = new Date(billDayStart)
      yGte.setDate(yGte.getDate() - 1)
      const yLt = new Date(billDayStart)
      
      // 🔥 查询昨天的最后一笔账单（用于判断状态）
      const lastYesterdayBill = await prisma.bill.findFirst({
        where: { 
          chatId, 
          openedAt: { gte: yGte, lt: yLt }
        },
        select: { id: true, openedAt: true, status: true },
        orderBy: { openedAt: 'desc' }
      })
      
      // 🔥 判断昨天最后一笔账单的状态
      const shouldIncludeYesterday = lastYesterdayBill?.status === 'OPEN'
      
      // 🔥 查询历史账单：只查询当前账单之前的OPEN状态账单
      historicalBillsWhere.openedAt = { lt: currentBillOpenedAt }
      
      // 🔥 如果昨天最后一笔是CLOSED，则不包括昨天的账单（因为已保存，不计入历史未下发）
      if (!shouldIncludeYesterday && lastYesterdayBill) {
        historicalBillsWhere.openedAt = { lt: yGte }
      }
    } else {
      // 🔥 兼容旧逻辑：计算所有早于今天的OPEN状态账单
      const today = startOfDay(new Date(), cutoffHour)
      historicalBillsWhere.openedAt = { lt: today }
    }
    
    // 🔥 性能优化：先查询账单ID，再批量查询账单项，避免N+1查询
    const historicalBills = await prisma.bill.findMany({
      where: historicalBillsWhere,
      select: { id: true },
      orderBy: { openedAt: 'asc' }
    })
    
    if (historicalBills.length === 0) {
      return { notDispatched: 0, notDispatchedUSDT: 0 }
    }
    
    const historicalBillIds = historicalBills.map(b => b.id)
    
    // 🔥 性能优化：一次性查询所有账单项，避免N+1查询
    const historicalItems = await prisma.billItem.findMany({
      where: { billId: { in: historicalBillIds } },
      select: { type: true, amount: true, feeRate: true }
    })
    
    const feePercent = settings?.feePercent ?? 0
    
    // 🔥 性能优化：使用单次遍历计算，避免多次filter和reduce
    let totalHistoricalNetIncome = 0 // 扣除费率后的历史入款（用于计算未下发）
    let totalHistoricalDispatch = 0
    
    for (const item of historicalItems) {
      const amount = Number(item.amount || 0)
      if (item.type === 'INCOME') {
        const itemFeeRate = item.feeRate ? Number(item.feeRate) : null
        if (itemFeeRate && itemFeeRate > 0 && itemFeeRate <= 1) {
          // 有单笔费率：amount已经是扣除费率后的
          totalHistoricalNetIncome += amount
        } else {
          // 没有单笔费率：需要扣除费率
          totalHistoricalNetIncome += amount - (amount * (feePercent || 0)) / 100
        }
      } else if (item.type === 'DISPATCH') {
        totalHistoricalDispatch += amount
      }
    }
    
    // 🔥 确保历史未下发不为负数（如果历史下发超过历史入款，则为0）
    const notDispatched = Math.max(0, totalHistoricalNetIncome - totalHistoricalDispatch)
    
    // 🔥 计算USDT（使用当前汇率）
    const fixedRate = settings?.fixedRate ?? null
    const realtimeRate = settings?.realtimeRate ?? null
    const effectiveRate = fixedRate ?? realtimeRate ?? 0
    const notDispatchedUSDT = effectiveRate > 0 ? Number((notDispatched / effectiveRate).toFixed(2)) : 0

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
    const now = new Date()
    
    // 查找所有还有OPEN账单的群组（使用groupBy获取唯一的chatId）
    const openBillsGrouped = await prisma.bill.groupBy({
      by: ['chatId'],
      where: {
        status: 'OPEN'
      },
      _count: {
        id: true
      }
    })
    
    // 转换为简单数组格式
    const openBills = openBillsGrouped.map(g => ({ chatId: g.chatId }))
    
    if (openBills.length === 0) {
      return 0
    }
    
    // 🔥 性能优化：批量查询所有群组的设置，避免N+1查询问题
    const chatIds = openBills.map(b => b.chatId)
    const allSettings = await prisma.setting.findMany({
      where: { chatId: { in: chatIds } },
      select: { chatId: true, accountingMode: true, dailyCutoffHour: true }
    })
    const settingsMap = new Map(allSettings.map(s => [s.chatId, s]))
    
    let processedCount = 0
    
    for (const bill of openBills) {
      try {
        const chatId = bill.chatId
        
        // 🔥 从缓存中获取设置，避免重复查询
        const settings = settingsMap.get(chatId)
        const accountingMode = settings?.accountingMode || 'DAILY_RESET'
        
        // 🔥 所有模式：日切时关闭昨天的账单，确保每天只有一笔账单
        if (accountingMode === 'CARRY_OVER' || accountingMode === 'DAILY_RESET' || accountingMode === 'SINGLE_BILL_PER_DAY') {
          // 🔥 修复：优先使用群组级别的日切时间
          const cutoffHour = settings?.dailyCutoffHour != null && settings.dailyCutoffHour >= 0 && settings.dailyCutoffHour <= 23
            ? settings.dailyCutoffHour
            : await getGlobalDailyCutoffHour()
          
          // 🔥 修复：计算今天日切的开始时间（不使用startOfDay，因为它会根据当前时间判断）
          // 我们需要的是"今天的日切开始时间"，无论当前时间是什么
          const todayCutoff = new Date()
          todayCutoff.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
          todayCutoff.setHours(cutoffHour, 0, 0, 0)
          const todayStart = new Date(todayCutoff)
          
          // 查找所有昨天的OPEN账单并关闭它们（openedAt < 今天02:00的账单）
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
                  // 🔥 清空内存中的当前账单数据
                  chat.current.incomes = []
                  chat.current.dispatches = []
                  chat._billLastSync = 0
                  // 🔥 更新最后账单日期为今天日切的开始时间
                  chat._lastBillDate = todayStart.getTime()
                  console.log(`[自动日切] 已清空群组 ${chatId} 的内存数据`, { todayStart: todayStart.toISOString() })
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

