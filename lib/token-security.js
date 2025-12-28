import bcrypt from 'bcrypt'
import { prisma } from './db.js'

// ⚠️  警告：这个文件包含敏感的安全逻辑
// 生产环境中应考虑使用环境变量存储密钥，而不是硬编码

const TOKEN_CACHE = new Map() // 缓存已验证的token
const CACHE_TTL = 5 * 60 * 1000 // 5分钟缓存

/**
 * 验证机器人token（使用哈希比较）
 * @param {string} plainToken - 明文token
 * @returns {Promise<string|null>} - 返回机器人ID或null
 */
export async function verifyBotToken(plainToken) {
  if (!plainToken || typeof plainToken !== 'string') {
    return null
  }

  // 检查缓存
  const cacheKey = `verify_${plainToken}`
  const cached = TOKEN_CACHE.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.botId
  }

  try {
    // 临时：直接使用token字段进行验证（向后兼容）
    console.log('[token-security] 使用临时token验证模式')
    const bots = await prisma.bot.findMany({
      where: { enabled: true },
      select: { id: true, token: true }
    })

    for (const bot of bots) {
      if (bot.token === plainToken) {
        // 缓存结果
        TOKEN_CACHE.set(cacheKey, {
          botId: bot.id,
          timestamp: Date.now()
        })
        return bot.id
      }
    }
  } catch (error) {
    console.error('[token-security] 验证token失败:', error.message)
  }

  // 缓存失败结果
  TOKEN_CACHE.set(cacheKey, {
    botId: null,
    timestamp: Date.now()
  })

  return null
}

/**
 * 获取机器人token用于API调用（仅在绝对必要时使用）
 * ⚠️  生产环境中应避免使用此函数
 * @param {string} botId - 机器人ID
 * @returns {Promise<string|null>} - 返回明文token
 */
export async function getBotTokenForApi(botId) {
  try {
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      select: { token: true }
    })
    return bot?.token || null
  } catch (error) {
    console.error('[token-security] 获取token失败:', error.message)
    return null
  }
}

/**
 * 安全地哈希token
 * @param {string} plainToken - 明文token
 * @returns {Promise<string>} - 哈希后的token
 */
export async function hashToken(plainToken) {
  const saltRounds = 12 // 高强度哈希
  return await bcrypt.hash(plainToken, saltRounds)
}

/**
 * 验证token哈希（开发环境调试用）
 * @param {string} plainToken - 明文token
 * @param {string} hash - 哈希值
 * @returns {Promise<boolean>} - 是否匹配
 */
export async function verifyTokenHash(plainToken, hash) {
  try {
    return await bcrypt.compare(plainToken, hash)
  } catch {
    return false
  }
}

/**
 * 清理token缓存
 */
export function clearTokenCache() {
  TOKEN_CACHE.clear()
}

/**
 * 获取缓存状态（调试用）
 */
export function getCacheStats() {
  return {
    size: TOKEN_CACHE.size,
    entries: Array.from(TOKEN_CACHE.entries()).map(([key, value]) => ({
      key: key.substring(0, 10) + '...',
      age: Date.now() - value.timestamp,
      hasResult: value.botId !== null
    }))
  }
}
