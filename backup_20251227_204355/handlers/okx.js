// OKX相关命令处理器
import { getOKXC2CSellers } from '../../lib/okx-api.js'

/**
 * 格式化OKX价格显示（银行卡格式，用于z600u和z600命令）
 */
function formatOKXPriceForCalculation(sellers) {
  if (sellers.length === 0) {
    return '❌ 获取OKX价格失败，请稍后重试'
  }

  const top10 = sellers.slice(0, 10)
  const lines = ['欧易银行卡购买USDT价格']
  lines.push('─'.repeat(20))

  top10.forEach((seller, index) => {
    const price = seller.price.toFixed(2)
    const methods = seller.paymentMethods.map(m => {
      if (m === 'aliPay' || m === 'alipay') return '支付宝'
      if (m === 'wxPay') return '微信'
      if (m === 'bank') return '银行卡'
      return m
    }).join(', ')
    
    // 第三个用蓝色标记（索引为2）
    const marker = index === 2 ? '🔵' : '🟠'
    lines.push(`${marker} ${price} ${seller.nickName}${methods ? ` (${methods})` : ''}`)
  })

  return lines.join('\n')
}

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

// 已删除：z金额换算命令（z1000 / z20）

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
      await ctx.answerCbQuery('获取失败', { show_alert: true }).catch(() => { })
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

/**
 * z金额u命令 - 使用OKX第三个汇率计算USDT对应的人民币
 * 例如：z600u - 使用第三个汇率计算600U对应的人民币
 */
export function registerZAmountU(bot) {
  bot.hears(/^z(\d+(?:\.\d+)?)u$/i, async (ctx) => {
    try {
      const match = ctx.message.text.match(/^z(\d+(?:\.\d+)?)u$/i)
      if (!match) return

      const usdtAmount = parseFloat(match[1])
      if (!Number.isFinite(usdtAmount) || usdtAmount <= 0) {
        return ctx.reply('❌ 无效的金额')
      }

      // 获取OKX C2C价格（银行卡）
      const sellers = await getOKXC2CSellers('bank')

      if (sellers.length < 3) {
        return ctx.reply('❌ 获取OKX价格失败，请稍后重试')
      }

      // 使用第三个汇率（索引为2）
      const thirdSeller = sellers[2]
      const rate = thirdSeller.price

      // 计算：汇率 * USDT数量 = 人民币
      const rmbAmount = Number((usdtAmount * rate).toFixed(2))

      // 格式化显示：先显示价格列表，然后用分割线，再显示计算结果
      const priceList = formatOKXPriceForCalculation(sellers)
      const separator = '─'.repeat(20)
      const calculation = `${usdtAmount.toFixed(2)}U * ${rate.toFixed(2)} = ${rmbAmount.toFixed(2)}RMB`

      const result = `${priceList}\n${separator}\n${calculation}`

      await ctx.reply(result)
    } catch (e) {
      console.error('[z金额u命令]', e)
      await ctx.reply('❌ 计算失败，请稍后重试')
    }
  })
}

/**
 * z金额命令 - 使用OKX第三个汇率计算人民币对应的USDT
 * 例如：z600 - 使用第三个汇率计算600元对应的USDT
 * 注意：不匹配 z0（z0 由 registerZ0 处理）
 */
export function registerZAmount(bot) {
  bot.hears(/^z([1-9]\d*(?:\.\d+)?)$/i, async (ctx) => {
    try {
      const match = ctx.message.text.match(/^z([1-9]\d*(?:\.\d+)?)$/i)
      if (!match) return

      const rmbAmount = parseFloat(match[1])
      if (!Number.isFinite(rmbAmount) || rmbAmount <= 0) {
        return ctx.reply('❌ 无效的金额')
      }

      // 获取OKX C2C价格（银行卡）
      const sellers = await getOKXC2CSellers('bank')

      if (sellers.length < 3) {
        return ctx.reply('❌ 获取OKX价格失败，请稍后重试')
      }

      // 使用第三个汇率（索引为2）
      const thirdSeller = sellers[2]
      const rate = thirdSeller.price

      // 计算：人民币 / 汇率 = USDT
      const usdtAmount = Number((rmbAmount / rate).toFixed(2))

      // 格式化显示：先显示价格列表，然后用分割线，再显示计算结果
      const priceList = formatOKXPriceForCalculation(sellers)
      const separator = '─'.repeat(20)
      const calculation = `${rmbAmount.toFixed(2)}RMB / ${rate.toFixed(2)} = ${usdtAmount.toFixed(2)}U`

      const result = `${priceList}\n${separator}\n${calculation}`

      await ctx.reply(result)
    } catch (e) {
      console.error('[z金额命令]', e)
      await ctx.reply('❌ 计算失败，请稍后重试')
    }
  })
}

