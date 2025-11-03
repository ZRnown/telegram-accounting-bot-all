// 格式化函数模块
import { prisma } from '../lib/db.ts'
import { summarize } from './state.js'
import { formatMoney } from './utils.js'
import { getGlobalDailyCutoffHour } from './utils.js'
import { startOfDay, endOfDay } from './utils.js'
import { getHistoricalNotDispatched, checkAndClearIfNewDay } from './database.js'

/**
 * 格式化账单摘要
 */
export async function formatSummary(ctx, chat, options = {}) {
  const chatId = String(ctx?.chat?.id || '')
  
  // 🔥 首先检查是否跨日，如果是每日清零模式则清空内存数据
  await checkAndClearIfNewDay(chat, chatId)
  
  let previousNotDispatched = 0
  let previousNotDispatchedUSDT = 0
  let accountingMode = 'DAILY_RESET'
  let settings = null // 🔥 初始化 settings 变量
  
  const lastSyncTime = chat._billLastSync || 0
  const now = Date.now()
  const needsSync = !chat._billLastSync || 
                    (chat.current.incomes.length === 0 && chat.current.dispatches.length === 0) ||
                    (now - lastSyncTime > 30 * 60 * 1000)
  
  try {
    const [settingsResult, billData] = await Promise.all([
      prisma.setting.findUnique({ 
        where: { chatId },
        select: {
          accountingMode: true,
          feePercent: true,
          fixedRate: true,
          realtimeRate: true
        }
      }),
      needsSync ? (async () => {
        try {
          const cutoffHour = await getGlobalDailyCutoffHour()
          const gte = startOfDay(new Date(), cutoffHour)
          const lt = endOfDay(new Date(), cutoffHour)
          return await prisma.bill.findFirst({ 
            where: { chatId, status: 'OPEN', openedAt: { gte, lt } },
            include: { 
              items: {
                select: {
                  type: true,
                  amount: true,
                  rate: true,
                  usdt: true,
                  replier: true,
                  operator: true,
                  createdAt: true
                }
              }
            },
            orderBy: { openedAt: 'asc' }
          })
        } catch (e) {
          return null
        }
      })() : Promise.resolve(null)
    ])
    
    settings = settingsResult // 🔥 赋值给外部变量
    accountingMode = settings?.accountingMode || 'DAILY_RESET'
    
    if (accountingMode === 'CARRY_OVER') {
      const historical = await getHistoricalNotDispatched(chatId, settings)
      previousNotDispatched = historical.notDispatched
      previousNotDispatchedUSDT = historical.notDispatchedUSDT
    }
    
    if (needsSync && billData?.items) {
      const dbIncomes = billData.items.filter(i => i.type === 'INCOME').map(i => ({
        amount: Number(i.amount),
        rate: i.rate ? Number(i.rate) : undefined,
        createdAt: new Date(i.createdAt),
        replier: i.replier || '',
        operator: i.operator || '',
      }))
      
      const dbDispatches = billData.items.filter(i => i.type === 'DISPATCH').map(i => ({
        amount: Number(i.amount),
        usdt: Number(i.usdt),
        createdAt: new Date(i.createdAt),
        replier: i.replier || '',
        operator: i.operator || '',
      }))
      
      if (dbIncomes.length >= chat.current.incomes.length) {
        chat.current.incomes = dbIncomes
      }
      if (dbDispatches.length >= chat.current.dispatches.length) {
        chat.current.dispatches = dbDispatches
      }
      chat._billLastSync = now
      // 🔥 记录当前账单的日期，用于跨日检测
      const cutoffHour = await getGlobalDailyCutoffHour()
      const todayStart = startOfDay(new Date(), cutoffHour)
      chat._lastBillDate = todayStart.getTime()
    } else if (needsSync) {
      chat._billLastSync = now
    }
  } catch (e) {
    console.error('获取设置或同步数据失败', e)
  }

  const currentFixedRate = settings?.fixedRate ?? chat.fixedRate ?? null
  const currentRealtimeRate = settings?.realtimeRate ?? chat.realtimeRate ?? null
  const isFixedRate = currentFixedRate != null
  const rateLabel = isFixedRate ? '固定汇率' : '实时汇率'
  
  const s = summarize(chat, { previousNotDispatched, previousNotDispatchedUSDT })
  const rateVal = s.effectiveRate || 0

  const incCount = chat.current.incomes.length
  const disCount = chat.current.dispatches.length

  let showIncomes = chat.current.incomes
  let showDispatches = chat.current.dispatches
  if (chat.displayMode === 1) {
    showIncomes = showIncomes.slice(-3)
    showDispatches = showDispatches.slice(-3)
  } else if (chat.displayMode === 2) {
    showIncomes = showIncomes.slice(-5)
    showDispatches = showDispatches.slice(-5)
  } else if (chat.displayMode === 3) {
    showIncomes = []
    showDispatches = []
  } else if (chat.displayMode === 4) {
    showIncomes = showIncomes.slice(-10)
    showDispatches = showDispatches.slice(-10)
  } else if (chat.displayMode === 5) {
    showIncomes = showIncomes.slice(-20)
    showDispatches = showDispatches.slice(-20)
  }

  const incPart = incCount > 0 && showIncomes.length > 0
    ? showIncomes.map((i) => {
        const t = i.createdAt.toTimeString().slice(0, 8)
        const rate = i.rate ?? rateVal
        const usdt = rate ? Number((Math.abs(i.amount) / rate).toFixed(1)) : 0
        const amount = Math.abs(i.amount)
        const who = (i.operator || i.replier || '')
        
        let line = `${t} [${formatMoney(amount)}](tg://user?id=0)`
        if (rate) {
          line += ` / ${rate}=${usdt}U`
        }
        if (who) {
          const whoWithAt = who.startsWith('@') ? who : `@${who}`
          const userId = chat.userIdByUsername.get(whoWithAt) || chat.userIdByUsername.get(who)
          if (userId) {
            line += ` [${who}](tg://user?id=${userId})`
          } else {
            line += ` *${who}*`
          }
        }
        return line
      }).join('\n')
    : (incCount > 0 && chat.displayMode === 3 ? '（详情省略，显示模式3）' : ' 暂无入款')

  const disPart = disCount > 0 && showDispatches.length > 0
    ? showDispatches.map((d) => {
        const t = d.createdAt.toTimeString().slice(0, 8)
        const amount = Math.abs(d.amount)
        const usdt = Math.abs(d.usdt)
        return `${t} [${formatMoney(amount)}](tg://user?id=0) (${formatMoney(usdt)}U)`
      }).join('\n')
    : (disCount > 0 && chat.displayMode === 3 ? '（详情省略，显示模式3）' : ' 暂无下发')

  const header = chat.headerText ? `${chat.headerText}\n` : ''
  const modeTag = accountingMode === 'CARRY_OVER' ? '【累计模式】' : ''

  let historicalInfo = ''
  if (accountingMode === 'CARRY_OVER' && (previousNotDispatched !== 0 || previousNotDispatchedUSDT !== 0)) {
    historicalInfo = `\n账单拆解：\n今日入款：${formatMoney(s.totalIncome)}\n历史未下发：${formatMoney(previousNotDispatched)} | ${formatMoney(previousNotDispatchedUSDT)}U`
  }

  return [
    header + `${modeTag}${options.title || '账单状态'}`,
    `已入款（${incCount}笔）：`,
    incPart,
    `\n已下发（${disCount}笔）：`,
    disPart,
    `\n总入款金额：${formatMoney(s.totalIncome)}`,
    `费率：${s.feePercent}%`,
    `${rateLabel}：${rateVal || '未设置'}`,
    historicalInfo,
    ...(chat.rmbMode
      ? [
          `应下发：${formatMoney(s.shouldDispatch)}`,
          `已下发：${formatMoney(s.dispatched)}`,
          `未下发：${formatMoney(s.notDispatched)}`,
        ]
      : [
          `应下发：${formatMoney(s.shouldDispatch)} | ${formatMoney(s.shouldDispatchUSDT)}U`,
          `已下发：${formatMoney(s.dispatched)} | ${formatMoney(s.dispatchedUSDT)}U`,
          `未下发：${formatMoney(s.notDispatched)} | ${formatMoney(s.notDispatchedUSDT)}U`,
        ]
    ),
  ].join('\n')
}

