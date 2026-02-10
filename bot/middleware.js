// 中间件模块
import { prisma } from '../lib/db.js'
import { ensureDbChat } from './database.js'
import { LRUCache } from './lru-cache.js'
import { DEFAULT_FEATURES } from './constants.js'
import { getMessageTextOrCaption, isAccountingCommandText } from './command-utils.js'

// 功能开关缓存（🔥 内存优化：减少缓存大小）
const featureCache = new LRUCache(100)
const FEATURE_TTL_MS = 30 * 60 * 1000 // 30分钟（减少TTL）

/**
 * 检查功能是否启用
 */
export async function isFeatureEnabled(ctx, feature) {
  try {
    const chatId = await ensureDbChat(ctx)
    if (!chatId) {
      // 🔥 如果没有 chatId，默认允许使用（确保新群组可以正常使用）
      return true
    }

    const now = Date.now()
    const cached = featureCache.get(chatId)
    if (cached && cached.expires > now) {
      return cached.set.has(feature)
    }

    const flags = await prisma.chatFeatureFlag.findMany({
      where: { chatId },
      select: { feature: true, enabled: true }
    })

    // 🔥 如果没有功能开关记录，默认允许使用（确保默认可用）
    // 缓存所有默认功能，避免重复查询
    if (flags.length === 0) {
      const defaultSet = new Set(DEFAULT_FEATURES)
      featureCache.set(chatId, { expires: now + FEATURE_TTL_MS, set: defaultSet })
      return true // 默认全部启用
    }

    // 🔥 只返回明确启用（enabled: true）的功能
    const set = new Set(flags.filter(f => f.enabled).map(f => f.feature))

    featureCache.set(chatId, { expires: now + FEATURE_TTL_MS, set })
    return set.has(feature)
  } catch (e) {
    console.error('[isFeatureEnabled] 异常', { feature, error: e.message })
    // 🔥 异常时默认允许，确保可用性
    return true
  }
}

/**
 * 清除功能开关缓存（用于功能开关更新后立即生效）
 */
export function clearFeatureCache(chatId) {
  featureCache.delete(chatId)
}

/**
 * 判断是否是记账命令
 */
export function isAccountingCommand(text) {
  return isAccountingCommandText(text)
}

// 🔥 记账开关缓存（减少数据库查询，🔥 内存优化：减少缓存大小）
const accountingEnabledCache = new LRUCache(100)
const ACCOUNTING_CACHE_TTL_MS = 1 * 60 * 1000 // 🔥 降低缓存时间：从5分钟减少到1分钟，删除操作员后权限更快生效

/**
 * 检查记账是否启用（带缓存优化）
 */
export async function isAccountingEnabled(ctx) {
  try {
    const chatId = await ensureDbChat(ctx)
    if (!chatId) return true // 默认开启

    // 🔥 性能优化：使用缓存减少数据库查询
    const now = Date.now()
    const cached = accountingEnabledCache.get(chatId)
    if (cached && cached.expires > now) {
      return cached.enabled
    }

    const setting = await prisma.setting.findUnique({
      where: { chatId },
      select: { accountingEnabled: true }
    })

    // 🔥 默认开启记账（如果字段不存在，视为开启）
    const enabled = setting?.accountingEnabled !== false
    accountingEnabledCache.set(chatId, { expires: now + ACCOUNTING_CACHE_TTL_MS, enabled })
    return enabled
  } catch (e) {
    console.error('[isAccountingEnabled] 异常', e)
    return true // 出错时默认开启
  }
}

/**
 * 清除记账开关缓存（用于更新后立即生效）
 */
export function clearAccountingCache(chatId) {
  accountingEnabledCache.delete(chatId)
}

/**
 * 权限检查中间件
 */
