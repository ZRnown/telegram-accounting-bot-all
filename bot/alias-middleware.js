// 全局命令别名中间件（按机器人配置）
import { getGlobalConfig } from './utils.js'
import { prisma } from '../lib/db.js'

const TTL_MS = 5 * 60 * 1000
let cache = { data: null, expires: 0, botId: null }
let botIdCache = { id: null, expires: 0 }

async function getCurrentBotId() {
  const now = Date.now()
  if (botIdCache.id && botIdCache.expires > now) return botIdCache.id
  try {
    const token = (process.env.BOT_TOKEN || '').trim()
    if (!token) return null
    const row = await prisma.bot.findFirst({ where: { token }, select: { id: true } })
    const id = row?.id || null
    botIdCache = { id, expires: now + TTL_MS }
    return id
  } catch {
    return null
  }
}

async function loadAliasConfig() {
  const now = Date.now()
  const botId = await getCurrentBotId()
  if (cache.data && cache.expires > now && cache.botId === botId) return cache.data
  try {
    let raw = '{}'
    if (botId) {
      raw = await getGlobalConfig(`command_alias_map:${botId}`, '{}')
    } else {
      // 兼容旧全局键（无botId时）
      raw = await getGlobalConfig('command_alias_map', '{}')
    }
    let obj
    try { obj = JSON.parse(raw) } catch { obj = {} }
    const cfg = {
      exact_map: obj?.exact_map && typeof obj.exact_map === 'object' ? obj.exact_map : {},
      prefix_map: obj?.prefix_map && typeof obj.prefix_map === 'object' ? obj.prefix_map : {},
    }
    cache = { data: cfg, expires: now + TTL_MS, botId }
    return cfg
  } catch {
    const empty = { exact_map: {}, prefix_map: {} }
    cache = { data: empty, expires: now + TTL_MS, botId }
    return empty
  }
}

function applyExactMap(text, exactMap) {
  const t = (text || '').trim()
  if (!t) return text
  const keys = Object.keys(exactMap)
  for (const k of keys) {
    if (typeof k === 'string' && t.toLowerCase() === String(k).trim().toLowerCase()) {
      return exactMap[k]
    }
  }
  return text
}

function applyPrefixMap(text, prefixMap) {
  let out = text
  const keys = Object.keys(prefixMap)
  for (const k of keys) {
    const v = prefixMap[k]
    if (typeof k !== 'string' || typeof v !== 'string') continue
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^(${escaped})(\\s|$)`, 'i')
    out = out.replace(re, (_, _m1, m2) => `${v}${m2 || ''}`)
  }
  return out
}

export function createAliasMiddleware() {
  return async (ctx, next) => {
    try {
      const text = ctx.message?.text
      if (!text) return next()
      if (!ctx.chat || ctx.chat.type === 'channel') return next()

      const cfg = await loadAliasConfig()
      let newText = text
      // 先做精确映射，再做前缀映射
      newText = applyExactMap(newText, cfg.exact_map)
      newText = applyPrefixMap(newText, cfg.prefix_map)

      if (newText !== text) {
        // 覆盖消息文本，让后续 handlers 的正则按规范命令匹配
        ctx.message.text = newText
      }
    } catch (e) {
      // 出错时忽略映射，直接放行
    }
    return next()
  }
}

export async function __aliasRefreshForTest() {
  // 测试用途：主动刷新缓存
  cache = { data: null, expires: 0, botId: null }
  botIdCache = { id: null, expires: 0 }
  return loadAliasConfig()
}
