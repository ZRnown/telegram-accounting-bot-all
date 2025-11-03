// 记账相关命令处理器
import { prisma } from '../../lib/db.ts'
import { parseAmountAndRate } from '../state.js'
import { ensureDbChat, getOrCreateTodayBill, checkAndClearIfNewDay } from '../database.js'
import { buildInlineKb, hasOperatorPermission, fetchRealtimeRateUSDTtoCNY } from '../helpers.js'
import { formatSummary } from '../formatting.js'
import { formatMoney } from '../utils.js'
import { getUsername } from '../helpers.js'

/**
 * 初始化记账（开始记账）
 */
export function registerStartAccounting(bot, ensureChat) {
  bot.hears(/^开始记账$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    await ensureDbChat(ctx)
    await ctx.reply('✅ 记账已初始化', { ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 入款命令处理器
 */
export function registerIncome(bot, ensureChat) {
  bot.hears(/^[+\-]\s*[\d+\-*/.()]+(?:u|U)?(?:\s*\/\s*\d+(?:\.\d+)?)?$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (!(await hasOperatorPermission(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员或已添加的操作人可以记账。')
    }

    const chatId = await ensureDbChat(ctx)
    
    // 🔥 检查是否跨日，如果是每日清零模式则清空内存数据
    await checkAndClearIfNewDay(chat, chatId)
    const text = ctx.message.text.trim()

    if (ctx.from?.id && ctx.from?.username) {
      const uname = `@${ctx.from.username}`
      chat.userIdByUsername.set(uname, ctx.from.id)
      chat.userIdByUsername.set(ctx.from.username, ctx.from.id)
    }

    const isUSDT = /[uU]/.test(text)
    const cleanText = text.replace(/[uU]/g, '').replace(/\s+/g, '')
    const parsed = parseAmountAndRate(cleanText)
    if (!parsed) {
      return ctx.reply('❌ 无效的金额格式')
    }

    if (!Number(parsed.amount)) {
      const summary = await formatSummary(ctx, chat, { title: '当前账单' })
      return ctx.reply(summary, { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' })
    }

    const rate = parsed.rate ?? chat.fixedRate ?? chat.realtimeRate
    
    let amountRMB, usdt
    if (isUSDT) {
      usdt = Math.abs(parsed.amount)
      amountRMB = rate ? Number((usdt * rate).toFixed(2)) : 0
      if (parsed.amount < 0) amountRMB = -amountRMB
    } else {
      amountRMB = parsed.amount
      usdt = rate ? Number((Math.abs(amountRMB) / rate).toFixed(1)) : undefined
    }
    
    const operatorUsername = ctx.from?.username ? `@${ctx.from.username}` : null
    const replierUsername = getUsername(ctx)
    
    chat.current.incomes.push({
      amount: amountRMB,
      rate: parsed.rate || undefined,
      createdAt: new Date(),
      replier: replierUsername,
      operator: operatorUsername || replierUsername,
    })

    try {
      const { bill } = await getOrCreateTodayBill(chatId)
      await prisma.billItem.create({ 
        data: {
          billId: bill.id,
          type: 'INCOME',
          amount: Number(amountRMB),
          rate: rate ? Number(rate) : null,
          usdt: usdt ? Number(usdt) : null,
          replier: replierUsername || null,
          operator: operatorUsername || replierUsername || null,
          createdAt: new Date(),
        } 
      })
    } catch (e) {
      console.error('写入 BillItem(INCOME) 失败', e)
    }

    // 超押提醒检查
    if (amountRMB > 0) {
      try {
        const setting = await prisma.setting.findUnique({
          where: { chatId },
          select: { overDepositLimit: true, lastOverDepositWarning: true }
        })
        
        if (setting?.overDepositLimit && setting.overDepositLimit > 0) {
          const { bill } = await getOrCreateTodayBill(chatId)
          const totalIncome = await prisma.billItem.aggregate({
            where: { billId: bill.id, type: 'INCOME' },
            _sum: { amount: true }
          })
          
          const currentTotal = (totalIncome._sum.amount || 0)
          const limit = setting.overDepositLimit
          const shouldWarn = currentTotal >= limit || (currentTotal >= limit * 0.9 && currentTotal < limit)
          const lastWarning = setting.lastOverDepositWarning
          const shouldSendWarning = shouldWarn && (!lastWarning || Date.now() - lastWarning.getTime() > 60 * 60 * 1000)
          
          if (shouldSendWarning) {
            const warningText = currentTotal >= limit
              ? `⚠️ *超押提醒*\n\n当前入款总额：${formatMoney(currentTotal)} 元\n设置额度：${formatMoney(limit)} 元\n已超过额度：${formatMoney(currentTotal - limit)} 元`
              : `⚠️ *超押提醒*\n\n当前入款总额：${formatMoney(currentTotal)} 元\n设置额度：${formatMoney(limit)} 元\n即将超过额度，还差：${formatMoney(limit - currentTotal)} 元`
            
            await ctx.reply(warningText, { parse_mode: 'Markdown' })
            await prisma.setting.update({
              where: { chatId },
              data: { lastOverDepositWarning: new Date() }
            })
          }
        }
      } catch (e) {
        console.error('[超押提醒]', e)
      }
    }

    try {
      const summary = await formatSummary(ctx, chat, { title: '当前账单' })
      const inlineKb = await buildInlineKb(ctx)
      await ctx.reply(summary, { ...inlineKb, parse_mode: 'Markdown' })
    } catch (e) {
      console.error('[记账命令] 发送回复失败', e)
      await ctx.reply('✅ 记账已保存（账单显示失败，请稍后查看）').catch(() => {})
    }
  })
}

/**
 * 下发命令处理器
 */
export function registerDispatch(bot, ensureChat) {
  bot.hears(/^下发\s*[+\-]?\s*\d+(?:\.\d+)?(?:u|U)?$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    if (!(await hasOperatorPermission(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员或已添加的操作人可以记账。')
    }
    
    const chatId = await ensureDbChat(ctx)
    
    // 🔥 检查是否跨日，如果是每日清零模式则清空内存数据
    await checkAndClearIfNewDay(chat, chatId)
    const text = ctx.message.text.trim()
    const isUSDT = /[uU]/.test(text)
    const m = text.match(/^下发\s*([+\-]?\s*\d+(?:\.\d+)?)/i)
    if (!m) return
    
    const inputValue = Number(m[1].replace(/\s+/g, ''))
    if (!Number.isFinite(inputValue)) return
    
    const rate = chat.fixedRate ?? chat.realtimeRate
    let amountRMB, usdtValue
    
    if (isUSDT) {
      usdtValue = inputValue
      amountRMB = rate ? Number((Math.abs(usdtValue) * rate).toFixed(2)) : 0
      if (usdtValue < 0) amountRMB = -amountRMB
    } else {
      amountRMB = inputValue
      usdtValue = rate ? Number((Math.abs(amountRMB) / rate).toFixed(1)) : 0
      if (amountRMB < 0) usdtValue = -usdtValue
    }
    
    const operatorUsername = ctx.from?.username ? `@${ctx.from.username}` : null
    const replierUsername = getUsername(ctx)
    
    chat.current.dispatches.push({
      amount: amountRMB,
      usdt: Math.abs(usdtValue),
      createdAt: new Date(),
      replier: replierUsername,
      operator: operatorUsername || replierUsername,
    })

    try {
      const { bill } = await getOrCreateTodayBill(chatId)
      await prisma.billItem.create({ 
        data: {
          billId: bill.id,
          type: 'DISPATCH',
          amount: Number(amountRMB),
          usdt: Number(usdtValue),
          replier: replierUsername || null,
          operator: operatorUsername || replierUsername || null,
          createdAt: new Date(),
        } 
      })
    } catch (e) {
      console.error('写入 BillItem(DISPATCH) 失败', e)
    }

    try {
      const summary = await formatSummary(ctx, chat, { title: '当前账单' })
      await ctx.reply(summary, { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' })
    } catch (e) {
      console.error('[下发命令] 发送回复失败', e)
      await ctx.reply('✅ 下发已保存').catch(() => {})
    }
  })
}

