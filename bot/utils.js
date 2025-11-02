// 工具函数
import { prisma } from '../lib/db.ts'
import { getChat } from './state.js'

// LRU 缓存用于全局配置
const globalConfigCache = new Map()
const GLOBAL_CONFIG_TTL_MS = 5 * 60 * 1000 // 5分钟过期

/**
 * 获取全局配置
 * @param {string} key - 配置键
 * @param {string} defaultValue - 默认值
 * @returns {Promise<string>}
 */
export async function getGlobalConfig(key, defaultValue = '') {
  try {
    const cached = globalConfigCache.get(key)
    if (cached && cached.expires > Date.now()) {
      return cached.value
    }

    const config = await prisma.globalConfig.findUnique({
      where: { key },
      select: { value: true }
    })

    const value = config?.value || defaultValue
    globalConfigCache.set(key, {
      value,
      expires: Date.now() + GLOBAL_CONFIG_TTL_MS
    })

    return value
  } catch (e) {
    console.error(`[getGlobalConfig] 获取全局配置失败: ${key}`, e)
    return defaultValue
  }
}

/**
 * 设置全局配置
 * @param {string} key - 配置键
 * @param {string} value - 配置值
 * @param {string} description - 描述
 * @param {string} updatedBy - 更新人
 * @returns {Promise<void>}
 */
export async function setGlobalConfig(key, value, description = null, updatedBy = null) {
  try {
    await prisma.globalConfig.upsert({
      where: { key },
      create: {
        key,
        value,
        description,
        updatedBy
      },
      update: {
        value,
        description,
        updatedBy,
        updatedAt: new Date()
      }
    })

    // 清除缓存
    globalConfigCache.delete(key)
  } catch (e) {
    console.error(`[setGlobalConfig] 设置全局配置失败: ${key}`, e)
    throw e
  }
}

/**
 * 获取全局日切时间（所有群都要应用）
 * @returns {Promise<number>} 日切小时（0-23）
 */
export async function getGlobalDailyCutoffHour() {
  const value = await getGlobalConfig('daily_cutoff_hour', '0')
  const hour = parseInt(value, 10)
  return isNaN(hour) || hour < 0 || hour > 23 ? 0 : hour
}

/**
 * 设置全局日切时间
 * @param {number} hour - 日切小时（0-23）
 * @param {string} updatedBy - 更新人
 * @returns {Promise<void>}
 */
export async function setGlobalDailyCutoffHour(hour, updatedBy = null) {
  if (hour < 0 || hour > 23) {
    throw new Error('日切时间必须在 0-23 之间')
  }
  await setGlobalConfig(
    'daily_cutoff_hour',
    hour.toString(),
    '全局日切时间（小时，0-23），所有群组都会应用此配置',
    updatedBy
  )
}

/**
 * 格式化金额
 */
export function formatMoney(n) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

/**
 * 格式化时长
 */
export function formatDuration(ms) {
  const sec = Math.floor(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const parts = []
  if (h) parts.push(`${h}小时`)
  if (m) parts.push(`${m}分`)
  if (s || parts.length === 0) parts.push(`${s}秒`)
  return parts.join('')
}

// 🔥 isAdmin 和 getUsername 已移至 helpers.js（helpers.js 中的版本更完整）
// 保留这些函数仅为了向后兼容，但建议使用 helpers.js 中的版本

/**
 * 检查是否是公开URL
 */
export function isPublicUrl(u) {
  try {
    const url = new URL(u)
    const host = url.hostname
    if (!/^https?:$/.test(url.protocol)) return false
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false
    return true
  } catch {
    return false
  }
}

/**
 * 日切时间函数 - 支持自定义小时
 * @param {Date} d - 基准日期
 * @param {number} cutoffHour - 日切小时（0-23），默认0点
 * @returns {Date} 当天日切时间点
 */
export function startOfDay(d = new Date(), cutoffHour = 0) {
  const x = new Date(d)
  x.setHours(cutoffHour, 0, 0, 0)
  
  // 如果当前时间在日切点之前，需要退到前一天的日切点
  if (d.getHours() < cutoffHour) {
    x.setDate(x.getDate() - 1)
  }
  
  return x
}

export function endOfDay(d = new Date(), cutoffHour = 0) {
  const x = new Date(d)
  x.setDate(x.getDate() + 1)
  x.setHours(cutoffHour, 0, 0, 0)
  
  // 如果当前时间在日切点之前，endOfDay 也要相应调整
  if (d.getHours() < cutoffHour) {
    x.setDate(x.getDate() - 1)
  }
  
  return x
}

