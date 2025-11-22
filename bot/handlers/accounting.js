// 记账相关命令处理器
import { prisma } from '../../lib/db.js'
import { parseAmountAndRate } from '../state.js'
import { ensureDbChat, getOrCreateTodayBill, checkAndClearIfNewDay, updateSettings, syncSettingsToMemory } from '../database.js'
import { buildInlineKb, fetchRealtimeRateUSDTtoCNY, getEffectiveRate, hasPermissionWithWhitelist } from '../helpers.js'
import { formatSummary } from '../formatting.js'
import { formatMoney } from '../utils.js'
import { getUsername } from '../helpers.js'
import { isAccountingEnabled, isFeatureEnabled, clearAccountingCache } from '../middleware.js'

/**
 * 开始记账（激活机器人并开始记录）
 */
export function registerStartAccounting(bot, ensureChat) {
  bot.hears(/^(开始记账|开始)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    const chatId = await ensureDbChat(ctx, chat)
    await updateSettings(chatId, { accountingEnabled: true })
    clearAccountingCache(chatId) // 🔥 清除缓存，立即生效
    await ctx.reply('✅ 已开始记账，机器人已激活并开始记录', { ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 停止记账（暂停机器人记录）
 */
export function registerStopAccounting(bot, ensureChat) {
  bot.hears(/^(停止记账|停止)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    // 🔥 权限检查：只有管理员或操作员可以停止记账
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员或已添加的操作人可以操作。')
    }

    const chatId = await ensureDbChat(ctx, chat)
    await updateSettings(chatId, { accountingEnabled: false })
    clearAccountingCache(chatId) // 🔥 清除缓存，立即生效
    await ctx.reply('⏸️ 已停止记账，机器人已暂停记录。发送"开始"可重新开始记账', { ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 🔥 备注入账：备注 +10000 或 李四+10000
 * 注意：
 * - "备注 +1000" 格式：备注和金额之间必须有空格
 * - "李四+10000" 格式：传统格式（兼容旧版本）
 * - 不能匹配@用户名+金额格式（那个由registerIncomeWithTarget处理）
 * - 不能匹配计算表达式（如+3232+323应该计算，不是备注）
 */
export function registerIncomeWithRemark(bot, ensureChat) {
  // 🔥 匹配两种格式：
  // 1. "备注 +1000" - 备注和金额之间必须有空格
  // 2. "李四+10000" - 传统格式（非数字开头，非@开头，非+/-开头）
  // 🔥 排除以+/-开头的计算表达式（如+3232+323）
  bot.hears(/^(备注\s+[+\-]\s*\d+(?:\.\d+)?(?:u|U)?|[^@\s\d+\-][^@]*?\+(\d+(?:\.\d+)?)(?:u|U)?)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    // 🔥 检查记账是否启用（由中间件统一处理提醒逻辑）
    if (!(await isAccountingEnabled(ctx))) {
      return // 中间件已处理提醒
    }

    // 🔥 检查基础记账功能是否启用
    if (!(await isFeatureEnabled(ctx, 'accounting_basic'))) {
      return // 中间件已处理提醒
    }

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以记账。')
    }

    const chatId = await ensureDbChat(ctx, chat)
    const isNewDay = await checkAndClearIfNewDay(chat, chatId)
    // 🔥 修复：跨日后重新同步设置到内存（确保操作人、汇率、费率不丢失）
    if (isNewDay) {
      await syncSettingsToMemory(ctx, chat, chatId)
    }

    const text = ctx.message.text.trim()

    // 🔥 优先匹配 "备注 +1000" 格式（备注和金额之间必须有空格）
    let remark = null
    let amountStr = null
    let isUSDT = false

    if (/^备注\s+/i.test(text)) {
      // "备注 +1000" 格式
      const remarkMatch = text.match(/^备注\s+([+\-]\s*\d+(?:\.\d+)?(?:u|U)?)(?:\s+(.+))?$/i)
      if (remarkMatch) {
        amountStr = remarkMatch[1].replace(/\s+/g, '') // 去掉空格
        remark = remarkMatch[2]?.trim() || null // 可选的额外备注
        isUSDT = /[uU]/.test(amountStr)
        // 去掉u/U后缀
        amountStr = amountStr.replace(/[uU]/g, '')
      } else {
        return // 格式不匹配，让其他处理器处理
      }
    } else {
      // "李四+10000" 传统格式（非数字开头，非@开头，非+/-开头）
      // 🔥 排除以+/-开头的计算表达式（如+3232+323）
      if (/^[+\-]/.test(text)) {
        return // 以+/-开头的是计算表达式，不是备注，让其他处理器处理
      }

      const match = text.match(/^([^@\s\d+\-][^@]*?)\+(\d+(?:\.\d+)?)(?:u|U)?$/i)
      if (!match) return

      remark = match[1].trim() // 备注（如"李四"）
      amountStr = match[2]
      isUSDT = /[uU]/.test(text)
    }

    if (!amountStr) return

    // 🔥 优化：使用统一的汇率获取函数
    const rate = await getEffectiveRate(chatId, chat)

    const amount = Number(amountStr)
    if (!Number.isFinite(amount) || amount === 0) return

    let amountRMB, usdt
    if (isUSDT) {
      usdt = Math.abs(amount)
      amountRMB = rate ? Number((usdt * rate).toFixed(2)) : 0
      if (amount < 0) amountRMB = -amountRMB
    } else {
      amountRMB = amount
      usdt = rate ? Number((Math.abs(amountRMB) / rate).toFixed(2)) : undefined
    }

    const operatorUsername = ctx.from?.username ? `@${ctx.from.username}` : null
    const replierUsername = getUsername(ctx)

    chat.current.incomes.push({
      amount: amountRMB,
      rate: rate || undefined,
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
          remark: remark || null, // 🔥 保存备注
          replier: replierUsername || null,
          operator: operatorUsername || replierUsername || null,
          createdAt: new Date(),
        }
      })
    } catch (e) {
      console.error('写入 BillItem(INCOME) 失败', e)
    }

    try {
      const summary = await formatSummary(ctx, chat, { title: '当前账单' })
      await ctx.reply(summary, { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' })
    } catch (e) {
      console.error('[备注入账] 发送回复失败', e)
    }
  })
}

/**
 * 🔥 指定入账：@张三+1000 或回复+1000
 */
export function registerIncomeWithTarget(bot, ensureChat) {
  // 处理 @用户名+金额 格式
  bot.hears(/^@(\w+)\s*\+(\d+(?:\.\d+)?)(?:u|U)?$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    // 🔥 检查记账是否启用（由中间件统一处理提醒逻辑）
    if (!(await isAccountingEnabled(ctx))) {
      return // 中间件已处理提醒
    }

    // 🔥 检查基础记账功能是否启用
    if (!(await isFeatureEnabled(ctx, 'accounting_basic'))) {
      return // 中间件已处理提醒
    }

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以记账。')
    }

    const chatId = await ensureDbChat(ctx, chat)
    const isNewDay = await checkAndClearIfNewDay(chat, chatId)
    // 🔥 修复：跨日后重新同步设置到内存（确保操作人、汇率、费率不丢失）
    if (isNewDay) {
      await syncSettingsToMemory(ctx, chat, chatId)
    }

    const text = ctx.message.text.trim()
    const match = text.match(/^@(\w+)\s*\+(\d+(?:\.\d+)?)(?:u|U)?$/i)
    if (!match) return

    const targetUsername = `@${match[1]}` // 目标用户
    const amountStr = match[2]
    const isUSDT = /[uU]/.test(text)

    // 🔥 优化：使用统一的汇率获取函数
    const rate = await getEffectiveRate(chatId, chat)

    const amount = Number(amountStr)
    if (!Number.isFinite(amount) || amount === 0) return

    let amountRMB, usdt
    if (isUSDT) {
      usdt = Math.abs(amount)
      amountRMB = rate ? Number((usdt * rate).toFixed(2)) : 0
    } else {
      amountRMB = amount
      usdt = rate ? Number((Math.abs(amountRMB) / rate).toFixed(2)) : undefined
    }

    const operatorUsername = ctx.from?.username ? `@${ctx.from.username}` : null

    chat.current.incomes.push({
      amount: amountRMB,
      rate: rate || undefined,
      createdAt: new Date(),
      replier: targetUsername.replace('@', ''),
      operator: operatorUsername || targetUsername,
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
          replier: targetUsername.replace('@', '') || null,
          operator: operatorUsername || targetUsername || null,
          createdAt: new Date(),
        }
      })
    } catch (e) {
      console.error('写入 BillItem(INCOME) 失败', e)
    }

    try {
      const summary = await formatSummary(ctx, chat, { title: '当前账单' })
      await ctx.reply(summary, { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' })
    } catch (e) {
      console.error('[指定入账] 发送回复失败', e)
    }
  })

  // 处理回复消息的 +金额
  bot.on('text', async (ctx, next) => {
    const chat = ensureChat(ctx)
    if (!chat) return next()

    const text = ctx.message.text?.trim()
    const replyTo = ctx.message.reply_to_message
    if (!replyTo || !replyTo.from) return next()

    // 匹配 +金额 格式（在回复消息时）
    const match = text.match(/^\+(\d+(?:\.\d+)?)(?:u|U)?$/i)
    if (!match) return next()

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以记账。')
    }

    const chatId = await ensureDbChat(ctx, chat)
    const isNewDay = await checkAndClearIfNewDay(chat, chatId)
    // 🔥 修复：跨日后重新同步设置到内存（确保操作人、汇率、费率不丢失）
    if (isNewDay) {
      await syncSettingsToMemory(ctx, chat, chatId)
    }

    const amountStr = match[1]
    const isUSDT = /[uU]/.test(text)

    // 获取目标用户
    const targetUsername = replyTo.from.username ? `@${replyTo.from.username}` : `@user_${replyTo.from.id}`

    // 🔥 优化：使用统一的汇率获取函数
    const rate = await getEffectiveRate(chatId, chat)

    const amount = Number(amountStr)
    if (!Number.isFinite(amount) || amount === 0) return next()

    let amountRMB, usdt
    if (isUSDT) {
      usdt = Math.abs(amount)
      amountRMB = rate ? Number((usdt * rate).toFixed(2)) : 0
    } else {
      amountRMB = amount
      usdt = rate ? Number((Math.abs(amountRMB) / rate).toFixed(1)) : undefined
    }

    const operatorUsername = ctx.from?.username ? `@${ctx.from.username}` : null

    chat.current.incomes.push({
      amount: amountRMB,
      rate: rate || undefined,
      createdAt: new Date(),
      replier: targetUsername.replace('@', ''),
      operator: operatorUsername || targetUsername,
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
          replier: targetUsername.replace('@', '') || null,
          operator: operatorUsername || targetUsername || null,
          createdAt: new Date(),
        }
      })
    } catch (e) {
      console.error('写入 BillItem(INCOME) 失败', e)
    }

    try {
      const summary = await formatSummary(ctx, chat, { title: '当前账单' })
      await ctx.reply(summary, { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' })
    } catch (e) {
      console.error('[指定入账(回复)] 发送回复失败', e)
    }
  })
}

/**
 * 入款命令处理器（增强版：支持汇率、费率、组合格式）
 */
export function registerIncome(bot, ensureChat) {
  // 🔥 支持备注格式：备注 +1000 或 备注+1000
  bot.hears(/^(备注\s*)?[+\-]\s*[\d+\-*/.()]+(?:u|U)?(?:\s*\/\s*\d+(?:\.\d+)?)?(?:\s*\*\s*\d+(?:\.\d+)?)?$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    // 🔥 检查记账是否启用（由中间件统一处理提醒逻辑）
    if (!(await isAccountingEnabled(ctx))) {
      return // 中间件已处理提醒
    }

    // 🔥 检查基础记账功能是否启用
    if (!(await isFeatureEnabled(ctx, 'accounting_basic'))) {
      return // 中间件已处理提醒
    }

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以记账。')
    }

    const chatId = await ensureDbChat(ctx, chat)

    // 🔥 性能优化：一次性查询所有需要的设置
    const setting = await prisma.setting.findUnique({
      where: { chatId },
      select: { calculatorEnabled: true, featureWarningMode: true }
    })
    const calculatorEnabled = setting?.calculatorEnabled !== false // 默认开启

    // 🔥 检查是否跨日，如果是每日清零模式则清空内存数据
    const isNewDay = await checkAndClearIfNewDay(chat, chatId)
    // 🔥 修复：跨日后重新同步设置到内存（确保操作人、汇率、费率不丢失）
    if (isNewDay) {
      await syncSettingsToMemory(ctx, chat, chatId)
    }
    const text = ctx.message.text.trim()

    // 🔥 提取备注（如果有）
    let remark = null
    const remarkMatch = text.match(/^备注\s*(.+)$/i)
    let checkText = text
    if (remarkMatch) {
      checkText = remarkMatch[1].trim()
      // 提取金额部分（去掉备注）
      const amountMatch = checkText.match(/^([+\-]\s*[\d+\-*/.()]+(?:u|U)?(?:\s*\/\s*\d+(?:\.\d+)?)?(?:\s*\*\s*\d+(?:\.\d+)?)?)/i)
      if (amountMatch) {
        remark = checkText.substring(amountMatch[0].length).trim() || null
        checkText = amountMatch[0] // 只检查金额部分
      }
    }

    // 🔥 检查是否是计算表达式（需要包含运算符且不是简单的正负号）
    // 规则：如果包含运算符，且不是简单的 +数字 或 -数字 格式，则认为是计算表达式
    const hasOperator = /[+\-*\/]/.test(checkText)
    const isSimpleNumber = /^[+\-]?\s*\d+(?:\.\d+)?(?:u|U)?(?:\s*\/\s*\d+(?:\.\d+)?)?(?:\s*\*\s*\d+(?:\.\d+)?)?$/i.test(checkText.replace(/\s+/g, ''))
    const isCalculation = hasOperator && !isSimpleNumber

    // 🔥 如果是计算表达式且计算器已关闭，需要检查功能提示设置
    if (isCalculation && !calculatorEnabled) {
      // 🔥 使用功能提示逻辑（类似记账开关）
      const warningMode = setting?.featureWarningMode || 'always'
      let shouldWarn = false

      if (warningMode === 'always') {
        shouldWarn = true
        await prisma.featureWarningLog.deleteMany({
          where: { chatId, feature: 'calculator_disabled' }
        }).catch(() => { })
      } else if (warningMode === 'once') {
        const existingLog = await prisma.featureWarningLog.findUnique({
          where: { chatId_feature: { chatId, feature: 'calculator_disabled' } }
        })
        if (!existingLog) {
          shouldWarn = true
          await prisma.featureWarningLog.upsert({
            where: { chatId_feature: { chatId, feature: 'calculator_disabled' } },
            create: { chatId, feature: 'calculator_disabled' },
            update: { warnedAt: new Date() }
          }).catch(() => { })
        }
      } else if (warningMode === 'daily') {
        const existingLog = await prisma.featureWarningLog.findUnique({
          where: { chatId_feature: { chatId, feature: 'calculator_disabled' } }
        })
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        if (!existingLog || existingLog.warnedAt < today) {
          shouldWarn = true
          await prisma.featureWarningLog.upsert({
            where: { chatId_feature: { chatId, feature: 'calculator_disabled' } },
            create: { chatId, feature: 'calculator_disabled' },
            update: { warnedAt: now }
          }).catch(() => { })
        }
      }
      // warningMode === 'silent' 时不提醒

      if (shouldWarn) {
        return ctx.reply('⚠️ 计算器功能已关闭，不支持数学计算。请使用简单数字格式。')
      }
      return // 不提醒，直接返回
    }

    if (ctx.from?.id && ctx.from?.username) {
      const uname = `@${ctx.from.username}`
      chat.userIdByUsername.set(uname, ctx.from.id)
      chat.userIdByUsername.set(ctx.from.username, ctx.from.id)
    }

    // 🔥 提取金额部分（去掉"备注"前缀）
    let amountText = text
    if (text.startsWith('备注')) {
      amountText = text.replace(/^备注\s*/i, '').trim()
      // 如果还有备注内容，提取出来
      const amountMatch = amountText.match(/^([+\-]\s*[\d+\-*/.()]+(?:u|U)?(?:\s*\/\s*\d+(?:\.\d+)?)?(?:\s*\*\s*\d+(?:\.\d+)?)?)/i)
      if (amountMatch) {
        const remaining = amountText.substring(amountMatch[0].length).trim()
        if (remaining && !remark) {
          remark = remaining
        }
        amountText = amountMatch[0]
      }
    }

    const isUSDT = /[uU]/.test(amountText)
    const cleanText = amountText.replace(/[uU]/g, '').replace(/\s+/g, '')
    const parsed = parseAmountAndRate(cleanText)
    if (!parsed) {
      return ctx.reply('❌ 无效的金额格式')
    }

    if (!Number(parsed.amount)) {
      const summary = await formatSummary(ctx, chat, { title: '当前账单' })
      return ctx.reply(summary, { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' })
    }

    // 🔥 使用解析出的汇率，如果没有则使用群组设置
    const rate = parsed.rate ?? chat.fixedRate ?? chat.realtimeRate
    const feeRate = parsed.feeRate // 单独费率（如0.95表示95%）

    let amountRMB, usdt, finalAmountRMB

    if (isUSDT) {
      usdt = Math.abs(parsed.amount)
      amountRMB = rate ? Number((usdt * rate).toFixed(2)) : 0
      if (parsed.amount < 0) amountRMB = -amountRMB
    } else {
      amountRMB = parsed.amount
      usdt = rate ? Number((Math.abs(amountRMB) / rate).toFixed(1)) : undefined
    }

    // 🔥 如果指定了费率，应用费率（如0.95表示扣除5%手续费）
    if (feeRate && feeRate > 0 && feeRate <= 1) {
      finalAmountRMB = Number((amountRMB * feeRate).toFixed(2))
      // 如果输入的是USDT，也相应调整
      if (isUSDT && rate) {
        usdt = Number((Math.abs(finalAmountRMB) / rate).toFixed(2))
      }
    } else {
      finalAmountRMB = amountRMB
    }

    const operatorUsername = ctx.from?.username ? `@${ctx.from.username}` : null
    const replierUsername = getUsername(ctx)

    chat.current.incomes.push({
      amount: finalAmountRMB,
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
          amount: Number(finalAmountRMB),
          rate: rate ? Number(rate) : null,
          feeRate: feeRate ? Number(feeRate) : null, // 🔥 保存费率
          usdt: usdt ? Number(usdt) : null,
          remark: remark || null, // 🔥 保存备注
          replier: replierUsername || null,
          operator: operatorUsername || replierUsername || null,
          createdAt: new Date(),
        }
      })
    } catch (e) {
      console.error('写入 BillItem(INCOME) 失败', e)
    }

    // 超押提醒检查
    if (finalAmountRMB > 0) {
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
      await ctx.reply('✅ 记账已保存（账单显示失败，请稍后查看）').catch(() => { })
    }
  })
}

