import { hasWhitelistOnlyPermission } from '../helpers.js'
import { formatSubscriptionExpiry } from '../subscription-utils.js'
import {
  getSubscriptionConfig,
  getChatSubscriptionExpiry,
  getChatSubscriptionStatus,
  renewChatSubscriptionByTx,
  setChatSubscriptionExpiry,
  setSubscriptionConfig
} from '../subscription-service.js'
import { calculateExtendedExpiry } from '../subscription-utils.js'

function formatRemainingMs(remainingMs) {
  if (remainingMs <= 0) return '已到期'
  const totalMinutes = Math.floor(remainingMs / (60 * 1000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60
  const parts = []
  if (days > 0) parts.push(`${days}天`)
  if (hours > 0) parts.push(`${hours}小时`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}分钟`)
  return parts.join('')
}

export function registerSubscriptionHandler(bot) {
  bot.hears(/^订阅状态$/i, async (ctx) => {
    if (!ctx.chat?.id) return
    if (ctx.chat.type === 'private') {
      return ctx.reply('请在群聊中发送“订阅状态”查看该群到期时间。')
    }

    try {
      const chatId = String(ctx.chat.id)
      const [{ expiresAt, active, remainingMs }, cfg] = await Promise.all([
        getChatSubscriptionStatus(chatId),
        getSubscriptionConfig()
      ])

      await ctx.reply(
        `订阅状态：${active ? '有效' : '已到期'}\n` +
        `到期时间：${formatSubscriptionExpiry(expiresAt)}\n` +
        `剩余时间：${formatRemainingMs(remainingMs)}\n` +
        `续费单价：${cfg.usdtPerDay} USDT/天\n` +
        `收款地址：${cfg.receiveAddress || '未设置'}\n\n` +
        `续费命令：续费 天数 交易哈希`
      )
    } catch (e) {
      console.error('[订阅状态][error]', e)
      await ctx.reply('❌ 查询订阅状态失败，请稍后重试')
    }
  })

  bot.hears(/^续费\s+(\d+)\s+([A-Fa-f0-9]{64})$/i, async (ctx) => {
    if (!ctx.chat?.id) return
    if (ctx.chat.type === 'private') {
      return ctx.reply('请在需要续费的群聊中发送：续费 天数 交易哈希')
    }

    const days = Number(ctx.match?.[1] || 0)
    const txid = String(ctx.match?.[2] || '')
    if (!days || !txid) {
      return ctx.reply('❌ 用法：续费 天数 交易哈希')
    }

    try {
      const result = await renewChatSubscriptionByTx({
        chatId: String(ctx.chat.id),
        days,
        txid,
        updatedBy: String(ctx.from?.id || '')
      })

      if (!result.ok) {
        const reasonMap = {
          INVALID_TXID: '交易哈希格式错误',
          INVALID_DAYS: '续费天数无效',
          TX_USED: '该交易哈希已使用过',
          ADDRESS_NOT_SET: '管理员尚未配置收款地址',
          TX_NOT_FOUND: '未找到这笔交易，请确认哈希或稍后重试',
          WRONG_TO_ADDRESS: '交易收款地址不匹配',
          NOT_USDT: '该交易不是USDT转账',
          INVALID_AMOUNT: '交易金额无效',
          INSUFFICIENT_AMOUNT: `支付金额不足，需至少 ${result.requiredAmount} USDT，当前 ${result.amountPaid ?? 0} USDT`
        }
        return ctx.reply(`❌ 续费失败：${reasonMap[result.reason] || result.reason}`)
      }

      await ctx.reply(
        `✅ 续费成功\n` +
        `续费天数：${result.days} 天\n` +
        `支付金额：${result.amountPaid} USDT\n` +
        `到期时间：${formatSubscriptionExpiry(result.expiresAt)}`
      )
    } catch (e) {
      console.error('[续费][error]', e)
      await ctx.reply('❌ 续费处理失败，请稍后重试')
    }
  })

  bot.hears(/^查看订阅配置$/i, async (ctx) => {
    if (ctx.chat?.type !== 'private') return
    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) return ctx.reply('⚠️ 您不在白名单中，无法查看订阅配置')

    try {
      const cfg = await getSubscriptionConfig()
      await ctx.reply(
        `订阅配置：\n` +
        `试用天数：${cfg.trialDays}\n` +
        `续费单价：${cfg.usdtPerDay} USDT/天\n` +
        `收款地址：${cfg.receiveAddress || '未设置'}`
      )
    } catch (e) {
      console.error('[查看订阅配置][error]', e)
      await ctx.reply('❌ 查询配置失败，请稍后重试')
    }
  })

  bot.hears(/^设置订阅地址\s+(\S+)$/i, async (ctx) => {
    if (ctx.chat?.type !== 'private') return
    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) return ctx.reply('⚠️ 您不在白名单中，无法设置订阅地址')

    const address = String(ctx.match?.[1] || '').trim()
    if (!/^T[A-Za-z0-9]{33}$/.test(address)) {
      return ctx.reply('❌ 地址格式无效，请提供TRC20地址')
    }

    await setSubscriptionConfig({ receiveAddress: address }, String(ctx.from?.id || ''))
    await ctx.reply(`✅ 收款地址已更新：${address}`)
  })

  bot.hears(/^设置订阅单价\s+(\d+(?:\.\d+)?)$/i, async (ctx) => {
    if (ctx.chat?.type !== 'private') return
    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) return ctx.reply('⚠️ 您不在白名单中，无法设置订阅单价')

    const usdtPerDay = Number(ctx.match?.[1] || 0)
    if (!Number.isFinite(usdtPerDay) || usdtPerDay <= 0) {
      return ctx.reply('❌ 单价必须大于0')
    }

    await setSubscriptionConfig({ usdtPerDay }, String(ctx.from?.id || ''))
    await ctx.reply(`✅ 续费单价已更新：${usdtPerDay} USDT/天`)
  })

  bot.hears(/^设置试用天数\s+(\d+)$/i, async (ctx) => {
    if (ctx.chat?.type !== 'private') return
    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) return ctx.reply('⚠️ 您不在白名单中，无法设置试用天数')

    const trialDays = Number(ctx.match?.[1] || 0)
    if (!Number.isFinite(trialDays) || trialDays <= 0 || trialDays > 365) {
      return ctx.reply('❌ 试用天数必须在 1-365 之间')
    }

    await setSubscriptionConfig({ trialDays }, String(ctx.from?.id || ''))
    await ctx.reply(`✅ 免费试用天数已更新：${trialDays} 天`)
  })

  bot.hears(/^设置群到期\s+(-?\d+)\s+(\d{4}-\d{2}-\d{2})$/i, async (ctx) => {
    if (ctx.chat?.type !== 'private') return
    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) return ctx.reply('⚠️ 您不在白名单中，无法设置群到期时间')

    const chatId = String(ctx.match?.[1] || '').trim()
    const dateStr = String(ctx.match?.[2] || '').trim()
    const expiresAt = new Date(`${dateStr}T23:59:59.000+08:00`)
    if (!Number.isFinite(expiresAt.getTime())) {
      return ctx.reply('❌ 日期格式错误，请使用 YYYY-MM-DD')
    }

    await setChatSubscriptionExpiry(chatId, expiresAt, String(ctx.from?.id || ''))
    await ctx.reply(`✅ 群 ${chatId} 到期时间已设置为：${formatSubscriptionExpiry(expiresAt)}`)
  })

  bot.hears(/^延长群到期\s+(-?\d+)\s+(\d+)$/i, async (ctx) => {
    if (ctx.chat?.type !== 'private') return
    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) return ctx.reply('⚠️ 您不在白名单中，无法延长群到期时间')

    const chatId = String(ctx.match?.[1] || '').trim()
    const days = Number(ctx.match?.[2] || 0)
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      return ctx.reply('❌ 延长天数必须在 1-3650 之间')
    }

    const current = await getChatSubscriptionExpiry(chatId)
    const next = calculateExtendedExpiry(current, days, new Date())
    await setChatSubscriptionExpiry(chatId, next, String(ctx.from?.id || ''))
    await ctx.reply(`✅ 群 ${chatId} 已延长 ${days} 天\n新到期时间：${formatSubscriptionExpiry(next)}`)
  })
}
