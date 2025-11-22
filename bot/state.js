// In-memory state store per chat
// 优化：添加 LRU 缓存和大小限制，防止内存泄漏

import { LRUCache, limitMapSize, limitArraySize } from './lru-cache.js'

// 配置项：内存优化（降低内存占用）
const MAX_BOTS = 5 // 最多支持的机器人数量
const MAX_CHATS_PER_BOT = 100 // 🔥 内存优化：每个机器人最多缓存的聊天数量（从500减少到100）
const MAX_USER_ID_CACHE = 100 // 🔥 内存优化：每个聊天最多缓存的用户ID映射（从200减少到100）
const MAX_COMMISSIONS = 30 // 🔥 内存优化：每个聊天最多缓存的佣金记录（从50减少到30）
const MAX_HISTORY = 5 // 🔥 内存优化：最多保留的历史账单数量（从10减少到5，历史记录存数据库）
const MAX_INCOMES = 100 // 🔥 内存优化：当前账单最多保留的入款记录（从200减少到100，实际数据在数据库）
const MAX_DISPATCHES = 100 // 🔥 内存优化：当前账单最多保留的下发记录（从200减少到100，实际数据在数据库）

// 使用 LRU 缓存存储 bot
const bots = new LRUCache(MAX_BOTS)

function ensureBot(botId) {
  if (!bots.has(botId)) {
    bots.set(botId, new LRUCache(MAX_CHATS_PER_BOT))
  }
  return bots.get(botId)
}

function createInitialChatState() {
  return {
    operators: new Set(),
    operatorIds: new Set(), // Set<number>
    userIdByUsername: new Map(), // Map<@username, userId> - 会定期清理
    everyoneAllowed: false,
    headerText: '',
    fixedRate: null, // number | null
    realtimeRate: null, // 🔥 修改：不再默认7.15，启动时获取最新汇率
    feePercent: 0, // 0-100
    displayMode: 1, // 1 | 2 | 3
    rmbMode: false,
    currencyCode: 'cny',
    commissionMode: false,
    commissions: new Map(), // username -> number - 会定期清理
    muteMode: false,
    workStartedAt: null, // Date | null
    workTotalMs: 0, // number
    lastActivityAt: Date.now(), // 最后活动时间（用于清理不活跃的聊天）
    // current working bill (not yet saved)
    current: {
      incomes: [], // 会定期限制大小
      dispatches: [], // 会定期限制大小
    },
    // saved bills history (array of snapshots)
    history: [], // 会定期限制大小
  }
}

function getChat(botId, chatId) {
  const botChats = ensureBot(botId)
  if (!botChats.has(chatId)) {
    botChats.set(chatId, createInitialChatState())
  }
  const chat = botChats.get(chatId)

  // 更新最后活动时间
  chat.lastActivityAt = Date.now()

  // 定期清理大型数据结构，防止内存泄漏
  limitMapSize(chat.userIdByUsername, MAX_USER_ID_CACHE)
  limitMapSize(chat.commissions, MAX_COMMISSIONS)
  chat.history = limitArraySize(chat.history, MAX_HISTORY)
  chat.current.incomes = limitArraySize(chat.current.incomes, MAX_INCOMES)
  chat.current.dispatches = limitArraySize(chat.current.dispatches, MAX_DISPATCHES)

  return chat
}

/**
 * 清理不活跃的聊天（🔥 内存优化：减少阈值，更频繁清理）
 */
function cleanupInactiveChats() {
  const now = Date.now()
  const INACTIVE_THRESHOLD = 2 * 60 * 60 * 1000 // 🔥 内存优化：从24小时减少到2小时

  let cleaned = 0
  let removed = 0
  for (const [botId, botChats] of bots.cache.entries()) {
    const chatsToRemove = []
    for (const [chatId, chat] of botChats.cache.entries()) {
      if (now - chat.lastActivityAt > INACTIVE_THRESHOLD) {
        // 🔥 内存优化：完全移除不活跃的聊天，而不是只清理数据
        chatsToRemove.push(chatId)
        cleaned++
      } else {
        // 清理大型数据结构（即使还没到阈值，也定期清理）
        chat.userIdByUsername.clear()
        chat.commissions.clear()
        // 🔥 内存优化：只保留最近的数据
        chat.current.incomes = chat.current.incomes.slice(-50)
        chat.current.dispatches = chat.current.dispatches.slice(-50)
        chat.history = chat.history.slice(-3)
      }
    }
    // 移除不活跃的聊天
    for (const chatId of chatsToRemove) {
      botChats.delete(chatId)
      removed++
    }
  }

  if (cleaned > 0) {
    console.log(`[memory-cleanup] 清理了 ${cleaned} 个不活跃的聊天，移除了 ${removed} 个`)
  }
}

/**
 * 安全地计算数学表达式（只支持数字和 + - * /）
 * @param {string} expr - 数学表达式，如 "100-50", "100*2", "80/2"
 * @returns {number|null} - 计算结果，如果表达式无效返回 null
 */
function safeCalculate(expr) {
  try {
    // 移除所有空格
    const clean = expr.replace(/\s+/g, '')

    // 安全检查：只允许数字、小数点和运算符
    if (!/^[\d+\-*/.()]+$/.test(clean)) {
      return null
    }

    // 使用 Function 构造函数比 eval 更安全
    // 但仍然需要严格验证输入
    const result = Function('"use strict"; return (' + clean + ')')()

    // 检查结果是否为有效数字
    if (!Number.isFinite(result)) {
      return null
    }

    return Number(result.toFixed(1))
  } catch (e) {
    return null
  }
}

