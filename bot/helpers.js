// 辅助函数模块
import { prisma } from '../lib/db.js'
import { formatMoney } from './utils.js'

const BACKEND_URL = process.env.BACKEND_URL

/**
 * 获取货币符号或简码
 */
export function getDisplayCurrencySymbol(code = 'cny') {
  const lc = String(code || '').toLowerCase()
  switch (lc) {
    case 'cny': return '¥'
    case 'usd': return '$'
    case 'hkd': return 'HK$'
    case 'eur': return '€'
    case 'jpy': return '¥'
    case 'twd': return 'NT$'
    case 'krw': return '₩'
    case 'gbp': return '£'
    case 'aud': return 'A$'
    case 'chf': return 'CHF'
    case 'cad': return 'C$'
    case 'nzd': return 'NZ$'
    default: return lc.toUpperCase()
  }
}

/**
 * 获取 USDT -> 目标法币 的汇率，保留两位小数
 * 主源：jsdelivr；备源：Cloudflare
 */
export async function fetchUsdtToFiatRate(code = 'cny') {
  const lc = String(code || 'cny').toLowerCase()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const url = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usdt.json'
    const resp = await fetch(url, { method: 'GET', signal: controller.signal })
    if (resp.ok) {
      const data = await resp.json()
      const rate = Number(data?.usdt?.[lc])
      if (Number.isFinite(rate) && rate > 0) return Number(rate.toFixed(2))
    }
    // fallthrough to fallback
  } catch {
    // ignore and try fallback
  } finally {
    clearTimeout(timeout)
  }

  const controller2 = new AbortController()
  const timeout2 = setTimeout(() => controller2.abort(), 5000)
  try {
    const url2 = 'https://latest.currency-api.pages.dev/v1/currencies/usdt.json'
    const resp2 = await fetch(url2, { method: 'GET', signal: controller2.signal })
    if (resp2.ok) {
      const data2 = await resp2.json()
      const rate2 = Number(data2?.usdt?.[lc])
      if (Number.isFinite(rate2) && rate2 > 0) return Number(rate2.toFixed(2))
    }
  } catch {
    // ignore
  } finally {
    clearTimeout(timeout2)
  }
  return null
}

export async function fetchRealtimeRateUSDTtoCNY() {
  return await fetchUsdtToFiatRate('cny')
}



/**
 * 🔥 优化：获取群组的有效汇率（优先使用内存，避免重复查询）
 * @param {string} chatId - 群组ID
 * @param {object} chat - 内存中的聊天对象（可选）
 * @returns {Promise<number|null>} 有效汇率，如果没有返回null
 */
export async function getEffectiveRate(chatId, chat = null) {
  // 🔥 优先使用内存中的汇率（避免不必要的数据库查询）
  if (chat) {
    if (chat.fixedRate != null) return chat.fixedRate
    if (chat.realtimeRate != null) return chat.realtimeRate
  }

  // 🔥 如果内存中没有，从数据库获取（只查询汇率字段）
  try {
    const settings = await prisma.setting.findUnique({
      where: { chatId },
      select: { fixedRate: true, realtimeRate: true }
    })
    return settings?.fixedRate ?? settings?.realtimeRate ?? null
  } catch (e) {
    console.error('[getEffectiveRate] 查询失败', e)
    return null
  }
}

/**
 * 构建内联键盘
 */
export async function buildInlineKb(ctx, options = {}) {
  const { Markup } = await import('telegraf')
  const rows = []
  const chatId = String(ctx?.chat?.id || '')

  if (options.hideHelpAndOrder) {
    return Markup.inlineKeyboard(rows)
  }

  if (ctx.chat?.type === 'private') {
    const userId = String(ctx.from?.id || '')
    let isWhitelisted = false
    try {
      if (userId) {
        const whitelistedUser = await prisma.whitelistedUser.findUnique({
          where: { userId }
        })
        isWhitelisted = !!whitelistedUser
      }
    } catch {}

    // 🔥 私聊：显示完整的功能菜单
    // 第一行：使用说明
    rows.push([Markup.button.callback('📋 使用说明', 'help')])

    if (isWhitelisted) {
      // 第二行：联系客服
      rows.push([Markup.button.callback('📞 联系客服', 'contact_support')])
      // 第三行：个人中心 + 功能设置
      rows.push([
        Markup.button.callback('👤 个人中心', 'personal_center'),
        Markup.button.callback('⚙️ 功能设置', 'user_settings')
      ])
      // 第四行：USDT监听
      rows.push([Markup.button.callback('💰 USDT监听', 'usdt_monitor')])
    }

    // 🔥 直接生成邀请链接，不需要点击后再跳转
    try {
      // 使用 ctx.botInfo 获取机器人信息（更高效，不需要额外API调用）
      const botUsername = ctx.botInfo?.username
      if (botUsername) {
        const inviteLink = `https://t.me/${botUsername}?startgroup=true&admin=can_delete_messages+can_restrict_members`
        rows.push([Markup.button.url('➕ 开始记账', inviteLink)])
      } else {
        // 如果 botInfo 没有，才调用 API（备用方案）
        const me = await ctx.telegram.getMe()
        if (me?.username) {
          const inviteLink = `https://t.me/${me.username}?startgroup=true&admin=can_delete_messages+can_restrict_members`
          rows.push([Markup.button.url('➕ 开始记账', inviteLink)])
        }
      }
    } catch (e) {
      console.error('[buildInlineKb] 获取机器人信息失败:', e)
    }

    return Markup.inlineKeyboard(rows)
  }

  try {
    const setting = await prisma.setting.findUnique({
      where: { chatId },
      select: { hideHelpButton: true, hideOrderButton: true }
    })

    // 使用说明按钮（根据设置决定是否显示）
    if (!setting?.hideHelpButton) {
      rows.push([Markup.button.callback('使用说明', 'help')])
    }

    // 查看完整订单按钮（根据设置决定是否显示）
    if (!setting?.hideOrderButton) {
      if (BACKEND_URL) {
        try {
          const u = new URL(BACKEND_URL)
          u.searchParams.set('chatId', chatId)
          rows.push([Markup.button.url('查看完整订单', u.toString())])
        } catch {
          rows.push([Markup.button.url('查看完整订单', BACKEND_URL)])
        }
      }
    }
  } catch {
    // 默认情况下都显示
    rows.push([Markup.button.callback('使用说明', 'help')])
    if (BACKEND_URL) {
      try {
        const u = new URL(BACKEND_URL)
        u.searchParams.set('chatId', chatId)
        rows.push([Markup.button.url('查看完整订单', u.toString())])
      } catch {
        rows.push([Markup.button.url('查看完整订单', BACKEND_URL)])
      }
    }
  }

  return Markup.inlineKeyboard(rows)
}

