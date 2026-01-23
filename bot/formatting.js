// 格式化函数模块
import { prisma } from '../lib/db.js'
import { summarize } from './state.js'
import { formatMoney, getGlobalDailyCutoffHour, startOfDay, endOfDay } from './utils.js'
import { checkAndClearIfNewDay, getOrCreateTodayBill } from './database.js'

/**
 * 格式化账单摘要
 */
export async function formatSummary(ctx, chat, options = {}) {
  const chatId = String(ctx?.chat?.id || '')

  // 🔥 首先检查是否跨日，如果是每日清零模式则清空内存数据
  await checkAndClearIfNewDay(chat, chatId)

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
          // 🔥 修复：优先使用群组级别的日切时间，与 getOrCreateTodayBill 保持一致
          const setting = await prisma.setting.findUnique({
            where: { chatId },
            select: { dailyCutoffHour: true }
          })
          const cutoffHour = setting?.dailyCutoffHour != null && setting.dailyCutoffHour >= 0 && setting.dailyCutoffHour <= 23
            ? setting.dailyCutoffHour
            : await getGlobalDailyCutoffHour()

          // 🔥 修复：使用与 getOrCreateTodayBill 相同的日切逻辑
          const now = new Date()

          // 计算今天的日切开始时间
          const todayCutoff = new Date()
          todayCutoff.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
          todayCutoff.setHours(cutoffHour, 0, 0, 0)

          // 判断当前时间是否已经过了今天的日切点
          let gte
          let lt

          if (now >= todayCutoff) {
            // 当前时间 >= 今天的日切时间，查询今天的账单
            gte = new Date(todayCutoff)
            lt = new Date(todayCutoff)
            lt.setDate(lt.getDate() + 1)
          } else {
            // 当前时间 < 今天的日切时间，查询昨天的账单
            gte = new Date(todayCutoff)
            gte.setDate(gte.getDate() - 1)
            lt = new Date(todayCutoff)
          }

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
                  remark: true, // 🔥 添加备注字段
                  displayName: true, // 🔥 添加用户昵称字段
                  userId: true, // 🔥 添加用户ID字段
                  messageId: true, // 🔥 添加消息ID字段
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

    // 🔥 累计模式不再需要历史未下发计算

    if (needsSync && billData?.items) {
      // 🔥 从数据库同步时，尝试从 chat.userIdByUsername 获取用户信息
      const dbIncomes = billData.items.filter(i => i.type === 'INCOME').map(i => {
        const replier = i.replier || ''
        const operator = i.operator || ''
        const who = operator || replier || ''
        
        // 🔥 优先使用数据库中的 displayName 和 userId
        let userId = i.userId ? Number(i.userId) : null
        let displayName = i.displayName || null
        
        // 如果数据库中没有 displayName，尝试从 chat.userIdByUsername 获取
        if (!displayName) {
          displayName = who.replace(/^@/, '') || '用户'
          if (who) {
            const whoWithAt = who.startsWith('@') ? who : `@${who}`
            if (!userId) {
              userId = chat.userIdByUsername.get(whoWithAt) || chat.userIdByUsername.get(who)
            }
            // 如果没有 userId，尝试从 who 中提取（如果是 @user_123456 格式）
            if (!userId && who.startsWith('@user_')) {
              const extractedId = who.replace('@user_', '')
              if (/^\d+$/.test(extractedId)) {
                userId = Number(extractedId)
              }
            }
          }
        }
        
        return {
        amount: Number(i.amount),
        rate: i.rate ? Number(i.rate) : undefined,
        createdAt: new Date(i.createdAt),
          replier: replier,
          operator: operator,
          displayName: displayName,
          userId: userId,
          messageId: i.messageId || null, // 🔥 保存消息ID
        }
      })

      const dbDispatches = billData.items.filter(i => i.type === 'DISPATCH').map(i => {
        const replier = i.replier || ''
        const operator = i.operator || ''
        const who = operator || replier || ''
        
        // 🔥 优先使用数据库中的 displayName 和 userId
        let userId = i.userId ? Number(i.userId) : null
        let displayName = i.displayName || null
        
        // 如果数据库中没有 displayName，尝试从 chat.userIdByUsername 获取
        if (!displayName) {
          displayName = who.replace(/^@/, '') || '用户'
          if (who) {
            const whoWithAt = who.startsWith('@') ? who : `@${who}`
            if (!userId) {
              userId = chat.userIdByUsername.get(whoWithAt) || chat.userIdByUsername.get(who)
            }
            // 如果没有 userId，尝试从 who 中提取（如果是 @user_123456 格式）
            if (!userId && who.startsWith('@user_')) {
              const extractedId = who.replace('@user_', '')
              if (/^\d+$/.test(extractedId)) {
                userId = Number(extractedId)
              }
            }
          }
        }
        
        return {
        amount: Number(i.amount),
        usdt: Number(i.usdt),
        createdAt: new Date(i.createdAt),
          replier: replier,
          operator: operator,
          displayName: displayName,
          userId: userId,
        }
      })

      // 🔥 修复：始终使用数据库数据作为权威来源，确保数据一致性
      // 🔥 优化：即使记录数超过内存限制（100条），也完整同步到内存（用于计算）
      // 但显示时会根据displayMode限制显示数量
        chat.current.incomes = dbIncomes
        chat.current.dispatches = dbDispatches
      chat._billLastSync = now
      // 🔥 记录当前账单的日期，用于跨日检测（与 getOrCreateTodayBill 保持一致）
      // 🔥 修复：优先使用群组级别的日切时间
      const setting = await prisma.setting.findUnique({
        where: { chatId },
        select: { dailyCutoffHour: true }
      }).catch(() => null)
      const cutoffHour = setting?.dailyCutoffHour != null && setting.dailyCutoffHour >= 0 && setting.dailyCutoffHour <= 23
        ? setting.dailyCutoffHour
        : await getGlobalDailyCutoffHour()

      const nowDate = new Date()
      const todayCutoff = new Date()
      todayCutoff.setFullYear(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate())
      todayCutoff.setHours(cutoffHour, 0, 0, 0)
      // 判断当前时间应该归入哪个账单周期
      const currentBillStart = nowDate >= todayCutoff ? new Date(todayCutoff) : (() => {
        const yesterday = new Date(todayCutoff)
        yesterday.setDate(yesterday.getDate() - 1)
        return yesterday
      })()
      chat._lastBillDate = currentBillStart.getTime()
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

  // 🔥 修复：从数据库读取所有记录进行计算，确保几千几万条记录时也能正确计算
  // 内存中可能只保留部分记录（MAX_INCOMES=100），但计算时必须使用所有记录
  let allIncomes = chat.current.incomes
  let allDispatches = chat.current.dispatches
  let incCount = chat.current.incomes.length
  let disCount = chat.current.dispatches.length

  try {
    // 如果内存中的记录数达到限制（100条），说明数据库中可能有更多记录
    // 需要从数据库重新读取所有记录进行计算
    if (incCount >= 100 || disCount >= 100 || needsSync) {
      const { bill } = await getOrCreateTodayBill(chatId)
      if (bill) {
        const allItems = await prisma.billItem.findMany({
          where: { billId: bill.id },
          select: {
            type: true,
            amount: true,
            rate: true,
            usdt: true,
            feeRate: true,
            replier: true,
            operator: true,
            displayName: true,
            userId: true,
            messageId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' }
        })

        allIncomes = allItems
          .filter(i => i.type === 'INCOME')
          .map(i => ({
            amount: Number(i.amount || 0),
            rate: i.rate != null ? Number(i.rate) : undefined,
            feeRate: i.feeRate != null ? Number(i.feeRate) : undefined,
            createdAt: new Date(i.createdAt),
            replier: i.replier || '',
            operator: i.operator || '',
            displayName: i.displayName || null,
            userId: i.userId ? Number(i.userId) : null,
            messageId: i.messageId || null,
          }))

        allDispatches = allItems
          .filter(i => i.type === 'DISPATCH')
          .map(i => ({
            amount: Number(i.amount || 0),
            usdt: Number(i.usdt || 0),
            createdAt: new Date(i.createdAt),
            replier: i.replier || '',
            operator: i.operator || '',
            displayName: i.displayName || null,
            userId: i.userId ? Number(i.userId) : null,
            messageId: i.messageId || null,
          }))

        incCount = allIncomes.length
        disCount = allDispatches.length
      }
    }
  } catch (e) {
    console.error('[formatSummary] 从数据库读取所有记录失败，使用内存数据', e)
  }

  // 🔥 使用所有记录创建临时chat对象进行计算
  const tempChat = {
    ...chat,
    current: {
      incomes: allIncomes,
      dispatches: allDispatches,
    }
  }
  const s = summarize(tempChat)
  const rateVal = s.effectiveRate || 0

  let showIncomes = allIncomes
  let showDispatches = allDispatches
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
      const who = i.displayName || i.replier || i.operator || ''
      const remark = i.remark // 🔥 获取备注

      // 金额可点击跳转到原始消息（仅对超级群生效：chatId 形如 -100xxxx）
      let amountText = formatMoney(amount)
      try {
        const chatIdNum = String(chatId || '')
        if (i.messageId && chatIdNum.startsWith('-100')) {
          const internalId = chatIdNum.slice(4) // 去掉 -100 前缀
          const msgUrl = `https://t.me/c/${internalId}/${i.messageId}`
          amountText = `[${amountText}](${msgUrl})`
        }
      } catch {}

      let line = `${t} ${amountText}`
      if (rate) {
        line += ` / ${rate}=${usdt}U`
      }
      // 🔥 显示费率（如果有）
      if (i.feeRate) {
        line += ` ×${(i.feeRate * 100).toFixed(0)}%`
      }
      // 🔥 显示备注（如果有）
      if (remark) {
        line += ` [${remark}]`
      }

      // 同一行显示用户名称（去掉 @），名称可点击打开用户详情
      if (who) {
        const displayName = String(who || '').replace(/^@/, '') || '用户'
        const userId = i.userId
        let userLine = displayName
        if (userId) {
          userLine = `[${displayName}](tg://user?id=${userId})`
        }
        line += ` ${userLine}`
      }

      return line
    }).join('\n')
    : (incCount > 0 && chat.displayMode === 3 ? '（详情省略，显示模式3）' : ' 暂无入款')

  const disPart = disCount > 0 && showDispatches.length > 0
    ? showDispatches.map((d) => {
      const t = d.createdAt.toTimeString().slice(0, 8)
      const amount = Math.abs(d.amount)
      const usdt = Math.abs(d.usdt)
      const who = d.displayName || d.replier || d.operator || ''
      
      let line = `${t} ${formatMoney(amount)} (${formatMoney(usdt)}U)`
      
      // 同一行显示用户名称（去掉 @），名称可点击打开用户详情
      if (who) {
        const displayName = String(who || '').replace(/^@/, '') || '用户'
        const userId = d.userId
        let userLine = displayName
        if (userId) {
          userLine = `[${displayName}](tg://user?id=${userId})`
        }
        line += ` ${userLine}`
      }
      
      return line
    }).join('\n')
    : (disCount > 0 && chat.displayMode === 3 ? '（详情省略，显示模式3）' : ' 暂无下发')

  const header = chat.headerText ? `${chat.headerText}\n` : ''
  const modeTag = accountingMode === 'CARRY_OVER' ? '【累计模式】' : ''


  return [
    header + `${modeTag}${options.title || '账单状态'}`,
    `已入款（${incCount}笔）：`,
    incPart,
    `\n已下发（${disCount}笔）：`,
    disPart,
    `\n总入款金额：${formatMoney(s.totalIncome)}${(s.totalIncomeUSDT && s.totalIncomeUSDT !== 0) ? ` | ${formatMoney(s.totalIncomeUSDT)}U` : ''}`, // 🔥 显示总入款的U（逐笔汇率聚合）
    `费率：${s.feePercent}%`,
    `${rateLabel}：${rateVal || '未设置'}`,
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

