// 辅助函数模块
import { prisma } from '../lib/db.ts'
import { formatMoney, isPublicUrl } from './utils.js'

const BACKEND_URL = process.env.BACKEND_URL

/**
 * 获取实时汇率（简化版本）
 */
export async function fetchRealtimeRateUSDTtoCNY() {
  try {
    const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny', { 
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const rate = Number(data?.tether?.cny)
    if (!rate || !Number.isFinite(rate)) throw new Error('Invalid rate')
    return Number(rate.toFixed(2))
  } catch (e) {
    // 备用方案
    try {
      const resp = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=CNY', { 
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      const rate = Number(data?.rates?.CNY)
      if (!rate || !Number.isFinite(rate)) throw new Error('Invalid rate')
      return Number(rate.toFixed(2))
    } catch {
      return null
    }
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
    // 🔥 私聊：显示指令菜单和直接邀请按钮
    rows.push([Markup.button.callback('📋 指令菜单', 'command_menu')])
    
    // 🔥 直接生成邀请链接，不需要点击后再跳转
    try {
      // 使用 ctx.botInfo 获取机器人信息（更高效，不需要额外API调用）
      const botUsername = ctx.botInfo?.username
      if (botUsername) {
        const inviteLink = `https://t.me/${botUsername}?startgroup=true&admin=can_delete_messages+can_restrict_members`
        rows.push([Markup.button.url('➕ 开始记账（添加为管理员）', inviteLink)])
      } else {
        // 如果 botInfo 没有，才调用 API（备用方案）
        const me = await ctx.telegram.getMe()
        if (me?.username) {
          const inviteLink = `https://t.me/${me.username}?startgroup=true&admin=can_delete_messages+can_restrict_members`
          rows.push([Markup.button.url('➕ 开始记账（添加为管理员）', inviteLink)])
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
      if (isPublicUrl(BACKEND_URL)) {
        try {
          const u = new URL(BACKEND_URL)
          u.searchParams.set('chatId', chatId)
          rows.push([Markup.button.url('查看完整订单', u.toString())])
        } catch {
          rows.push([Markup.button.url('查看完整订单', BACKEND_URL)])
        }
      } else if (BACKEND_URL) {
        rows.push([Markup.button.callback('查看完整订单', 'open_dashboard')])
      }
    }
  } catch {
    // 默认情况下都显示
    rows.push([Markup.button.callback('使用说明', 'help')])
    if (isPublicUrl(BACKEND_URL)) {
      try {
        const u = new URL(BACKEND_URL)
        u.searchParams.set('chatId', chatId)
        rows.push([Markup.button.url('查看完整订单', u.toString())])
      } catch {
        rows.push([Markup.button.url('查看完整订单', BACKEND_URL)])
      }
    } else if (BACKEND_URL) {
      rows.push([Markup.button.callback('查看完整订单', 'open_dashboard')])
    }
  }
  
  return Markup.inlineKeyboard(rows)
}

// isPublicUrl 已从 utils.js 导入

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
 * 检查是否有操作权限
 */
export async function hasOperatorPermission(ctx, chat) {
  if (!chat) return false
  if (chat.everyoneAllowed) return true
  if (await isAdmin(ctx)) return true
  
  const username = ctx.from?.username ? `@${ctx.from.username}` : null
  if (username && chat.operators.has(username)) return true
  
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

