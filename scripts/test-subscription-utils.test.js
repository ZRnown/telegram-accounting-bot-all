import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SUBSCRIPTION_CONFIG_KEYS,
  buildSubscriptionExpiryKey,
  buildSubscriptionTxKey,
  parseSubscriptionDays,
  parseSubscriptionPrice,
  normalizeSubscriptionTxid,
  calculateExtendedExpiry
} from '../bot/subscription-utils.js'

test('uses stable subscription config keys', () => {
  assert.equal(SUBSCRIPTION_CONFIG_KEYS.trialDays, 'subscription_trial_days')
  assert.equal(SUBSCRIPTION_CONFIG_KEYS.usdtPerDay, 'subscription_usdt_per_day')
  assert.equal(SUBSCRIPTION_CONFIG_KEYS.receiveAddress, 'subscription_receive_address')
})

test('builds subscription dynamic keys', () => {
  assert.equal(buildSubscriptionExpiryKey('-100123'), 'subscription_chat_expires:-100123')
  assert.equal(buildSubscriptionTxKey('abc'), 'subscription_tx:abc')
})

test('parses subscription days and price safely', () => {
  assert.equal(parseSubscriptionDays('7', 0), 7)
  assert.equal(parseSubscriptionDays('-1', 9), 9)
  assert.equal(parseSubscriptionPrice('1.25', 0), 1.25)
  assert.equal(parseSubscriptionPrice('0', 2), 2)
})

test('normalizes txid to lowercase hex with fixed length', () => {
  const txid = 'A'.repeat(64)
  assert.equal(normalizeSubscriptionTxid(txid), 'a'.repeat(64))
  assert.equal(normalizeSubscriptionTxid('abc'), null)
})

test('extends expiry from max(now, currentExpiry)', () => {
  const now = new Date('2026-02-18T00:00:00.000Z')
  const activeExpiry = new Date('2026-02-20T00:00:00.000Z')
  const expiredExpiry = new Date('2026-02-16T00:00:00.000Z')

  const e1 = calculateExtendedExpiry(activeExpiry, 3, now)
  const e2 = calculateExtendedExpiry(expiredExpiry, 3, now)

  assert.equal(e1.toISOString(), '2026-02-23T00:00:00.000Z')
  assert.equal(e2.toISOString(), '2026-02-21T00:00:00.000Z')
})
