export const SUBSCRIPTION_CONFIG_KEYS = {
  trialDays: 'subscription_trial_days',
  usdtPerDay: 'subscription_usdt_per_day',
  receiveAddress: 'subscription_receive_address'
}

export function buildSubscriptionExpiryKey(chatId) {
  return `subscription_chat_expires:${String(chatId || '').trim()}`
}

export function buildSubscriptionTxKey(txid) {
  return `subscription_tx:${String(txid || '').trim().toLowerCase()}`
}

export function parseSubscriptionDays(value, defaultValue = 7) {
  const n = parseInt(String(value || ''), 10)
  if (!Number.isFinite(n) || n <= 0) return defaultValue
  return n
}

export function parseSubscriptionPrice(value, defaultValue = 1) {
  const n = Number(String(value || ''))
  if (!Number.isFinite(n) || n <= 0) return defaultValue
  return Number(n.toFixed(6))
}

export function normalizeSubscriptionTxid(value) {
  const txid = String(value || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(txid)) return null
  return txid
}

export function calculateExtendedExpiry(currentExpiry, days, now = new Date()) {
  const dayMs = 24 * 60 * 60 * 1000
  const base = currentExpiry instanceof Date && Number.isFinite(currentExpiry.getTime()) && currentExpiry > now
    ? currentExpiry
    : now
  return new Date(base.getTime() + days * dayMs)
}

export function formatSubscriptionExpiry(expiry) {
  if (!(expiry instanceof Date) || !Number.isFinite(expiry.getTime())) return '未开通'
  return expiry.toLocaleString('zh-CN', { hour12: false })
}