/**
 * 检查是否是管理员
 */
export async function isAdmin(ctx) {
  try {
    const admins = await ctx.getChatAdministrators()
    const uid = ctx.from?.id
    return !!admins.find(a => a.user?.id === uid)
  } catch {
    return false
  }
}

/**
 * 检查管理员权限（简化版本的 isAdmin）
 */
export async function hasAdminPermission(ctx) {
  return await isAdmin(ctx)
}

/**
 * 检查是否有操作权限
 */
export async function hasOperatorPermission(ctx, chat) {
  if (!chat) return false
  if (chat.everyoneAllowed) return true
  if (await isAdmin(ctx)) return true

  const username = ctx.from?.username || null
  if (username && chat.operators.has(username)) return true

  return false
}

/**
 * 🔥 优化：检查权限（包括白名单用户检查）
 * @param {object} ctx - Telegraf 上下文
 * @param {object} chat - 内存中的聊天对象
 * @returns {Promise<boolean>} 是否有权限
 */
export async function hasPermissionWithWhitelist(ctx, chat) {
  if (await hasOperatorPermission(ctx, chat)) return true

  // 检查白名单
  const userId = String(ctx.from?.id || '')
  if (userId) {
    try {
      const whitelistedUser = await prisma.whitelistedUser.findUnique({
        where: { userId }
      })

      const hasPermission = !!whitelistedUser
      console.log('[hasPermissionWithWhitelist]', {
        userId,
        username: ctx.from?.username,
        hasPermission,
        whitelistedUser: whitelistedUser ? 'found' : 'not found'
      })

      return hasPermission
    } catch (error) {
      console.error('[hasPermissionWithWhitelist] 数据库查询失败:', error.message)
      return false
    }
  }
  return false
}

/**
 * 🔥 安全强化：只检查白名单用户权限（用于广播等敏感功能）
 * 操作员不能使用广播功能，只有白名单用户才能使用
 * @param {object} ctx - Telegraf 上下文
 * @returns {Promise<boolean>} 是否有白名单权限
 */
export async function hasWhitelistOnlyPermission(ctx) {
  // 只检查白名单，不检查操作员权限
  const userId = String(ctx.from?.id || '')
  if (userId) {
    try {
      const whitelistedUser = await prisma.whitelistedUser.findUnique({
        where: { userId }
      })

      const hasPermission = !!whitelistedUser
      console.log('[hasWhitelistOnlyPermission]', {
        userId,
        username: ctx.from?.username,
        hasPermission,
        whitelistedUser: whitelistedUser ? 'found' : 'not found'
      })

      return hasPermission
    } catch (error) {
      console.error('[hasWhitelistOnlyPermission] 数据库查询失败:', error.message)
      return false
    }
  }
  return false
}

/**
 * 获取用户名（简化版本）
 */
export function getUsername(ctx) {
  const u = ctx.from?.username
  if (u) return u
  const firstName = ctx.from?.first_name || ''
  const lastName = ctx.from?.last_name || ''
  return [firstName, lastName].filter(Boolean).join(' ') || '未知用户'
}

/**
 * 获取用户昵称（first_name + last_name）
 * 🔥 始终返回昵称，而不是用户名
 */
export function getDisplayName(from) {
  if (!from) return '未知用户'
  const firstName = from.first_name || ''
  const lastName = from.last_name || ''
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim()
  return displayName || '未知用户'
}
