import { prisma } from '../lib/db.js'
import { getGlobalConfig, setGlobalConfig } from './utils.js'
import {
  SUBSCRIPTION_CONFIG_KEYS,
  buildSubscriptionExpiryKey,
  buildSubscriptionTxKey,
  calculateExtendedExpiry,
  normalizeSubscriptionTxid,
  parseSubscriptionDays,
  parseSubscriptionPrice
} from './subscription-utils.js'

const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const TRONSCAN_TRC20_TRANSFERS_API = 'https://apilist.tronscanapi.com/api/token_trc20/transfers'

export async function getSubscriptionConfig() {
  const [trialDaysRaw, usdtPerDayRaw, receiveAddressRaw] = await Promise.all([
    getGlobalConfig(SUBSCRIPTION_CONFIG_KEYS.trialDays, '7'),
    getGlobalConfig(SUBSCRIPTION_CONFIG_KEYS.usdtPerDay, '1'),
    getGlobalConfig(SUBSCRIPTION_CONFIG_KEYS.receiveAddress, '')
  ])

  const trialDays = Math.min(365, Math.max(1, parseSubscriptionDays(trialDaysRaw, 7)))
  const usdtPerDay = parseSubscriptionPrice(usdtPerDayRaw, 1)
  const receiveAddress = String(receiveAddressRaw || '').trim()
  return { trialDays, usdtPerDay, receiveAddress }
}

export async function setSubscriptionConfig({ trialDays, usdtPerDay, receiveAddress }, updatedBy = null) {
  const ops = []
  if (trialDays != null) {
    ops.push(setGlobalConfig(
      SUBSCRIPTION_CONFIG_KEYS.trialDays,
      String(Math.min(365, Math.max(1, parseSubscriptionDays(trialDays, 7)))),
      '机器人免费试用天数',
      updatedBy
    ))
  }
  if (usdtPerDay != null) {
    ops.push(setGlobalConfig(
      SUBSCRIPTION_CONFIG_KEYS.usdtPerDay,
      String(parseSubscriptionPrice(usdtPerDay, 1)),
      '机器人续费单价（USDT/天）',
      updatedBy
    ))
  }
  if (receiveAddress != null) {
    ops.push(setGlobalConfig(
      SUBSCRIPTION_CONFIG_KEYS.receiveAddress,
      String(receiveAddress || '').trim(),
      '机器人续费收款地址（TRC20）',
      updatedBy
    ))
  }
  await Promise.all(ops)
}

export async function getChatSubscriptionExpiry(chatId) {
  const key = buildSubscriptionExpiryKey(chatId)
  const raw = await getGlobalConfig(key, '')
  if (!raw) return null
  const date = new Date(raw)
  if (!Number.isFinite(date.getTime())) return null
  return date
}

export async function setChatSubscriptionExpiry(chatId, expiresAt, updatedBy = null) {
  const key = buildSubscriptionExpiryKey(chatId)
  if (!expiresAt) {
    await prisma.globalConfig.deleteMany({ where: { key } }).catch(() => {})
    return
  }
  await setGlobalConfig(
    key,
    expiresAt.toISOString(),
    '群组订阅到期时间',
    updatedBy
  )
}

export async function ensureChatSubscription(chatId, updatedBy = 'system') {
  const exists = await getChatSubscriptionExpiry(chatId)
  if (exists) return exists
  const { trialDays } = await getSubscriptionConfig()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000)
  await setChatSubscriptionExpiry(chatId, expiresAt, updatedBy)
  return expiresAt
}

export async function getChatSubscriptionStatus(chatId) {
  const expiry = await ensureChatSubscription(chatId, 'system')
  const now = Date.now()
  const remainingMs = expiry.getTime() - now
  return {
    expiresAt: expiry,
    active: remainingMs > 0,
    remainingMs
  }
}

