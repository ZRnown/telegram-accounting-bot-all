// USDT TRC20 监听核心模块
// 使用轮询方式监听USDT转账（避免TronWeb事件监听的兼容性问题）

import { prisma } from '../lib/db.js'

const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const TRONSCAN_TRC20_TRANSFERS_API = 'https://apilist.tronscanapi.com/api/token_trc20/transfers'

// 存储每个地址的最后交易ID，避免重复通知
const lastTransactionIds = new Map()

// 存储活跃的监听器
const activeMonitors = new Map()

// 监听回调函数
let transferCallback = null

/**
 * 设置转账通知回调
 * @param {Function} callback - 回调函数 (userId, transferInfo) => void
 */
export function setTransferCallback(callback) {
  transferCallback = callback
}

/**
 * 查询地址的最近交易
 * @param {string} address - TRC20地址
 * @returns {Promise<Array>} 交易列表
 */
async function fetchRecentTransfers(address) {
  try {
    const url = `${TRONSCAN_TRC20_TRANSFERS_API}?relatedAddress=${address}&contract_address=${USDT_CONTRACT}&limit=5&start=0`
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000)
    })

    if (!response.ok) {
      console.error('[USDT Monitor] API请求失败:', response.status)
      return []
    }

    const data = await response.json()
    return data.token_transfers || []
  } catch (e) {
    console.error('[USDT Monitor] 查询交易失败:', e.message)
    return []
  }
}

/**
 * 检查地址是否有新交易
 * @param {string} address - TRC20地址
 * @param {string} userId - 用户ID
 */
async function checkForNewTransfers(address, userId) {
  const transfers = await fetchRecentTransfers(address)

  if (transfers.length === 0) return

  const lastTxId = lastTransactionIds.get(address)
  const latestTx = transfers[0]
  const latestTxId = latestTx.transaction_id || latestTx.hash

  // 如果是首次检查，只记录最新交易ID，不发送通知
  if (!lastTxId) {
    lastTransactionIds.set(address, latestTxId)
    return
  }

  // 如果有新交易
  if (latestTxId !== lastTxId) {
    // 找出所有新交易
    const newTransfers = []
    for (const tx of transfers) {
      const txId = tx.transaction_id || tx.hash
      if (txId === lastTxId) break
      newTransfers.push(tx)
    }

    // 更新最新交易ID
    lastTransactionIds.set(address, latestTxId)

    // 发送通知（按时间顺序，从旧到新）
    for (const tx of newTransfers.reverse()) {
      if (transferCallback) {
        const from = tx.from_address || tx.fromAddress || ''
        const to = tx.to_address || tx.toAddress || ''
        const quant = tx.quant || tx.value || tx.amount || '0'
        const decimals = tx.tokenInfo?.tokenDecimal || 6
        const amount = Number(quant) / Math.pow(10, decimals)
        const timestamp = tx.block_ts || tx.timestamp || Date.now()
        const txId = tx.transaction_id || tx.hash || ''

        const isIncoming = to === address
        const direction = isIncoming ? 'in' : 'out'

        transferCallback(userId, {
          address,
          from,
          to,
          amount,
          direction,
          txid: txId,
          timestamp: new Date(timestamp)
        })
      }
    }
  }
}

/**
 * 启动地址监听
 * @param {string} address - TRC20地址
 * @param {string} userId - 用户ID
 */
export function startMonitor(address, userId) {
  const key = `${userId}_${address}`

  // 如果已经在监听，跳过
  if (activeMonitors.has(key)) {
    return
  }

  console.log(`[USDT Monitor] 开始监听地址: ${address} (用户: ${userId})`)

  // 每30秒检查一次
  const intervalId = setInterval(async () => {
    try {
      await checkForNewTransfers(address, userId)
    } catch (e) {
      console.error(`[USDT Monitor] 检查失败 (${address}):`, e.message)
    }
  }, 30000)

  // 立即检查一次（初始化最新交易ID）
  checkForNewTransfers(address, userId).catch(() => {})

  activeMonitors.set(key, intervalId)
}

/**
 * 停止地址监听
 * @param {string} address - TRC20地址
 * @param {string} userId - 用户ID
 */
export function stopMonitor(address, userId) {
  const key = `${userId}_${address}`

  const intervalId = activeMonitors.get(key)
  if (intervalId) {
    clearInterval(intervalId)
    activeMonitors.delete(key)
    lastTransactionIds.delete(address)
    console.log(`[USDT Monitor] 停止监听地址: ${address} (用户: ${userId})`)
  }
}

/**
 * 从数据库加载并启动所有监听
 */
export async function loadAllMonitors() {
  try {
    const monitors = await prisma.usdtMonitor.findMany({
      where: { enabled: true }
    })

    console.log(`[USDT Monitor] 加载 ${monitors.length} 个监听地址`)

    for (const monitor of monitors) {
      startMonitor(monitor.address, monitor.userId)
    }
  } catch (e) {
    console.error('[USDT Monitor] 加载监听失败:', e.message)
  }
}

/**
 * 添加新的监听地址
 * @param {string} userId - 用户ID
 * @param {string} address - TRC20地址
 */
export async function addMonitor(userId, address) {
  try {
    // 验证地址格式
    if (!address || address.length !== 34 || !address.startsWith('T')) {
      throw new Error('无效的TRC20地址格式')
    }

    // 保存到数据库
    await prisma.usdtMonitor.upsert({
      where: {
        userId_address: { userId, address }
      },
      update: { enabled: true },
      create: { userId, address, enabled: true }
    })

    // 启动监听
    startMonitor(address, userId)

    return { success: true }
  } catch (e) {
    console.error('[USDT Monitor] 添加监听失败:', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * 移除监听地址
 * @param {string} userId - 用户ID
 * @param {string} address - TRC20地址
 */
export async function removeMonitor(userId, address) {
  try {
    // 从数据库删除
    await prisma.usdtMonitor.deleteMany({
      where: { userId, address }
    })

    // 停止监听
    stopMonitor(address, userId)

    return { success: true }
  } catch (e) {
    console.error('[USDT Monitor] 移除监听失败:', e.message)
    return { success: false, error: e.message }
  }
}

/**
 * 获取用户的所有监听地址
 * @param {string} userId - 用户ID
 */
export async function getUserMonitors(userId) {
  try {
    return await prisma.usdtMonitor.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    })
  } catch (e) {
    console.error('[USDT Monitor] 获取监听列表失败:', e.message)
    return []
  }
}