/**
 * 🔥 指定下发：@张三下发1000 或回复下发1000u
 */
export function registerDispatchWithTarget(bot, ensureChat) {
  // 处理 @用户名下发金额 格式
  bot.hears(/^@(\w+)\s*下发\s*([+\-]?\s*\d+(?:\.\d+)?)(?:u|U)?$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    // 🔥 检查记账是否启用（由中间件统一处理提醒逻辑）
    if (!(await isAccountingEnabled(ctx))) {
      return // 中间件已处理提醒
    }

    // 🔥 检查基础记账功能是否启用
    if (!(await isFeatureEnabled(ctx, 'accounting_basic'))) {
      return // 中间件已处理提醒
    }

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以记账。')
    }

    const chatId = await ensureDbChat(ctx, chat)
    const isNewDay = await checkAndClearIfNewDay(chat, chatId)
    // 🔥 修复：跨日后重新同步设置到内存（确保操作人、汇率、费率不丢失）
    if (isNewDay) {
      await syncSettingsToMemory(ctx, chat, chatId)
    }

    const text = ctx.message.text.trim()
    const match = text.match(/^@(\w+)\s*下发\s*([+\-]?\s*\d+(?:\.\d+)?)(?:u|U)?$/i)
    if (!match) return

    const targetUsername = `@${match[1]}`
    const amountStr = match[2].replace(/\s+/g, '')
    const isUSDT = /[uU]/.test(text)

    const inputValue = Number(amountStr)
    if (!Number.isFinite(inputValue)) return

    // 🔥 优化：使用统一的汇率获取函数
    const rate = await getEffectiveRate(chatId, chat)

    let amountRMB, usdtValue
    if (isUSDT) {
      usdtValue = inputValue
      amountRMB = rate ? Number((Math.abs(usdtValue) * rate).toFixed(2)) : 0
      if (usdtValue < 0) amountRMB = -amountRMB
    } else {
      amountRMB = inputValue
      usdtValue = rate ? Number((Math.abs(amountRMB) / rate).toFixed(2)) : 0
      if (amountRMB < 0) usdtValue = -usdtValue
    }

    const operatorUsername = ctx.from?.username ? `@${ctx.from.username}` : null

    chat.current.dispatches.push({
      amount: amountRMB,
      usdt: Math.abs(usdtValue),
      createdAt: new Date(),
      replier: targetUsername.replace('@', ''),
      operator: operatorUsername || targetUsername,
    })

    try {
      const { bill } = await getOrCreateTodayBill(chatId)
      await prisma.billItem.create({
        data: {
          billId: bill.id,
          type: 'DISPATCH',
          amount: Number(amountRMB),
          usdt: Number(usdtValue),
          replier: targetUsername.replace('@', '') || null,
          operator: operatorUsername || targetUsername || null,
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
      console.error('[指定下发] 发送回复失败', e)
    }
  })

  // 处理回复消息的 下发金额
  bot.on('text', async (ctx, next) => {
    const chat = ensureChat(ctx)
    if (!chat) return next()

    // 🔥 检查记账是否启用（由中间件统一处理提醒逻辑）
    const accountingOk = await isAccountingEnabled(ctx)
    if (!accountingOk) {
      return next() // 中间件已处理提醒
    }

    const text = ctx.message.text?.trim()
    const replyTo = ctx.message.reply_to_message
    if (!replyTo || !replyTo.from) return next()

    // 匹配 下发金额 格式（在回复消息时）
    const match = text.match(/^下发\s*([+\-]?\s*\d+(?:\.\d+)?)(?:u|U)?$/i)
    if (!match) return next()

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以记账。')
    }

    const chatId = await ensureDbChat(ctx, chat)
    const isNewDay = await checkAndClearIfNewDay(chat, chatId)
    // 🔥 修复：跨日后重新同步设置到内存（确保操作人、汇率、费率不丢失）
    if (isNewDay) {
      await syncSettingsToMemory(ctx, chat, chatId)
    }

    const amountStr = match[1].replace(/\s+/g, '')
    const isUSDT = /[uU]/.test(text)

    const inputValue = Number(amountStr)
    if (!Number.isFinite(inputValue)) return next()

    // 获取目标用户
    const targetUsername = replyTo.from.username ? `@${replyTo.from.username}` : `@user_${replyTo.from.id}`

    // 🔥 优化：使用统一的汇率获取函数
    const rate = await getEffectiveRate(chatId, chat)

    let amountRMB, usdtValue
    if (isUSDT) {
      usdtValue = inputValue
      amountRMB = rate ? Number((Math.abs(usdtValue) * rate).toFixed(2)) : 0
      if (usdtValue < 0) amountRMB = -amountRMB
    } else {
      amountRMB = inputValue
      usdtValue = rate ? Number((Math.abs(amountRMB) / rate).toFixed(2)) : 0
      if (amountRMB < 0) usdtValue = -usdtValue
    }

    const operatorUsername = ctx.from?.username ? `@${ctx.from.username}` : null

    chat.current.dispatches.push({
      amount: amountRMB,
      usdt: Math.abs(usdtValue),
      createdAt: new Date(),
      replier: targetUsername.replace('@', ''),
      operator: operatorUsername || targetUsername,
    })

    try {
      const { bill } = await getOrCreateTodayBill(chatId)
      await prisma.billItem.create({
        data: {
          billId: bill.id,
          type: 'DISPATCH',
          amount: Number(amountRMB),
          usdt: Number(usdtValue),
          replier: targetUsername.replace('@', '') || null,
          operator: operatorUsername || targetUsername || null,
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
      console.error('[指定下发(回复)] 发送回复失败', e)
    }
  })
}

/**
 * 下发命令处理器（增强版：使用当前汇率）
 */
export function registerDispatch(bot, ensureChat) {
  // 🔥 支持备注格式：备注 下发1000 或 备注下发1000
  bot.hears(/^(备注\s*)?下发\s*[+\-]?\s*\d+(?:\.\d+)?(?:u|U)?$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    // 🔥 检查记账是否启用（由中间件统一处理提醒逻辑）
    if (!(await isAccountingEnabled(ctx))) {
      return // 中间件已处理提醒
    }

    // 🔥 检查基础记账功能是否启用
    if (!(await isFeatureEnabled(ctx, 'accounting_basic'))) {
      return // 中间件已处理提醒
    }

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以记账。')
    }

    const chatId = await ensureDbChat(ctx, chat)

    // 🔥 检查是否跨日，如果是每日清零模式则清空内存数据
    const isNewDay = await checkAndClearIfNewDay(chat, chatId)
    // 🔥 修复：跨日后重新同步设置到内存（确保操作人、汇率、费率不丢失）
    if (isNewDay) {
      await syncSettingsToMemory(ctx, chat, chatId)
    }
    const text = ctx.message.text.trim()

    // 🔥 提取备注（如果有）
    let remark = null
    let dispatchText = text
    if (text.startsWith('备注')) {
      dispatchText = text.replace(/^备注\s*/i, '').trim()
      // 提取金额部分
      const amountMatch = dispatchText.match(/^下发\s*([+\-]?\s*\d+(?:\.\d+)?(?:u|U)?)/i)
      if (amountMatch) {
        const remaining = dispatchText.substring(amountMatch[0].length).trim()
        if (remaining) {
          remark = remaining
        }
        dispatchText = amountMatch[0]
      }
    }

    const isUSDT = /[uU]/.test(dispatchText)
    const m = dispatchText.match(/^下发\s*([+\-]?\s*\d+(?:\.\d+)?)/i)
    if (!m) return

    const inputValue = Number(m[1].replace(/\s+/g, ''))
    if (!Number.isFinite(inputValue)) return

    // 🔥 优化：使用统一的汇率获取函数
    const rate = await getEffectiveRate(chatId, chat)

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
          remark: remark || null, // 🔥 保存备注
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
      await ctx.reply('✅ 下发已保存').catch(() => { })
    }
  })
}
