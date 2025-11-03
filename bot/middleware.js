// 中间件模块
import { prisma } from '../lib/db.ts'
import { ensureDbChat } from './database.js'
import { LRUCache } from './lru-cache.js'

// 功能开关缓存
const featureCache = new LRUCache(500)
const FEATURE_TTL_MS = 60 * 60 * 1000 // 1小时

/**
 * 检查功能是否启用
 */
export async function isFeatureEnabled(ctx, feature) {
  try {
    const chatId = await ensureDbChat(ctx)
    if (!chatId) {
      if (feature === 'accounting_basic') return true
      return false
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
    
    const set = new Set(flags.filter(f => f.enabled).map(f => f.feature))
    
    // 如果没有任何功能开关记录，默认允许基础记账
    if (flags.length === 0 && feature === 'accounting_basic') {
      set.add('accounting_basic')
    }
    
    featureCache.set(chatId, { expires: now + FEATURE_TTL_MS, set })
    return set.has(feature)
  } catch (e) {
    console.error('[isFeatureEnabled] 异常', { feature, error: e.message })
    if (feature === 'accounting_basic') return true
    return false
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
  if (!text) return false
  const t = text.trim()
  if (/^(开始记账|开始|停止记账|停止)$/i.test(t)) return true // 🔥 添加开始/停止命令
  if (/^[+\-]\s*[\d+\-*/.()]/i.test(t)) return true
  if (/^(下发)\b/.test(t)) return true
  if (/^(显示账单|\+0)$/i.test(t)) return true
  if (/^显示历史账单$/i.test(t)) return true
  if (/^(保存账单|删除账单|删除全部账单|清除全部账单)$/i.test(t)) return true
  if (/^(我的账单|\/我)$/i.test(t)) return true
  return false
}

// 🔥 记账开关缓存（减少数据库查询）
const accountingEnabledCache = new LRUCache(500)
const ACCOUNTING_CACHE_TTL_MS = 5 * 60 * 1000 // 5分钟

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
      const text = ctx.message?.text
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
              }).catch(() => {})
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
              }).catch(() => {})
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
              }).catch(() => {})
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
              }).catch(() => {})
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

