// OKX相关命令处理器
import { getOKXC2CSellers } from '../../lib/okx-api.ts'
import { buildInlineKb } from '../helpers.js'
import { formatMoney } from '../utils.js'

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
      
      const top10 = sellers.slice(0, 10)
      const lines = ['━━━ OKX实时U价 TOP 10 ━━━\n']
      
      top10.forEach((seller, index) => {
        const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][index]
        const price = seller.price.toFixed(2)
        lines.push(`${emoji}    ${price}    ${seller.nickName}`)
      })
      
      const now = new Date()
      lines.push(`\n获取时间：${now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}`)
      
      const { Markup } = await import('telegraf')
      const inlineKb = Markup.inlineKeyboard([
        [
          Markup.button.callback('所有', 'okx_c2c_all'),
          Markup.button.callback('银行卡', 'okx_c2c_bank'),
          Markup.button.callback('支付宝', 'okx_c2c_alipay'),
          Markup.button.callback('微信', 'okx_c2c_wxpay')
        ]
      ])
      
      await ctx.reply(lines.join('\n'), { ...inlineKb })
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
      
      const top10 = sellers.slice(0, 10)
      const methodName = { 'all': '全部', 'bank': '银行卡', 'alipay': '支付宝', 'wxpay': '微信' }[method]
      const lines = [`━━━ OKX实时U价 ${methodName} TOP 10 ━━━\n`]
      
      top10.forEach((seller, index) => {
        const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][index]
        const price = seller.price.toFixed(2)
        const methods = seller.paymentMethods.map(m => {
          if (m === 'aliPay' || m === 'alipay') return '支付宝'
          if (m === 'wxPay') return '微信'
          if (m === 'bank') return '银行卡'
          return m
        }).join(', ')
        lines.push(`${emoji}    ${price}    ${seller.nickName} (${methods})`)
      })
      
      const now = new Date()
      lines.push(`\n获取时间：${now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}`)
      
      const { Markup } = await import('telegraf')
      const inlineKb = Markup.inlineKeyboard([
        [
          Markup.button.callback('所有', 'okx_c2c_all'),
          Markup.button.callback('银行卡', 'okx_c2c_bank'),
          Markup.button.callback('支付宝', 'okx_c2c_alipay'),
          Markup.button.callback('微信', 'okx_c2c_wxpay')
        ]
      ])
      
      await ctx.editMessageText(lines.join('\n'), { ...inlineKb })
    } catch (e) {
      console.error('[okx_c2c_action]', e)
      await ctx.answerCbQuery('获取失败', { show_alert: true }).catch(() => {})
    }
  })
}