export function createPermissionMiddleware() {
  return async (ctx, next) => {
    try {
      const text = getMessageTextOrCaption(ctx.message)
      if (!text || !isAccountingCommand(text)) {
        return next()
      }

      // 🔥 检查记账是否启用
      const accountingOk = await isAccountingEnabled(ctx)
      if (!accountingOk) {
        try {
          const chatId = await ensureDbChat(ctx)
          const setting = await prisma.setting.findUnique({
            where: { chatId },
            select: { featureWarningMode: true }
          })

          const warningMode = setting?.featureWarningMode || 'always'
          let shouldWarn = false

          if (warningMode === 'always') {
            shouldWarn = true
            // 🔥 清除之前的警告记录，确保切换到always模式后立即生效
            await prisma.featureWarningLog.deleteMany({
              where: { chatId, feature: 'accounting_disabled' }
            }).catch(() => { })
          } else if (warningMode === 'once') {
            const existingLog = await prisma.featureWarningLog.findUnique({
              where: { chatId_feature: { chatId, feature: 'accounting_disabled' } }
            })
            if (!existingLog) {
              shouldWarn = true
              await prisma.featureWarningLog.upsert({
                where: { chatId_feature: { chatId, feature: 'accounting_disabled' } },
                create: { chatId, feature: 'accounting_disabled' },
                update: { warnedAt: new Date() }
              }).catch(() => { })
            }
          } else if (warningMode === 'daily') {
            const existingLog = await prisma.featureWarningLog.findUnique({
              where: { chatId_feature: { chatId, feature: 'accounting_disabled' } }
            })
            const now = new Date()
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

            if (!existingLog || existingLog.warnedAt < today) {
              shouldWarn = true
              await prisma.featureWarningLog.upsert({
                where: { chatId_feature: { chatId, feature: 'accounting_disabled' } },
                create: { chatId, feature: 'accounting_disabled' },
                update: { warnedAt: now }
              }).catch(() => { })
            }
          }
          // warningMode === 'silent' 时不提醒

          if (shouldWarn) {
            return ctx.reply('⏸️ 记账功能已暂停，发送"开始"可重新激活记账。')
          }
        } catch (e) {
          console.error('[记账暂停检查][错误]', e)
          // 出错时默认提醒
          return ctx.reply('⏸️ 记账功能已暂停，发送"开始"可重新激活记账。')
        }
        return // 不提醒，直接返回
      }

      const ok = await isFeatureEnabled(ctx, 'accounting_basic')
      if (!ok) {
        try {
          const chatId = await ensureDbChat(ctx)
          const setting = await prisma.setting.findUnique({
            where: { chatId },
            select: { featureWarningMode: true }
          })

          const warningMode = setting?.featureWarningMode || 'always'
          let shouldWarn = false

          if (warningMode === 'always') {
            shouldWarn = true
          } else if (warningMode === 'once') {
            const existingLog = await prisma.featureWarningLog.findUnique({
              where: { chatId_feature: { chatId, feature: 'accounting_basic' } }
            })
            if (!existingLog) {
              shouldWarn = true
              await prisma.featureWarningLog.upsert({
                where: { chatId_feature: { chatId, feature: 'accounting_basic' } },
                create: { chatId, feature: 'accounting_basic' },
                update: { warnedAt: new Date() }
              }).catch(() => { })
            }
          } else if (warningMode === 'daily') {
            const existingLog = await prisma.featureWarningLog.findUnique({
              where: { chatId_feature: { chatId, feature: 'accounting_basic' } }
            })
            const now = new Date()
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

            if (!existingLog || existingLog.warnedAt < today) {
              shouldWarn = true
              await prisma.featureWarningLog.upsert({
                where: { chatId_feature: { chatId, feature: 'accounting_basic' } },
                create: { chatId, feature: 'accounting_basic' },
                update: { warnedAt: now }
              }).catch(() => { })
            }
          }

          if (shouldWarn) {
            await ctx.reply('未开通基础记账功能')
          }
        } catch (e) {
          console.error('[权限检查][错误]', e)
        }
        return
      }

      return next()
    } catch (e) {
      console.error('[权限检查中间件][异常]', e)
      return next()
    }
  }
}

