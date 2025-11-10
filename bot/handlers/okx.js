// OKX相关命令处理器
import { getOKXC2CSellers } from '../../lib/okx-api.ts'
import { buildInlineKb } from '../helpers.js'
import { formatMoney } from '../utils.js'

/**
 * 格式化OKX价格显示
 */
function formatOKXPrice(sellers, methodName) {
  if (sellers.length === 0) {
    return '❌ 获取OKX价格失败，请稍后重试'
  }
  
  const top10 = sellers.slice(0, 10)
  const lines = [` OKX实时U价 ${methodName} TOP 10 \n`]
  
  top10.forEach((seller, index) => {
    const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][index]
    const price = seller.price.toFixed(2)
    const methods = seller.paymentMethods.map(m => {
      if (m === 'aliPay' || m === 'alipay') return '支付宝'
      if (m === 'wxPay') return '微信'
      if (m === 'bank') return '银行卡'
      return m
    }).join(', ')
    lines.push(`${emoji} ${price} ${seller.nickName}${methods ? ` (${methods})` : ''}`)
  })
  
  const now = new Date()
  lines.push(`\n获取时间：${now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}`)
  
  return lines.join('\n')
}

/**
 * z1000命令 - 计算金额换算USDT（z1000计算1000元，z20计算20元）
 */
export function registerZAmount(bot, ensureChat) {
  bot.hears(/^z(\d+(?:\.\d+)?)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    const chatId = await ensureDbChat(ctx, chat)
    const match = ctx.message.text.match(/^z(\d+(?:\.\d+)?)$/i)
    if (!match) return
    
    const amount = parseFloat(match[1])
    if (!Number.isFinite(amount) || amount <= 0) {
      return ctx.reply('❌ 无效的金额')
    }
    
    try {
      // 🔥 获取当前汇率
      const { getEffectiveRate } = await import('../helpers.js')
      const rate = await getEffectiveRate(chatId, chat)
      
      if (!rate || rate <= 0) {
        return ctx.reply('❌ 未设置汇率，无法计算USDT。请先设置汇率。')
      }
      
      const usdt = Number((amount / rate).toFixed(2))
      await ctx.reply(
        `💰 金额换算\n\n` +
        `金额：${amount.toLocaleString()} 元\n` +
        `汇率：${rate}\n` +
        `USDT：${usdt.toLocaleString()} U`,
        { ...(await buildInlineKb(ctx)) }
      )
    } catch (e) {
      console.error('[z金额命令]', e)
      await ctx.reply('❌ 计算失败，请稍后重试')
    }
  })
}

/**
 * z0命令 - 查询OKX C2C价格
 */
export function registerZ0(bot) {
  bot.hears(/^(z0|Z0)$/i, async (ctx) => {
    try {
      const sellers = await getOKXC2CSellers('all')
      
      if (sellers.length === 0) {
        return ctx.reply('❌ 获取OKX价格失败，请稍后重试')
      }
      
      const text = formatOKXPrice(sellers, '全部')
      
      const { Markup } = await import('telegraf')
      const inlineKb = Markup.inlineKeyboard([
        [
          Markup.button.callback('所有', 'okx_c2c_all'),
          Markup.button.callback('银行卡', 'okx_c2c_bank'),
          Markup.button.callback('支付宝', 'okx_c2c_alipay'),
          Markup.button.callback('微信', 'okx_c2c_wxpay')
        ]
      ])
      
      await ctx.reply(text, { ...inlineKb })
    } catch (e) {
      console.error('[z0命令]', e)
      await ctx.reply('❌ 获取OKX价格失败，请稍后重试')
    }
  })
  
  // OKX C2C支付方式筛选回调
  bot.action(/^okx_c2c_(all|bank|alipay|wxpay)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery()
      
      const method = ctx.match[1]
      const methodMap = {
        'all': 'all',
        'bank': 'bank',
        'alipay': 'alipay',
        'wxpay': 'wxPay'
      }
      
      const sellers = await getOKXC2CSellers(methodMap[method])
      
      if (sellers.length === 0) {
        return ctx.editMessageText('❌ 获取OKX价格失败，请稍后重试')
      }
      
      const methodName = { 'all': '全部', 'bank': '银行卡', 'alipay': '支付宝', 'wxpay': '微信' }[method]
      const text = formatOKXPrice(sellers, methodName)
      
      const { Markup } = await import('telegraf')
      const inlineKb = Markup.inlineKeyboard([
        [
          Markup.button.callback('所有', 'okx_c2c_all'),
          Markup.button.callback('银行卡', 'okx_c2c_bank'),
          Markup.button.callback('支付宝', 'okx_c2c_alipay'),
          Markup.button.callback('微信', 'okx_c2c_wxpay')
        ]
      ])
      
      await ctx.editMessageText(text, { ...inlineKb })
    } catch (e) {
      console.error('[okx_c2c_action]', e)
      await ctx.answerCbQuery('获取失败', { show_alert: true }).catch(() => {})
    }
  })
}

/**
 * lz命令 - 查询OKX支付宝U价
 */
export function registerLZ(bot) {
  bot.hears(/^lz$/i, async (ctx) => {
    try {
      const sellers = await getOKXC2CSellers('alipay')
      const text = formatOKXPrice(sellers, '支付宝')
      await ctx.reply(text)
    } catch (e) {
      console.error('[lz命令]', e)
      await ctx.reply('❌ 获取OKX支付宝U价失败，请稍后重试')
    }
  })
}

/**
 * lw命令 - 查询OKX微信U价
 */
export function registerLW(bot) {
  bot.hears(/^lw$/i, async (ctx) => {
    try {
      const sellers = await getOKXC2CSellers('wxPay')
      const text = formatOKXPrice(sellers, '微信')
      await ctx.reply(text)
    } catch (e) {
      console.error('[lw命令]', e)
      await ctx.reply('❌ 获取OKX微信U价失败，请稍后重试')
    }
  })
}

/**
 * lk命令 - 查询OKX银行卡U价
 */
export function registerLK(bot) {
  bot.hears(/^lk$/i, async (ctx) => {
    try {
      const sellers = await getOKXC2CSellers('bank')
      const text = formatOKXPrice(sellers, '银行卡')
      await ctx.reply(text)
    } catch (e) {
      console.error('[lk命令]', e)
      await ctx.reply('❌ 获取OKX银行卡U价失败，请稍后重试')
    }
  })
}

