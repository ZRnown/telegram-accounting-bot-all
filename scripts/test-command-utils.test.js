import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isAccountingCommandText,
  isClassControlCommand,
  shouldPromoteCaptionToText,
  getMuteChatPermissions,
  getUnmuteChatPermissions
} from '../bot/command-utils.js'

test('promotes photo captions that look like accounting commands', () => {
  const message = {
    photo: [{ file_id: 'abc' }],
    caption: ' +321-21 '
  }

  assert.equal(shouldPromoteCaptionToText(message), true)
})

test('does not promote unrelated captions', () => {
  const message = {
    photo: [{ file_id: 'abc' }],
    caption: '这是一张普通图片'
  }

  assert.equal(shouldPromoteCaptionToText(message), false)
})

test('recognizes class control commands with spaces', () => {
  assert.equal(isClassControlCommand('  下课  '), true)
  assert.equal(isClassControlCommand('开始上课'), true)
  assert.equal(isClassControlCommand('下发100'), false)
})

test('keeps accounting command matcher behavior', () => {
  assert.equal(isAccountingCommandText('-321'), true)
  assert.equal(isAccountingCommandText('下发 500'), true)
  assert.equal(isAccountingCommandText('今天真开心'), false)
})

test('mute permissions keep backward-compatible chat fields', () => {
  const permissions = getMuteChatPermissions()

  assert.equal(permissions.can_send_messages, false)
  assert.equal(permissions.can_send_media_messages, false)
  assert.equal(permissions.can_send_polls, false)
  assert.equal('can_send_photos' in permissions, false)
})

test('unmute permissions restore backward-compatible chat fields', () => {
  const permissions = getUnmuteChatPermissions()

  assert.equal(permissions.can_send_messages, true)
  assert.equal(permissions.can_send_media_messages, true)
  assert.equal(permissions.can_send_other_messages, true)
  assert.equal('can_send_photos' in permissions, false)
})