/**
 * 🔥 增强版解析函数：支持单独汇率、单独费率、组合格式、数学表达式
 * 支持的格式：
 * - +1000（简单数字）
 * - +3232+321（加法计算，结果+3553）
 * - +100-20（减法计算，结果+80）
 * - +1000*0.95（单独费率，结果+950）
 * - +100/2（单独汇率，100元按汇率2计算为50U，入账100元）
 * - +1000/7（指定汇率7）
 * - +1000/7*0.95（组合：汇率和费率）
 * - +1000u/7*0.95（组合：USDT + 汇率 + 费率）
 * 
 * 🔥 重要规则：
 * - * 表示费率（如 +1000*0.95 = 950元）
 * - / 表示汇率（如 +100/2 = 100元按汇率2计算）
 * - +、- 表示数学计算（如 +100-20 = 80元）
 */
function parseAmountAndRate(text) {
  let rate = null
  let feeRate = null
  let amount = null

  // 🔥 处理组合格式：+1000/7*0.95 或 +1000u/7*0.95
  const comboMatch = text.match(/^([+\-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)$/)
  if (comboMatch) {
    amount = Number(comboMatch[1])
    rate = Number(comboMatch[2])
    feeRate = Number(comboMatch[3])
    if (Number.isFinite(amount) && Number.isFinite(rate) && Number.isFinite(feeRate)) {
      return { amount, rate, feeRate }
    }
  }

  // 🔥 单独费率格式：+1000u*0.95 或 +1000*0.95（乘法是费率）
  const feeMatch = text.match(/^([+\-]?\d+(?:\.\d+)?)\s*\*\s*(\d+(?:\.\d+)?)$/)
  if (feeMatch) {
    amount = Number(feeMatch[1])
    feeRate = Number(feeMatch[2])
    if (Number.isFinite(amount) && Number.isFinite(feeRate)) {
      return { amount, rate, feeRate }
    }
  }

  // 🔥 单独汇率格式：+1000u/7 或 +100/2（除法是汇率）
  const rateMatch = text.match(/^([+\-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  if (rateMatch) {
    amount = Number(rateMatch[1])
    rate = Number(rateMatch[2])
    if (Number.isFinite(amount) && Number.isFinite(rate) && rate > 0) {
      return { amount, rate, feeRate }
    }
  }

  // 🔥 处理加减法计算：+3232+321, +100-20（加减法才是数学计算）
  const expr = text.trim()
  const firstChar = expr[0]
  const hasLeadingSign = firstChar === '+' || firstChar === '-'
  const sign = firstChar === '-' ? '-' : ''
  const cleanExpr = hasLeadingSign ? expr.slice(1) : expr

  // 检查是否包含加减运算符（不包括乘除，乘除是费率/汇率）
  if (/[+\-]/.test(cleanExpr)) {
    const calculated = safeCalculate(sign + cleanExpr)
    if (calculated !== null && Number.isFinite(calculated)) {
      return { amount: calculated, rate, feeRate }
    }
  }

  // 🔥 简单数字：+1000 或 -1000
  amount = Number(sign + cleanExpr)
  if (!Number.isFinite(amount)) return null

  return { amount, rate, feeRate }
}

function calcUSDT(amountRMB, rate) {
  if (!rate || rate <= 0) return 0
  return Number((amountRMB / rate).toFixed(2))
}

/**
 * 汇总当前账单
 * @param {object} chat - 内存中的聊天状态
 */
function summarize(chat) {
  const totalIncome = chat.current.incomes.reduce((s, i) => s + i.amount, 0)
  const totalDispatched = chat.current.dispatches.reduce((s, d) => s + d.amount, 0)

  const effectiveRate = chat.fixedRate ?? chat.realtimeRate ?? 0
  const fee = Number(((totalIncome * chat.feePercent) / 100).toFixed(2))
  // 允许负数：当有负数入款时也计入
  const shouldDispatch = totalIncome - fee

  // 逐笔按指定汇率计算入款USDT总和（若该笔无rate则回退到当前有效汇率）
  const incomeUSDTTotal = chat.current.incomes.reduce((sum, i) => {
    const rateUsed = (i.rate != null ? i.rate : effectiveRate)
    if (!rateUsed || rateUsed <= 0) return sum
    return sum + (i.amount / rateUsed)
  }, 0)

  // 费用在USDT层面按比例扣减：等同于 incomeUSDTTotal * (1 - feePercent/100)
  const shouldDispatchUSDT = Number((incomeUSDTTotal * (1 - (chat.feePercent || 0) / 100)).toFixed(2))

  // 下发USDT优先使用每条记录自带usdt字段，缺失则回退用有效汇率换算
  const dispatchedUSDT = chat.current.dispatches.reduce((sum, d) => {
    if (typeof d.usdt === 'number' && Number.isFinite(d.usdt)) {
      return sum + d.usdt
    }
    return sum + calcUSDT(d.amount, effectiveRate)
  }, 0)

  // 允许负数：当下发超过应下发时为负
  const notDispatched = shouldDispatch - totalDispatched
  const notDispatchedUSDT = Number((shouldDispatchUSDT - dispatchedUSDT).toFixed(2))

  return {
    totalIncome,
    totalIncomeUSDT: Number(incomeUSDTTotal.toFixed(2)),
    feePercent: chat.feePercent,
    effectiveRate,
    shouldDispatch,
    shouldDispatchUSDT,
    dispatched: totalDispatched,
    dispatchedUSDT,
    notDispatched,
    notDispatchedUSDT,
  }
}

export { getChat, parseAmountAndRate, calcUSDT, summarize, safeCalculate, cleanupInactiveChats }
