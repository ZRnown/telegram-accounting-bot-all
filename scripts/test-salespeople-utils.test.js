import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SALESPEOPLE_CONFIG_KEY,
  parseSalespersonTokens,
  parseSalespersonConfigValue,
  buildSalespersonListText
} from '../bot/salespeople-utils.js'

test('uses stable config key for salespeople', () => {
  assert.equal(SALESPEOPLE_CONFIG_KEY, 'salespeople_user_ids')
})

test('parses mixed user ids and usernames', () => {
  const parsed = parseSalespersonTokens('12345 @alice bob\n67890')

  assert.deepEqual(parsed.userIds, ['12345', '67890'])
  assert.deepEqual(parsed.usernames, ['alice', 'bob'])
  assert.deepEqual(parsed.invalid, [])
})

test('filters duplicates and invalid tokens', () => {
  const parsed = parseSalespersonTokens('@alice ALICE abc-1 12345 12345')

  assert.deepEqual(parsed.userIds, ['12345'])
  assert.deepEqual(parsed.usernames, ['alice'])
  assert.deepEqual(parsed.invalid, ['abc-1'])
})

test('parses config json to unique ids', () => {
  const ids = parseSalespersonConfigValue('["123","123","456"]')
  assert.deepEqual(ids, ['123', '456'])
})

test('builds readable salesperson list message', () => {
  const text = buildSalespersonListText([
    { userId: '123', username: 'alice', note: '客服A' },
    { userId: '456', username: null, note: null }
  ])

  assert.equal(text.includes('1. @alice'), true)
  assert.equal(text.includes('2. ID: 456'), true)
  assert.equal(text.includes('备注：客服A'), true)
})
