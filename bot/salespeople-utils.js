export const SALESPEOPLE_CONFIG_KEY = 'salespeople_user_ids'
export const SALESPEOPLE_GROUP_BUTTON_CONFIG_KEY = 'salespeople_show_in_group'

function uniquePush(list, seen, value) {
  if (!value || seen.has(value)) return
  seen.add(value)
  list.push(value)
}

export function parseSalespersonTokens(input) {
  const text = String(input || '').trim()
  if (!text) {
    return { userIds: [], usernames: [], invalid: [] }
  }

  const rawTokens = text
    .split(/[\s,，]+/)
    .map(token => token.trim())
    .filter(Boolean)

  const userIds = []
  const usernames = []
  const invalid = []
  const seenIds = new Set()
  const seenUsernames = new Set()
  const seenInvalid = new Set()

  for (const rawToken of rawTokens) {
    const token = rawToken.startsWith('@') ? rawToken.slice(1) : rawToken
    if (!token) continue

    if (/^\d+$/.test(token)) {
      uniquePush(userIds, seenIds, token)
      continue
    }

    if (/^[A-Za-z][A-Za-z0-9_]{2,}$/.test(token)) {
      uniquePush(usernames, seenUsernames, token.toLowerCase())
      continue
    }

    if (!seenInvalid.has(rawToken)) {
      seenInvalid.add(rawToken)
      invalid.push(rawToken)
    }
  }

  return { userIds, usernames, invalid }
}

export function parseSalespersonConfigValue(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(String(value))
    if (!Array.isArray(parsed)) return []

    const ids = []
    const seen = new Set()
    for (const item of parsed) {
      const id = String(item || '').trim()
      if (!id || !/^\d+$/.test(id) || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
    return ids
  } catch {
    return []
  }
}

export function parseSalespersonConfigEntries(value) {
  if (!value) return []
  try {
    const parsed = JSON.parse(String(value))
    if (!Array.isArray(parsed)) return []

    const entries = []
    const seenIds = new Set()
    const seenUsernames = new Set()

    for (const item of parsed) {
      if (typeof item === 'string') {
        const id = String(item || '').trim()
        if (!id || !/^\d+$/.test(id) || seenIds.has(id)) continue
        seenIds.add(id)
        entries.push({ userId: id, username: null, note: null })
        continue
      }

      if (!item || typeof item !== 'object') continue
      const userId = String(item.userId || '').trim()
      const username = String(item.username || '').trim().toLowerCase()
      const note = item.note ? String(item.note) : null

      if (userId && /^\d+$/.test(userId) && !seenIds.has(userId)) {
        seenIds.add(userId)
        entries.push({ userId, username: username || null, note })
        continue
      }

      if (username && /^[A-Za-z][A-Za-z0-9_]{2,}$/.test(username) && !seenUsernames.has(username)) {
        seenUsernames.add(username)
        entries.push({ userId: null, username, note })
      }
    }

    return entries
  } catch {
    return []
  }
}

export function buildSalespersonEntriesFromTokens(parsedTokens) {
  const entries = []
  for (const userId of parsedTokens.userIds || []) {
    entries.push({ userId, username: null, note: null })
  }
  for (const username of parsedTokens.usernames || []) {
    entries.push({ userId: null, username, note: null })
  }
  return entries
}

export function parseSalespeopleGroupButtonValue(value, defaultValue = true) {
  if (value == null || value === '') return defaultValue
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'on', 'yes', 'y', '开', '显示'].includes(normalized)) return true
  if (['0', 'false', 'off', 'no', 'n', '关', '隐藏'].includes(normalized)) return false
  return defaultValue
}

export function buildSalespersonListText(salespeople) {
  if (!Array.isArray(salespeople) || salespeople.length === 0) {
    return '📭 暂未设置业务员'
  }

  const lines = ['👥 业务员列表', '']
  salespeople.forEach((person, index) => {
    const username = person?.username ? `@${person.username}` : null
    const id = String(person?.userId || '').trim()
    const title = username && id
      ? `${index + 1}. ${username} (ID: ${id})`
      : (username ? `${index + 1}. ${username}` : `${index + 1}. ID: ${id || '-'}`)
    lines.push(title)
    if (person?.note) {
      lines.push(`   备注：${person.note}`)
    }
  })

  return lines.join('\n')
}
