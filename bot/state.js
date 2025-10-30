// In-memory state store per chat
// This can be replaced with a real DB later (e.g., Prisma + SQLite/Postgres)

const bots = new Map()

function ensureBot(botId) {
  if (!bots.has(botId)) {
    bots.set(botId, new Map())
  }
  return bots.get(botId)
}

function createInitialChatState() {
  return {
    operators: new Set(),
    operatorIds: new Set(), // Set<number>
    userIdByUsername: new Map(), // Map<@username, userId>
    everyoneAllowed: false,
    headerText: '',
    fixedRate: null, // number | null
    realtimeRate: 7.15, // number | null
    feePercent: 0, // 0-100
    displayMode: 1, // 1 | 2 | 3
    rmbMode: false,
    commissionMode: false,
    commissions: new Map(), // username -> number
    muteMode: false,
    workStartedAt: null, // Date | null
    workTotalMs: 0, // number
    // current working bill (not yet saved)
    current: {
      incomes: [], // [{amount: number, rate: number, createdAt: Date, replier?: string, operator?: string}]
      dispatches: [], // [{amount: number, usdt: number, createdAt: Date, replier?: string, operator?: string}]
    },
    // saved bills history (array of snapshots)
    history: [],
  }
}

function getChat(botId, chatId) {
  const botChats = ensureBot(botId)
  if (!botChats.has(chatId)) {
    botChats.set(chatId, createInitialChatState())
  }
  return botChats.get(chatId)
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

export { getChat, parseAmountAndRate, calcUSDT, summarize, safeCalculate }
