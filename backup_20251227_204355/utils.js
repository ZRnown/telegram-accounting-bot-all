// 工具函数
import { prisma } from '../lib/db.js'
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
    // 拒绝本地与常见内网主机名
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false
    // IPv4 判定
    const ipv4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
    const isIPv4 = ipv4.test(host)
    if (isIPv4) {
      // 排除常见内网网段
      const parts = host.split('.').map(n => parseInt(n, 10))
      const [a, b] = parts
      const isPrivate =
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      return !isPrivate
    }
    // 非 IP：要求域名包含点，避免像 'ip' 这样的伪域名
    if (!host.includes('.')) return false
    return true
  } catch {
    return false
  }
}

/**
 * 日切时间函数 - 支持自定义小时
 * 🔥 修复：统一日切逻辑，与 getOrCreateTodayBill 保持一致
 * 
 * @param {Date} d - 基准日期
 * @param {number} cutoffHour - 日切小时（0-23），默认0点
 * @returns {Date} 当前应该归入的账单周期的开始时间
 * 
 * 逻辑说明：
 * - 如果当前时间是3号上午10点，日切是2点，返回3号02:00（今天账单的开始）
 * - 如果当前时间是3号凌晨1点，日切是2点，返回2号02:00（昨天账单的开始）
 */
export function startOfDay(d = new Date(), cutoffHour = 0) {
  const now = new Date(d)

  // 计算今天的日切开始时间
  const todayCutoff = new Date()
  todayCutoff.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
  todayCutoff.setHours(cutoffHour, 0, 0, 0)

  // 判断当前时间是否已经过了今天的日切点
  if (now >= todayCutoff) {
    // 当前时间 >= 今天的日切时间，返回今天账单的开始时间
    return new Date(todayCutoff)
  } else {
    // 当前时间 < 今天的日切时间，返回昨天账单的开始时间
    const yesterdayCutoff = new Date(todayCutoff)
    yesterdayCutoff.setDate(yesterdayCutoff.getDate() - 1)
    return yesterdayCutoff
  }
}

/**
 * 日切时间函数 - 计算当前应该归入的账单周期的结束时间
 * @param {Date} d - 基准日期
 * @param {number} cutoffHour - 日切小时（0-23），默认0点
 * @returns {Date} 当前应该归入的账单周期的结束时间
 */
export function endOfDay(d = new Date(), cutoffHour = 0) {
  const start = startOfDay(d, cutoffHour)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return end
}

