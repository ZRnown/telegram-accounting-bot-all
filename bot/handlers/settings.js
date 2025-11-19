// 设置相关命令处理器
import { prisma } from '../../lib/db.js'
import { ensureDbChat, setChatCurrencyCode, updateSettings, getChatDailyCutoffHour } from '../database.js'
import { buildInlineKb, isAdmin, hasPermissionWithWhitelist, getEffectiveRate, fetchUsdtToFiatRate, getDisplayCurrencySymbol } from '../helpers.js'
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
  // 🔥 支持有无空格：设置汇率 7.2 或 设置汇率7.2
  bot.hears(/^设置汇率\s*(\d+(?:\.\d+)?)?$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    // 🔥 优化：使用统一的权限检查函数
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    
    const chatId = await ensureDbChat(ctx, chat)
    // 🔥 支持有无空格：设置汇率 7.2 或 设置汇率7.2
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
    const code = chat.currencyCode || 'cny'
    const rate = await fetchUsdtToFiatRate(code)
    if (!rate) {
      return ctx.reply('❌ 获取实时汇率失败，请稍后重试')
    }
    
    chat.realtimeRate = rate
    chat.fixedRate = null
    await updateSettings(chatId, { realtimeRate: rate, fixedRate: null })
    await ctx.reply(`✅ 已启用实时汇率：${rate.toFixed(2)} (${getDisplayCurrencySymbol(code)}/${'USDT'})`, { ...(await buildInlineKb(ctx)) })
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
    const code = chat.currencyCode || 'cny'
    const rate = await fetchUsdtToFiatRate(code)
    if (!rate) {
      return ctx.reply('❌ 获取实时汇率失败，请稍后重试')
    }
    
    chat.realtimeRate = rate
    await updateSettings(chatId, { realtimeRate: rate })
    await ctx.reply(`✅ 实时汇率已更新：${rate.toFixed(2)} (${getDisplayCurrencySymbol(code)}/${'USDT'})`, { ...(await buildInlineKb(ctx)) })
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
    const code = chat.currencyCode || 'cny'
    const sym = getDisplayCurrencySymbol(code)
    
    if (fixedRate) {
      await ctx.reply(`当前汇率：${Number(fixedRate).toFixed(2)} ${sym}/USDT（固定）`, { ...(await buildInlineKb(ctx)) })
    } else if (realtimeRate) {
      await ctx.reply(`当前汇率：${Number(realtimeRate).toFixed(2)} ${sym}/USDT（实时）`, { ...(await buildInlineKb(ctx)) })
    } else {
      await ctx.reply('当前未设置汇率', { ...(await buildInlineKb(ctx)) })
    }
  })
}

// 新增：设置/切换货币 与 显示货币
export function registerSetCurrency(bot, ensureChat) {
  const whitelist = new Set(['cny','usd','jpy','twd','krw','eur','hkd','gbp','aud','chf','cad','nzd'])
  bot.hears(/^(设置货币|切换货币|货币)\s*([A-Za-z]{3,5})?$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    const chatId = await ensureDbChat(ctx, chat)
    const m = ctx.message.text.match(/^(?:设置货币|切换货币|货币)\s*([A-Za-z]{3,5})?$/i)
    const codeRaw = m && m[1] ? m[1] : ''
    if (!codeRaw) {
      return ctx.reply(`当前货币：${(chat.currencyCode || 'cny').toUpperCase()}\n可选：CNY, USD, EUR, JPY, GBP, AUD, CHF, CAD, NZD, TWD, KRW, HKD`)
    }
    const code = codeRaw.toLowerCase()
    if (!whitelist.has(code)) {
      return ctx.reply('❌ 不支持的货币。可选：CNY, USD, EUR, JPY, GBP, AUD, CHF, CAD, NZD, TWD, KRW, HKD')
    }
    await setChatCurrencyCode(chatId, code)
    chat.currencyCode = code
    // 若当前为实时汇率模式，刷新为新币种汇率
    if (chat.fixedRate == null) {
      const rate = await fetchUsdtToFiatRate(code)
      if (rate) {
        chat.realtimeRate = rate
        await updateSettings(chatId, { realtimeRate: rate, fixedRate: null })
      }
    }
    await ctx.reply(`✅ 已切换货币为 ${code.toUpperCase()}`)
  })
}

export function registerShowCurrency(bot, ensureChat) {
  bot.hears(/^显示货币$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    const code = (chat.currencyCode || 'cny').toUpperCase()
    const sym = getDisplayCurrencySymbol(chat.currencyCode || 'cny')
    await ctx.reply(`当前货币：${code}（${sym}）`)
  })
}

// 设置日切时间（群级优先生效，范围0-23；不传参数则显示当前设置和默认）
export function registerSetDailyCutoff(bot, ensureChat) {
  const pattern = /^(?:设置日切(?:时间)?)[\s]*(\d{1,2})?$/i
  bot.hears(pattern, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    const chatId = await ensureDbChat(ctx, chat)
    const m = ctx.message.text.match(pattern)
    const valStr = m && m[1] != null ? m[1] : null
    if (valStr == null) {
      const current = await getChatDailyCutoffHour(chatId)
      return ctx.reply(`当前日切时间：${current} 点（0-23，默认0点=凌晨）\n用法：设置日切时间 2 或 设置日切 2`)
    }
    const hour = Number(valStr)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      return ctx.reply('❌ 日切时间必须是 0-23 的整数')
    }
    await updateSettings(chatId, { dailyCutoffHour: hour })
    return ctx.reply(`✅ 已设置本群日切时间为 ${hour} 点（0-23）`)
  })
}

/**
 * 设置超押提醒额度
 */
export function registerOverDepositLimit(bot, ensureChat) {
  // 🔥 支持有无空格：设置额度 10000 或 设置额度10000
  bot.hears(/^设置额度\s*(\d+(?:\.\d+)?)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    // 🔥 优化：使用统一的权限检查函数
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    
    const m = ctx.message.text.match(/^设置额度\s*(\d+(?:\.\d+)?)$/i)
    const limit = m && m[1] ? parseFloat(m[1]) : 0
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

/**
 * 打开/关闭计算器功能
 */
export function registerCalculatorToggle(bot, ensureChat) {
  bot.hears(/^(打开计算器|关闭计算器)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    // 🔥 优化：使用统一的权限检查函数
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    
    const chatId = await ensureDbChat(ctx, chat)
    const text = ctx.message.text.trim()
    const enabled = /^打开计算器$/i.test(text)
    
    try {
      await updateSettings(chatId, { calculatorEnabled: enabled })
      await ctx.reply(
        enabled 
          ? '✅ 已打开计算器功能，现在支持数学计算（如：288-32、288*2、288/2、288+21）' 
          : '⏸️ 已关闭计算器功能，不再支持数学计算',
        { ...(await buildInlineKb(ctx)) }
      )
    } catch (e) {
      console.error('[计算器开关]', e)
      await ctx.reply('❌ 设置失败，请稍后重试')
    }
  })
}

