// 设置相关命令处理器
import { prisma } from '../../lib/db.ts'
import { ensureDbChat, updateSettings } from '../database.js'
import { buildInlineKb, hasOperatorPermission, fetchRealtimeRateUSDTtoCNY, isAdmin, hasPermissionWithWhitelist, getEffectiveRate } from '../helpers.js'
import { formatMoney } from '../utils.js'

/**
 * 设置费率
 */
export function registerSetFee(bot, ensureChat) {
  bot.hears(/^设置费率\s*(-?\d+(?:\.\d+)?)%?$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    // 🔥 优化：使用统一的权限检查函数
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    
    const chatId = await ensureDbChat(ctx, chat)
    const m = ctx.message.text.match(/(-?\d+(?:\.\d+)?)/)
    if (!m) return
    
    let v = Number(m[1])
    if (Math.abs(v) <= 1) v = v * 100
    chat.feePercent = Math.max(-100, Math.min(100, v))
    
    await updateSettings(chatId, { feePercent: chat.feePercent })
    await ctx.reply(`✅ 费率已设置为 ${chat.feePercent}%`, { ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 设置汇率
 */
export function registerSetRate(bot, ensureChat) {
  bot.hears(/^设置汇率\s*(\d+(?:\.\d+)?)?$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    // 🔥 优化：使用统一的权限检查函数
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    
    const chatId = await ensureDbChat(ctx, chat)
    const m = ctx.message.text.match(/^设置汇率\s*(\d+(?:\.\d+)?)?$/i)
    const val = m && m[1] ? Number(m[1]) : null
    
    if (val == null) {
      const settings = await prisma.setting.findUnique({ where: { chatId } })
      const current = settings?.fixedRate ?? settings?.realtimeRate ?? null
      return ctx.reply(`当前汇率：${current ?? '未设置'}\n用法：设置汇率7.2 或 设置汇率 7.2`)
    }
    
    chat.fixedRate = val
    chat.realtimeRate = null
    await updateSettings(chatId, { fixedRate: val, realtimeRate: null })
    await ctx.reply(`✅ 固定汇率已设置为 ${val}`, { ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 设置实时汇率
 */
export function registerSetRealtimeRate(bot, ensureChat) {
  bot.hears(/^设置实时汇率$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    // 🔥 优化：使用统一的权限检查函数
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    
    const chatId = await ensureDbChat(ctx, chat)
    const rate = await fetchRealtimeRateUSDTtoCNY()
    if (!rate) {
      return ctx.reply('❌ 获取实时汇率失败，请稍后重试')
    }
    
    chat.realtimeRate = rate
    chat.fixedRate = null
    await updateSettings(chatId, { realtimeRate: rate, fixedRate: null })
    await ctx.reply(`✅ 已启用实时汇率：${rate}`, { ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 刷新实时汇率
 */
export function registerRefreshRate(bot, ensureChat) {
  bot.hears(/^刷新实时汇率$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    const chatId = await ensureDbChat(ctx, chat)
    const rate = await fetchRealtimeRateUSDTtoCNY()
    if (!rate) {
      return ctx.reply('❌ 获取实时汇率失败，请稍后重试')
    }
    
    chat.realtimeRate = rate
    await updateSettings(chatId, { realtimeRate: rate })
    await ctx.reply(`✅ 实时汇率已更新：${rate}`, { ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 显示实时汇率
 */
export function registerShowRate(bot, ensureChat) {
  bot.hears(/^显示实时汇率$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    const chatId = await ensureDbChat(ctx, chat)
    // 🔥 优化：使用统一的汇率获取函数
    const rate = await getEffectiveRate(chatId, chat)
    const fixedRate = chat.fixedRate ?? (rate && chat.realtimeRate === null ? rate : null)
    const realtimeRate = chat.realtimeRate ?? (rate && chat.fixedRate === null ? rate : null)
    
    if (fixedRate) {
      await ctx.reply(`当前汇率：${fixedRate}（固定汇率）`, { ...(await buildInlineKb(ctx)) })
    } else if (realtimeRate) {
      await ctx.reply(`当前汇率：${realtimeRate}（实时汇率）`, { ...(await buildInlineKb(ctx)) })
    } else {
      await ctx.reply('当前未设置汇率', { ...(await buildInlineKb(ctx)) })
    }
  })
}

// 🔥 全局日切时间命令已删除，改为后台设置

/**
 * 设置超押提醒额度
 */
export function registerOverDepositLimit(bot, ensureChat) {
  bot.hears(/^设置额度\s+(\d+(?:\.\d+)?)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    // 🔥 优化：使用统一的权限检查函数
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    
    const limit = parseFloat(ctx.match[1])
    const chatId = await ensureDbChat(ctx, chat)
    
    try {
      await updateSettings(chatId, { overDepositLimit: limit })
      
      if (limit === 0) {
        await ctx.reply('✅ 已关闭超押提醒', { ...(await buildInlineKb(ctx)) })
      } else {
        await ctx.reply(`✅ 已设置超押提醒额度为 ${formatMoney(limit)} 元`, { ...(await buildInlineKb(ctx)) })
      }
    } catch (e) {
      console.error('[设置额度]', e)
      await ctx.reply('❌ 设置失败，请稍后重试')
    }
  })
}