async function fetchRecentTransfers(address) {
  const url = `${TRONSCAN_TRC20_TRANSFERS_API}?relatedAddress=${address}&contract_address=${USDT_CONTRACT}&limit=50&start=0`
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) })
  if (!response.ok) {
    throw new Error(`TRONSCAN_HTTP_${response.status}`)
  }
  const data = await response.json()
  return Array.isArray(data?.token_transfers) ? data.token_transfers : []
}

async function findUsdtTransferByTxid(address, txid) {
  const normalizedAddress = String(address || '').trim()
  const normalizedTxid = normalizeSubscriptionTxid(txid)
  if (!normalizedAddress || !normalizedTxid) {
    return { found: false, reason: 'INVALID_INPUT' }
  }

  const transfers = await fetchRecentTransfers(normalizedAddress)
  const hit = transfers.find(item => {
    const currentTxid = String(item.transaction_id || item.hash || '').toLowerCase()
    return currentTxid === normalizedTxid
  })

  if (!hit) return { found: false, reason: 'TX_NOT_FOUND' }

  const to = String(hit.to_address || hit.toAddress || '')
  const from = String(hit.from_address || hit.fromAddress || '')
  const quant = hit.quant || hit.value || hit.amount || '0'
  const decimals = Number(hit.tokenInfo?.tokenDecimal || 6)
  const amount = Number(quant) / Math.pow(10, decimals)
  const symbol = String(hit.tokenInfo?.tokenAbbr || hit.tokenInfo?.tokenName || 'USDT').toUpperCase()
  const timestamp = Number(hit.block_ts || hit.timestamp || Date.now())

  if (to !== normalizedAddress) {
    return { found: false, reason: 'WRONG_TO_ADDRESS', details: { to, expected: normalizedAddress } }
  }
  if (symbol !== 'USDT') {
    return { found: false, reason: 'NOT_USDT' }
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { found: false, reason: 'INVALID_AMOUNT' }
  }

  return {
    found: true,
    transfer: {
      txid: normalizedTxid,
      from,
      to,
      amount: Number(amount.toFixed(6)),
      timestamp: new Date(timestamp)
    }
  }
}

export async function renewChatSubscriptionByTx({ chatId, days, txid, updatedBy = null }) {
  const normalizedTxid = normalizeSubscriptionTxid(txid)
  if (!normalizedTxid) return { ok: false, reason: 'INVALID_TXID' }

  const daysSafe = Math.min(365, Math.max(1, parseSubscriptionDays(days, 0)))
  if (!daysSafe) return { ok: false, reason: 'INVALID_DAYS' }

  const txKey = buildSubscriptionTxKey(normalizedTxid)
  const txUsed = await prisma.globalConfig.findUnique({ where: { key: txKey }, select: { value: true } })
  if (txUsed?.value) return { ok: false, reason: 'TX_USED' }

  const { usdtPerDay, receiveAddress } = await getSubscriptionConfig()
  if (!receiveAddress) return { ok: false, reason: 'ADDRESS_NOT_SET' }

  const requiredAmount = Number((daysSafe * usdtPerDay).toFixed(6))
  const txResult = await findUsdtTransferByTxid(receiveAddress, normalizedTxid)
  if (!txResult.found) return { ok: false, reason: txResult.reason }

  const amountPaid = txResult.transfer.amount
  if (amountPaid + 1e-9 < requiredAmount) {
    return { ok: false, reason: 'INSUFFICIENT_AMOUNT', requiredAmount, amountPaid }
  }

  const currentExpiry = await getChatSubscriptionExpiry(chatId)
  const nextExpiry = calculateExtendedExpiry(currentExpiry, daysSafe, new Date())
  await setChatSubscriptionExpiry(chatId, nextExpiry, updatedBy)

  await setGlobalConfig(
    txKey,
    JSON.stringify({
      chatId: String(chatId),
      days: daysSafe,
      amountPaid,
      requiredAmount,
      usedAt: new Date().toISOString(),
      from: txResult.transfer.from,
      to: txResult.transfer.to
    }),
    '订阅续费交易去重记录',
    updatedBy
  )

  return {
    ok: true,
    expiresAt: nextExpiry,
    days: daysSafe,
    amountPaid,
    requiredAmount
  }
}
