// In-memory state store per chat
// 优化：添加 LRU 缓存和大小限制，防止内存泄漏

import { LRUCache, limitMapSize, limitArraySize } from './lru-cache.js'

// 配置项：内存优化（降低内存占用）
const MAX_BOTS = 5 // 最多支持的机器人数量（减少）
const MAX_CHATS_PER_BOT = 500 // 每个机器人最多缓存的聊天数量（减少）
const MAX_USER_ID_CACHE = 200 // 每个聊天最多缓存的用户ID映射（减少）
const MAX_COMMISSIONS = 50 // 每个聊天最多缓存的佣金记录（减少）
const MAX_HISTORY = 10 // 最多保留的历史账单数量（减少，历史记录存数据库）
const MAX_INCOMES = 200 // 当前账单最多保留的入款记录（减少，实际数据在数据库）
const MAX_DISPATCHES = 200 // 当前账单最多保留的下发记录（减少，实际数据在数据库）

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
    realtimeRate: 7.15, // number | null
    feePercent: 0, // 0-100
    displayMode: 1, // 1 | 2 | 3
    rmbMode: false,
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
 * 清理不活跃的聊天（超过24小时未活动）
 */
function cleanupInactiveChats() {
  const now = Date.now()
  const INACTIVE_THRESHOLD = 24 * 60 * 60 * 1000 // 24小时
  
  let cleaned = 0
  for (const [botId, botChats] of bots.cache.entries()) {
    for (const [chatId, chat] of botChats.cache.entries()) {
      if (now - chat.lastActivityAt > INACTIVE_THRESHOLD) {
        // 清理大型数据结构
        chat.userIdByUsername.clear()
        chat.commissions.clear()
        chat.current.incomes = []
        chat.current.dispatches = []
        chat.history = []
        cleaned++
      }
    }
  }
  
  if (cleaned > 0) {
    console.log(`[memory-cleanup] 清理了 ${cleaned} 个不活跃的聊天`)
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

function parseAmountAndRate(text) {
  // Supports: +1000, +50000/7.2（带汇率）, +100-50, +100*2, +11/21（除法）
  // 
  // 汇率格式规则：只有当格式为 "+纯数字/汇率数字" 且汇率在合理范围（6-10）时才识别为汇率
  // 其他带 / 的都当作除法运算
  
  let expressionPart = text
  let rate = null
  
  // 检查是否为汇率格式：+纯数字/汇率
  // 只有符合 "+数字/6~10范围的数字" 才当作汇率
  const rateMatch = text.match(/^([+\-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  if (rateMatch) {
    const potentialRate = Number(rateMatch[2])
    // 只有当后面的数字在合理汇率范围内（6-10）才当作汇率
    if (potentialRate >= 6 && potentialRate <= 10) {
      expressionPart = rateMatch[1]
      rate = potentialRate
    }
    // 否则整个当作除法表达式（如 +11/21）
  }
  
  // 处理开头的符号
  const firstChar = expressionPart.trim()[0]
  const hasLeadingSign = firstChar === '+' || firstChar === '-'
  const sign = firstChar === '-' ? '-' : ''
  
  // 移除开头的 +/-
  const expr = hasLeadingSign ? expressionPart.trim().slice(1) : expressionPart.trim()
  
  // 如果表达式包含运算符，计算结果
  if (/[+\-*/]/.test(expr)) {
    const calculated = safeCalculate(sign + expr)
    if (calculated === null) return null
    return { amount: calculated, rate }
  }
  
  // 简单数字
  const amount = Number(sign + expr)
  if (!Number.isFinite(amount)) return null
  
  return { amount, rate }
}

function calcUSDT(amountRMB, rate) {
  if (!rate || rate <= 0) return 0
  return Number((amountRMB / rate).toFixed(2))
}

/**
 * 汇总当前账单
 * @param {object} chat - 内存中的聊天状态
 * @param {object} options - 选项
 * @param {number} options.previousNotDispatched - 历史未下发金额（RMB）（用于累计模式）
 * @param {number} options.previousNotDispatchedUSDT - 历史未下发USDT（用于累计模式）
 */
function summarize(chat, options = {}) {
  const { previousNotDispatched = 0, previousNotDispatchedUSDT = 0 } = options

  const totalIncome = chat.current.incomes.reduce((s, i) => s + i.amount, 0)
  const totalDispatched = chat.current.dispatches.reduce((s, d) => s + d.amount, 0)

  const effectiveRate = chat.fixedRate ?? chat.realtimeRate ?? 0
  const fee = Number(((totalIncome * chat.feePercent) / 100).toFixed(2))
  // 移除 Math.max，允许负数入款也计入应下发
  const shouldDispatchToday = totalIncome - fee

  // 计算今日应下发的 USDT
  const shouldDispatchTodayUSDT = calcUSDT(shouldDispatchToday, effectiveRate)

  // 累计模式：加上历史未下发
  const shouldDispatch = shouldDispatchToday + previousNotDispatched
  const shouldDispatchUSDT = shouldDispatchTodayUSDT + previousNotDispatchedUSDT

  const dispatchedUSDT = calcUSDT(totalDispatched, effectiveRate)
  // 允许负数：当下发超过收入时显示负数
  const notDispatched = shouldDispatch - totalDispatched
  const notDispatchedUSDT = shouldDispatchUSDT - dispatchedUSDT

  return {
    totalIncome,
    feePercent: chat.feePercent,
    effectiveRate,
    shouldDispatch,
    shouldDispatchUSDT,
    dispatched: totalDispatched,
    dispatchedUSDT,
    notDispatched,
    notDispatchedUSDT,
    // 额外返回今日和历史的分解数据
    shouldDispatchToday,
    previousNotDispatched,
    previousNotDispatchedUSDT,
  }
}

export { getChat, parseAmountAndRate, calcUSDT, summarize, safeCalculate, cleanupInactiveChats }
