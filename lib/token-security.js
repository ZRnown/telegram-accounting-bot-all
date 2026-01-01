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
    // 🔥 使用哈希token进行安全验证（优先使用哈希，降级到明文比较）
    const hash = await hashToken(plainToken)
    let bot = await prisma.bot.findFirst({
      where: {
        tokenHash: hash,
        enabled: true
      },
      select: { id: true }
    })

    // 如果哈希验证失败，尝试明文比较（向后兼容）
    if (!bot) {
      console.log('[token-security] 哈希验证失败，尝试明文验证（向后兼容）')
      const bots = await prisma.bot.findMany({
        where: { enabled: true },
        select: { id: true, token: true }
      })

      for (const b of bots) {
        if (b.token === plainToken) {
          // 更新哈希（如果还没有）
          await prisma.bot.update({
            where: { id: b.id },
            data: { tokenHash: hash }
          })
          bot = { id: b.id }
          break
        }
      }
    }

    if (bot) {
      // 缓存结果
      TOKEN_CACHE.set(cacheKey, {
        botId: bot.id,
        timestamp: Date.now()
      })
      return bot.id
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
 * ⚠️  生产环境中应避免使用此函数，仅在API调用时使用
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
