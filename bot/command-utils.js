function normalizeText(value) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

export function getMessageTextOrCaption(message) {
  if (!message) return ''
  return normalizeText(message.text || message.caption || '')
}

export function isAccountingCommandText(text) {
  const t = normalizeText(text)
  if (!t) return false
  if (/^(开始记账|开始|停止记账|停止)$/i.test(t)) return true
  if (/^[+\-]\s*[\d+\-*/.()]/i.test(t)) return true
  if (/^下发(?:\s|$)/.test(t)) return true
  if (/^(显示账单|\+0)$/i.test(t)) return true
  if (/^显示历史账单$/i.test(t)) return true
  if (/^(保存账单|删除账单|删除全部账单|清除全部账单)$/i.test(t)) return true
  if (/^(我的账单|\/我)$/i.test(t)) return true
  return false
}

export function isClassControlCommand(text) {
  const t = normalizeText(text)
  if (!t) return false
  return /^(上课|开始上课|下课|解除禁言|开口)$/i.test(t)
}

function hasCaptionCarrier(message) {
  if (!message) return false
  if (Array.isArray(message.photo) && message.photo.length > 0) return true
  if (message.video) return true
  if (message.document) return true
  if (message.animation) return true
  return false
}

export function shouldPromoteCaptionToText(message) {
  if (!message || !hasCaptionCarrier(message)) return false

  const existingText = normalizeText(message.text)
  if (existingText) return false

  const caption = normalizeText(message.caption)
  if (!caption) return false

  return isAccountingCommandText(caption) || isClassControlCommand(caption)
}

export function promoteCaptionToText(ctx) {
  const message = ctx?.message
  if (!shouldPromoteCaptionToText(message)) return false

  message.text = normalizeText(message.caption)
  return true
}

export function getMuteChatPermissions() {
  return {
    can_send_messages: false,
    can_send_media_messages: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
    can_change_info: false,
    can_invite_users: false,
    can_pin_messages: false
  }
}

export function getUnmuteChatPermissions() {
  return {
    can_send_messages: true,
    can_send_media_messages: true,
    can_send_polls: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
    can_change_info: true,
    can_invite_users: true,
    can_pin_messages: true
  }
}
