// 账单相关命令处理器
import { prisma } from '../../lib/db.js'
import { getChat } from '../state.js'
import { ensureDbChat, getOrCreateTodayBill, deleteLastIncome, deleteLastDispatch, deleteIncomeByMessageId, deleteDispatchByMessageId, getChatDailyCutoffHour } from '../database.js'
import { buildInlineKb, hasPermissionWithWhitelist } from '../helpers.js'
import { formatSummary } from '../formatting.js'
import { getGlobalDailyCutoffHour } from '../utils.js'
import { startOfDay, endOfDay } from '../utils.js'

/**
 * 显示账单
 */
export function registerShowBill(bot, ensureChat) {
  bot.hears(/^(显示账单|\+0)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    const summary = await formatSummary(ctx, chat, { title: '当前账单' })
    await ctx.reply(summary, { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' })
  })
}

/**
 * 保存账单
 */
export function registerSaveBill(bot, ensureChat) {
  bot.hears(/^保存账单$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以操作。')
    }

    const chatId = await ensureDbChat(ctx, chat)

    try {
      // 🔥 检查记账模式
      const settings = await prisma.setting.findUnique({
        where: { chatId },
        select: { accountingMode: true }
      })
      const accountingMode = settings?.accountingMode || 'DAILY_RESET'
      const isCumulativeMode = accountingMode === 'CARRY_OVER'
      const isSingleBillMode = accountingMode === 'SINGLE_BILL_PER_DAY'

      // 🔥 单笔订单模式：不支持保存账单
      if (isSingleBillMode) {
        return ctx.reply('⚠️ 当前记账模式不支持保存账单。每天只有一笔订单，日切时会自动关闭。', { ...(await buildInlineKb(ctx)) })
      }

      const { bill } = await getOrCreateTodayBill(chatId)
      const now = new Date()

      // 🔥 保存账单：记录closedAt（结束时间），然后创建新账单（以当前时间作为开始时间）
      await prisma.bill.update({
        where: { id: bill.id },
        data: { status: 'CLOSED', closedAt: now, savedAt: now }
      })

      // 清空内存
      chat.history.push({
        savedAt: now,
        data: {
          incomes: [...chat.current.incomes],
          dispatches: [...chat.current.dispatches]
        }
      })
      chat.current.incomes = []
      chat.current.dispatches = []

      // 🔥 累计模式：保存后自动创建新的账单（以当前时间作为开始时间）
      if (isCumulativeMode) {
        // 🔥 创建新账单，以当前时间作为开始时间
        await prisma.bill.create({
          data: {
            chatId,
            status: 'OPEN',
            openedAt: now, // 🔥 以当前时间作为开始时间
            savedAt: now
          }
        })
        await ctx.reply('✅ 账单已保存，已自动创建新的账单', { ...(await buildInlineKb(ctx)) })
      } else {
        await ctx.reply('✅ 账单已保存并清空', { ...(await buildInlineKb(ctx)) })
      }
    } catch (e) {
      console.error('保存账单失败', e)
      await ctx.reply('❌ 保存账单失败，请稍后重试')
    }
  })
}

/**
 * 删除账单（清空当前，不保存）
 * 🔥 支持删除确认功能（如果后台设置了deleteBillConfirm）
 */
export function registerDeleteBill(bot, ensureChat) {
  bot.hears(/^删除账单$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以操作。')
    }

    const chatId = await ensureDbChat(ctx, chat)

    try {
      // 🔥 检查是否需要确认
      const setting = await prisma.setting.findUnique({
        where: { chatId },
        select: { deleteBillConfirm: true }
      })

      if (setting?.deleteBillConfirm) {
        // 需要二次确认，先提示用户
        const { Markup } = await import('telegraf')
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('✅ 确认删除', 'confirm_delete_bill')],
          [Markup.button.callback('❌ 取消', 'cancel_delete_bill')]
        ])

        // 🔥 使用临时存储（Map）来存储待删除的chatId，避免session问题
        // 格式：userId_chatId -> true
        const deletePendingKey = `${ctx.from?.id}_${chatId}`
        if (!global.pendingDeleteBills) {
          global.pendingDeleteBills = new Map()
        }
        global.pendingDeleteBills.set(deletePendingKey, { chatId, userId: ctx.from?.id, timestamp: Date.now() })

        await ctx.reply(
          '⚠️ *删除确认*\n\n确定要删除当前账单吗？此操作不可恢复！\n\n点击下方按钮确认或取消：',
          { ...keyboard, parse_mode: 'Markdown' }
        )
        return
      }

      // 🔥 优化：先查询当前账单，不要自动创建（避免删除后立即创建新账单）
      const cutoffHour = await getChatDailyCutoffHour(chatId)
      const now = new Date()
      const todayCutoff = new Date()
      todayCutoff.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
      todayCutoff.setHours(cutoffHour, 0, 0, 0)

      let gte, lt
      if (now >= todayCutoff) {
        gte = new Date(todayCutoff)
        lt = new Date(todayCutoff)
        lt.setDate(lt.getDate() + 1)
      } else {
        gte = new Date(todayCutoff)
        gte.setDate(gte.getDate() - 1)
        lt = new Date(todayCutoff)
      }

      // 🔥 查询当前账单（不自动创建）
      const bill = await prisma.bill.findFirst({
        where: { chatId, status: 'OPEN', openedAt: { gte, lt } },
        orderBy: { openedAt: 'asc' }
      })

      if (!bill) {
        // 如果没有账单，直接清空内存即可
        chat.current.incomes = []
        chat.current.dispatches = []
        return ctx.reply('✅ 当前没有账单', { ...(await buildInlineKb(ctx)) })
      }

      // 🔥 累计模式：删除账单和所有账单项，确保该账单不再计入其他账单的历史数据
      // 🔥 清零模式：只删除账单项，保留账单（保持原有逻辑）
      const settings = await prisma.setting.findUnique({
        where: { chatId },
        select: { accountingMode: true }
      })
      const isCumulativeMode = settings?.accountingMode === 'CARRY_OVER'

      if (isCumulativeMode) {
        // 累计模式：完全删除账单（使用事务确保原子性）
        await prisma.$transaction(async (tx) => {
          await tx.billItem.deleteMany({ where: { billId: bill.id } })
          await tx.bill.delete({ where: { id: bill.id } })
        })
      } else {
        // 清零模式：只删除账单项
        await prisma.billItem.deleteMany({ where: { billId: bill.id } })
      }

      chat.current.incomes = []
      chat.current.dispatches = []

      // 🔥 删除账单后，重新显示账单摘要（确保历史未下发正确更新）
      try {
        const summary = await formatSummary(ctx, chat, { title: '当前账单' })
        await ctx.reply(summary, { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' })
      } catch (e) {
        console.error('[删除账单] 显示摘要失败', e)
        await ctx.reply('✅ 当前账单已清空', { ...(await buildInlineKb(ctx)) })
      }
    } catch (e) {
      console.error('删除账单失败', e)
      await ctx.reply('❌ 删除账单失败，请稍后重试')
    }
  })

  // 🔥 确认删除按钮
  bot.action('confirm_delete_bill', async (ctx) => {
    try { await ctx.answerCbQuery() } catch { }

    const chat = ensureChat(ctx)
    if (!chat) return

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以操作。')
    }

    // 🔥 从临时存储中获取chatId
    const chatId = String(ctx.chat?.id || '')
    const userId = ctx.from?.id
    const deletePendingKey = `${userId}_${chatId}`

    if (!global.pendingDeleteBills) {
      return ctx.reply('❌ 操作已过期，请重新发送"删除账单"')
    }

    const pendingInfo = global.pendingDeleteBills.get(deletePendingKey)
    if (!pendingInfo || (Date.now() - pendingInfo.timestamp > 5 * 60 * 1000)) {
      // 超过5分钟，清除过期记录
      global.pendingDeleteBills.delete(deletePendingKey)
      return ctx.reply('❌ 操作已过期，请重新发送"删除账单"')
    }

    // 🔥 使用pendingInfo中的chatId（更可靠）
    const finalChatId = pendingInfo.chatId || chatId

    try {
      // 🔥 优化：先查询当前账单，不要自动创建（避免删除后立即创建新账单）
      const cutoffHour = await getChatDailyCutoffHour(finalChatId)
      const now = new Date()
      const todayCutoff = new Date()
      todayCutoff.setFullYear(now.getFullYear(), now.getMonth(), now.getDate())
      todayCutoff.setHours(cutoffHour, 0, 0, 0)

      let gte, lt
      if (now >= todayCutoff) {
        gte = new Date(todayCutoff)
        lt = new Date(todayCutoff)
        lt.setDate(lt.getDate() + 1)
      } else {
        gte = new Date(todayCutoff)
        gte.setDate(gte.getDate() - 1)
        lt = new Date(todayCutoff)
      }

      // 🔥 查询当前账单（不自动创建）
      const bill = await prisma.bill.findFirst({
        where: { chatId: finalChatId, status: 'OPEN', openedAt: { gte, lt } },
        orderBy: { openedAt: 'asc' }
      })

      if (!bill) {
        // 如果没有账单，直接清空内存即可
        chat.current.incomes = []
        chat.current.dispatches = []
        // 🔥 清除待删除标记
        if (global.pendingDeleteBills) {
          global.pendingDeleteBills.delete(deletePendingKey)
        }
        await ctx.reply('✅ 当前没有账单', { ...(await buildInlineKb(ctx)) })
        await ctx.deleteMessage().catch(() => { })
        return
      }

      // 🔥 累计模式：删除账单和所有账单项，确保该账单不再计入其他账单的历史数据
      // 🔥 清零模式：只删除账单项，保留账单（保持原有逻辑）
      const settings = await prisma.setting.findUnique({
        where: { chatId: finalChatId },
        select: { accountingMode: true }
      })
      const isCumulativeMode = settings?.accountingMode === 'CARRY_OVER'

      if (isCumulativeMode) {
        // 累计模式：完全删除账单（使用事务确保原子性）
        await prisma.$transaction(async (tx) => {
          await tx.billItem.deleteMany({ where: { billId: bill.id } })
          await tx.bill.delete({ where: { id: bill.id } })
        })
      } else {
        // 清零模式：只删除账单项
        await prisma.billItem.deleteMany({ where: { billId: bill.id } })
      }

      chat.current.incomes = []
      chat.current.dispatches = []

      // 🔥 清除待删除标记
      if (global.pendingDeleteBills) {
        global.pendingDeleteBills.delete(deletePendingKey)
      }

      await ctx.reply('✅ 当前账单已清空', { ...(await buildInlineKb(ctx)) })
      await ctx.deleteMessage().catch(() => { })
    } catch (e) {
      console.error('删除账单失败', e)
      await ctx.reply('❌ 删除账单失败，请稍后重试')
    }
  })

  // 🔥 取消删除按钮
  bot.action('cancel_delete_bill', async (ctx) => {
    try { await ctx.answerCbQuery() } catch { }

    // 🔥 清除待删除标记
    const chatId = String(ctx.chat?.id || '')
    const userId = ctx.from?.id
    if (global.pendingDeleteBills && userId) {
      global.pendingDeleteBills.delete(`${userId}_${chatId}`)
    }

    await ctx.reply('已取消删除操作', { ...(await buildInlineKb(ctx)) })
    await ctx.deleteMessage().catch(() => { })
  })
}

/**
 * 删除全部账单
 */
export function registerDeleteAllBills(bot, ensureChat) {
  bot.hears(/^(删除全部账单|清除全部账单)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以操作。')
    }

    const chatId = await ensureDbChat(ctx, chat)

    try {
      const allBills = await prisma.bill.findMany({ where: { chatId }, select: { id: true } })
      const billIds = allBills.map(b => b.id)

      await Promise.all([
        prisma.billItem.deleteMany({ where: { billId: { in: billIds } } }),
        prisma.bill.deleteMany({ where: { id: { in: billIds } } })
      ])

      chat.current = { incomes: [], dispatches: [] }
      chat.history = []

      await ctx.reply(`⚠️ 已删除全部账单（共 ${allBills.length} 条账单记录）\n\n请谨慎使用此功能！`)
    } catch (e) {
      console.error('删除全部账单失败', e)
      await ctx.reply('❌ 删除全部账单失败，请稍后重试')
    }
  })
}

/**
 * 显示历史账单
 */
export function registerShowHistory(bot, ensureChat) {
  bot.hears(/^显示历史账单$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (chat.history.length === 0) {
      return ctx.reply('暂无历史账单')
    }

    const lines = chat.history.slice(-5).map((h, i) => {
      const incomes = h.data.incomes.length
      const dispatches = h.data.dispatches.length
      return `#${chat.history.length - (chat.history.length - i - 1)} 保存时间: ${new Date(h.savedAt).toLocaleString()} 入款:${incomes} 下发:${dispatches}`
    })
    await ctx.reply(['最近历史账单（最多5条）：', ...lines].join('\n'))
  })
}

/**
 * 查看历史入款记录（最多500条）
 */
export function registerShowIncomeHistory(bot, ensureChat) {
  bot.hears(/^查看入款历史$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以操作。')
    }

    const chatId = await ensureDbChat(ctx, chat)
    const { bill } = await getOrCreateTodayBill(chatId)
    if (!bill) {
      return ctx.reply('❌ 未找到账单')
    }

    // 🔥 查询最多500条历史记录
    const items = await prisma.billItem.findMany({
      where: { billId: bill.id, type: 'INCOME' },
      select: {
        id: true,
        amount: true,
        rate: true,
        usdt: true,
        displayName: true,
        messageId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500
    })

    if (items.length === 0) {
      return ctx.reply('暂无入款记录')
    }

    // 格式化显示（最多显示最近50条，避免消息过长）
    const displayItems = items.slice(0, 50)
    const lines = displayItems.map((item, index) => {
      const time = new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const amount = Number(item.amount || 0)
      const rate = item.rate ? Number(item.rate) : null
      const usdt = rate ? Number((Math.abs(amount) / rate).toFixed(1)) : (item.usdt ? Number(item.usdt) : 0)
      const name = item.displayName || '用户'
      return `${index + 1}. ${time} ${amount > 0 ? '+' : ''}${amount}${rate ? ` / ${rate}=${usdt}U` : ''} ${name}`
    })

    const totalText = items.length > 50 
      ? `最近50条（共${items.length}条，最多支持500条）：\n\n${lines.join('\n')}\n\n💡 提示：回复消息输入"撤销入款"可撤销对应记录`
      : `共${items.length}条记录：\n\n${lines.join('\n')}\n\n💡 提示：回复消息输入"撤销入款"可撤销对应记录`

    await ctx.reply(totalText, { parse_mode: 'MarkdownV2' })
  })
}

/**
 * 查看历史下发记录（最多500条）
 */
export function registerShowDispatchHistory(bot, ensureChat) {
  bot.hears(/^查看下发历史$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以操作。')
    }

    const chatId = await ensureDbChat(ctx, chat)
    const { bill } = await getOrCreateTodayBill(chatId)
    if (!bill) {
      return ctx.reply('❌ 未找到账单')
    }

    // 🔥 查询最多500条历史记录
    const items = await prisma.billItem.findMany({
      where: { billId: bill.id, type: 'DISPATCH' },
      select: {
        id: true,
        amount: true,
        usdt: true,
        displayName: true,
        messageId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500
    })

    if (items.length === 0) {
      return ctx.reply('暂无下发记录')
    }

    // 格式化显示（最多显示最近50条，避免消息过长）
    const displayItems = items.slice(0, 50)
    const lines = displayItems.map((item, index) => {
      const time = new Date(item.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const amount = Number(item.amount || 0)
      const usdt = Number(item.usdt || 0)
      const name = item.displayName || '用户'
      return `${index + 1}. ${time} ${amount} (${usdt}U) ${name}`
    })

    const totalText = items.length > 50 
      ? `最近50条（共${items.length}条，最多支持500条）：\n\n${lines.join('\n')}\n\n💡 提示：回复消息输入"撤销下发"可撤销对应记录`
      : `共${items.length}条记录：\n\n${lines.join('\n')}\n\n💡 提示：回复消息输入"撤销下发"可撤销对应记录`

    await ctx.reply(totalText, { parse_mode: 'MarkdownV2' })
  })
}

/**
 * 撤销入款
 * 🔥 支持回复消息撤销指定记录，如果没有回复则撤销最后一条
 * 🔥 支持撤销最多500条历史记录
 */
export function registerUndoIncome(bot, ensureChat) {
  bot.hears(/^撤销入款$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以操作。')
    }

    const chatId = await ensureDbChat(ctx, chat)
    
    // 🔥 检查是否有回复消息
    const replyToMessage = ctx.message.reply_to_message
    let result = null
    
    if (replyToMessage && replyToMessage.message_id) {
      // 如果有回复，通过 messageId 删除对应的记录
      result = await deleteIncomeByMessageId(chatId, replyToMessage.message_id)
      if (!result) {
        return ctx.reply('❌ 未找到对应的入款记录（可能该消息不是入款记录）')
      }
    } else {
      // 如果没有回复，删除最后一条
      result = await deleteLastIncome(chatId)
    if (!result) {
      return ctx.reply('❌ 没有可撤销的入款记录')
    }
    }

    // 从内存中移除，并与数据库重新同步，避免其它记录被误删/丢失
    try {
      // 先从数据库完整拉取当前账单的所有 INCOME 记录，作为权威数据
      const { bill } = await getOrCreateTodayBill(chatId)
      if (bill) {
        const items = await prisma.billItem.findMany({
          where: { billId: bill.id, type: 'INCOME' },
          orderBy: { createdAt: 'asc' },
          select: {
            amount: true,
            rate: true,
            usdt: true,
            replier: true,
            operator: true,
            displayName: true,
            userId: true,
            messageId: true,
            createdAt: true,
          },
        })

        chat.current.incomes = items.map((i) => ({
          amount: Number(i.amount || 0),
          rate: i.rate != null ? Number(i.rate) : undefined,
          createdAt: new Date(i.createdAt),
          replier: i.replier || '',
          operator: i.operator || '',
          displayName: i.displayName || null,
          userId: i.userId ? Number(i.userId) : null,
          messageId: i.messageId || null,
        }))
      }
      // 让后续的 formatSummary 认为需要重新同步一次（防止旧缓存影响）
      chat._billLastSync = 0
    } catch (e) {
      console.error('[撤销入款][sync-from-db-failed]', e)
    }

    const message = replyToMessage 
      ? `✅ 已撤销指定的入款记录：${result.amount}`
      : `✅ 已撤销最后一条入款：${result.amount}`
    await ctx.reply(message, { ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 撤销功能（通用）
 * 🔥 支持回复消息说"撤销"来撤销对应的入款或下发记录
 */
export function registerUndo(bot, ensureChat) {
  bot.hears(/^撤销$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以操作。')
    }

    const replyToMessage = ctx.message.reply_to_message
    if (!replyToMessage || !replyToMessage.message_id) {
      return ctx.reply('❌ 请回复要撤销的消息')
    }

    const chatId = await ensureDbChat(ctx, chat)

    // 尝试撤销入款
    let result = await deleteIncomeByMessageId(chatId, replyToMessage.message_id)
    let recordType = '入款'

    if (!result) {
      // 如果不是入款，尝试撤销下发
      result = await deleteDispatchByMessageId(chatId, replyToMessage.message_id)
      recordType = '下发'
    }

    if (!result) {
      return ctx.reply('❌ 未找到对应的入款或下发记录')
    }

    // 重新同步内存中的账单数据
    try {
      const { bill } = await getOrCreateTodayBill(chatId)
      if (bill) {
        // 同步入款记录
        const incomeItems = await prisma.billItem.findMany({
          where: { billId: bill.id, type: 'INCOME' },
          orderBy: { createdAt: 'asc' },
          select: {
            amount: true, rate: true, usdt: true, replier: true, operator: true,
            displayName: true, userId: true, messageId: true, createdAt: true,
          },
        })
        chat.current.incomes = incomeItems.map((i) => ({
          amount: Number(i.amount || 0),
          rate: i.rate != null ? Number(i.rate) : undefined,
          createdAt: new Date(i.createdAt),
          replier: i.replier || '',
          operator: i.operator || '',
          displayName: i.displayName || null,
          userId: i.userId ? Number(i.userId) : null,
          messageId: i.messageId || null,
        }))

        // 同步下发记录
        const dispatchItems = await prisma.billItem.findMany({
          where: { billId: bill.id, type: 'DISPATCH' },
          orderBy: { createdAt: 'asc' },
          select: {
            amount: true, usdt: true, replier: true, operator: true,
            displayName: true, userId: true, messageId: true, createdAt: true,
          },
        })
        chat.current.dispatches = dispatchItems.map((d) => ({
          amount: Number(d.amount || 0),
          usdt: d.usdt != null ? Number(d.usdt) : undefined,
          createdAt: new Date(d.createdAt),
          replier: d.replier || '',
          operator: d.operator || '',
          displayName: d.displayName || null,
          userId: d.userId ? Number(d.userId) : null,
          messageId: d.messageId || null,
        }))
      }
      chat._billLastSync = 0
    } catch (e) {
      console.error('[撤销][sync-from-db-failed]', e)
    }

    const amountStr = recordType === '入款' ? result.amount : `${result.usdt}U`
    await ctx.reply(`✅ 已撤销${recordType}记录：${amountStr}`, { ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 撤销下发
 * 🔥 支持回复消息撤销指定记录，如果没有回复则撤销最后一条
 */
export function registerUndoDispatch(bot, ensureChat) {
  bot.hears(/^撤销下发$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以操作。')
    }

    const chatId = await ensureDbChat(ctx, chat)
    
    // 🔥 检查是否有回复消息
    const replyToMessage = ctx.message.reply_to_message
    let result = null
    
    if (replyToMessage && replyToMessage.message_id) {
      // 如果有回复，通过 messageId 删除对应的记录
      result = await deleteDispatchByMessageId(chatId, replyToMessage.message_id)
      if (!result) {
        return ctx.reply('❌ 未找到对应的下发记录（可能该消息不是下发记录）')
      }
    } else {
      // 如果没有回复，删除最后一条
      result = await deleteLastDispatch(chatId)
    if (!result) {
      return ctx.reply('❌ 没有可撤销的下发记录')
    }
    }

    // 从内存中移除，并与数据库重新同步
    try {
      // 先从数据库完整拉取当前账单的所有 DISPATCH 记录，作为权威数据
      const { bill } = await getOrCreateTodayBill(chatId)
      if (bill) {
        const items = await prisma.billItem.findMany({
          where: { billId: bill.id, type: 'DISPATCH' },
          orderBy: { createdAt: 'asc' },
          select: {
            amount: true,
            usdt: true,
            replier: true,
            operator: true,
            displayName: true,
            userId: true,
            messageId: true,
            createdAt: true,
          },
        })

        chat.current.dispatches = items.map((i) => ({
          amount: Number(i.amount || 0),
          usdt: Number(i.usdt || 0),
          createdAt: new Date(i.createdAt),
          replier: i.replier || '',
          operator: i.operator || '',
          displayName: i.displayName || null,
          userId: i.userId ? Number(i.userId) : null,
          messageId: i.messageId || null,
        }))
      }
      // 让后续的 formatSummary 认为需要重新同步一次（防止旧缓存影响）
      chat._billLastSync = 0
    } catch (e) {
      console.error('[撤销下发][sync-from-db-failed]', e)
      // 如果同步失败，至少从内存中移除最后一条
    if (chat.current.dispatches.length > 0) {
      chat.current.dispatches.pop()
      }
    }

    const message = replyToMessage 
      ? `✅ 已撤销指定的下发记录：${result.usdt}U`
      : `✅ 已撤销最后一条下发：${result.usdt}U`
    await ctx.reply(message, { ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 🔥 全部账单：总
 */
export function registerAllBill(bot, ensureChat) {
  bot.hears(/^总$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    const chatId = await ensureDbChat(ctx, chat)

    try {
      // 获取所有账单（包括OPEN和CLOSED）
      const allBills = await prisma.bill.findMany({
        where: { chatId },
        include: {
          items: {
            select: {
              type: true,
              amount: true,
              rate: true,
              usdt: true,
              feeRate: true,
              remark: true,
              replier: true,
              operator: true,
              createdAt: true
            },
            orderBy: { createdAt: 'asc' }
          }
        },
        orderBy: { openedAt: 'asc' }
      })

      if (allBills.length === 0) {
        return ctx.reply('暂无账单记录', { ...(await buildInlineKb(ctx)) })
      }

      // 汇总所有账单
      let totalIncome = 0
      let totalDispatch = 0
      let totalIncomeUSDT = 0
      let totalDispatchUSDT = 0
      const allIncomes = []
      const allDispatches = []

      for (const bill of allBills) {
        for (const item of bill.items) {
          const amount = Number(item.amount || 0)
          const usdt = Number(item.usdt || 0)

          if (item.type === 'INCOME') {
            totalIncome += amount
            totalIncomeUSDT += usdt
            allIncomes.push(item)
          } else {
            totalDispatch += amount
            totalDispatchUSDT += usdt
            allDispatches.push(item)
          }
        }
      }

      // 🔥 优化：合并查询，减少数据库访问
      const { getEffectiveRate } = await import('../helpers.js')
      const [settings, effectiveRate] = await Promise.all([
        prisma.setting.findUnique({
          where: { chatId },
          select: { feePercent: true }
        }),
        getEffectiveRate(chatId, chat).then(r => r ?? 0)
      ])

      const feePercent = settings?.feePercent ?? 0
      const rate = effectiveRate
      const fee = (totalIncome * feePercent) / 100
      const shouldDispatch = totalIncome - fee
      const shouldDispatchUSDT = rate ? Number((shouldDispatch / rate).toFixed(1)) : 0

      const lines = []
      lines.push('📊 *全部账单汇总*\n')
      lines.push(`入款（${allIncomes.length}笔）：${totalIncome.toFixed(2)} 元`)
      if (totalIncomeUSDT > 0) {
        lines.push(`入款USDT：${totalIncomeUSDT.toFixed(1)} U`)
      }
      lines.push(`下发（${allDispatches.length}笔）：${totalDispatch.toFixed(2)} 元`)
      if (totalDispatchUSDT > 0) {
        lines.push(`下发USDT：${totalDispatchUSDT.toFixed(1)} U`)
      }
      if (feePercent > 0) {
        lines.push(`手续费：${fee.toFixed(2)} 元（${feePercent}%）`)
      }
      lines.push(`应下发：${shouldDispatch.toFixed(2)} 元`)
      if (shouldDispatchUSDT > 0) {
        lines.push(`应下发USDT：${shouldDispatchUSDT.toFixed(1)} U`)
      }
      lines.push(`已下发：${totalDispatch.toFixed(2)} 元`)
      if (totalDispatchUSDT > 0) {
        lines.push(`已下发USDT：${totalDispatchUSDT.toFixed(1)} U`)
      }
      lines.push(`未下发：${(shouldDispatch - totalDispatch).toFixed(2)} 元`)
      if (shouldDispatchUSDT > 0) {
        lines.push(`未下发USDT：${(shouldDispatchUSDT - totalDispatchUSDT).toFixed(1)} U`)
      }

      await ctx.reply(lines.join('\n'), {
        ...(await buildInlineKb(ctx)),
        parse_mode: 'Markdown'
      })
    } catch (e) {
      console.error('查询全部账单失败', e)
      await ctx.reply('❌ 查询失败，请稍后重试')
    }
  })
}

/**
 * 指定账单（回复消息查看指定人的记录）
 */
export function registerUserBill(bot, ensureChat) {
  bot.hears(/^账单$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员、操作员或白名单用户可以操作。')
    }

    const replyToMessage = ctx.message.reply_to_message
    if (!replyToMessage || !replyToMessage.from) {
      return ctx.reply('❌ 请回复要查看账单的用户消息')
    }

    const targetUserId = replyToMessage.from.id
    const targetUsername = replyToMessage.from.username || replyToMessage.from.first_name || '未知用户'
    const chatId = await ensureDbChat(ctx, chat)

    try {
      // 获取今天的账单
      const { bill } = await getOrCreateTodayBill(chatId)
      if (!bill) {
        return ctx.reply('❌ 当前没有账单')
      }

      // 查询指定用户的账单项
      const items = await prisma.billItem.findMany({
        where: {
          billId: bill.id,
          userId: targetUserId.toString()
        },
        orderBy: { createdAt: 'desc' },
        take: 100, // 最多显示100条
        select: {
          type: true,
          amount: true,
          usdt: true,
          rate: true,
          replier: true,
          displayName: true,
          messageId: true,
          createdAt: true,
        },
      })

      if (items.length === 0) {
        return ctx.reply(`❌ 用户 @${targetUsername} 在当前账单中没有记录`)
      }

      const lines = []
      lines.push(`📋 @${targetUsername} 的账单记录（共 ${items.length} 条）：\n`)

      let totalIncome = 0
      let totalDispatch = 0

      items.forEach((item, index) => {
        const time = new Date(item.createdAt).toLocaleString('zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })

        if (item.type === 'INCOME') {
          const amount = Number(item.amount || 0)
          totalIncome += amount
          lines.push(`${index + 1}. ${time} +${amount}元 ${item.displayName || ''}`)
        } else if (item.type === 'DISPATCH') {
          const usdt = Number(item.usdt || 0)
          totalDispatch += usdt
          lines.push(`${index + 1}. ${time} 下发 ${usdt}U ${item.displayName || ''}`)
        }
      })

      lines.push(`\n📊 汇总：+${totalIncome}元，下发 ${totalDispatch}U`)

      await ctx.reply(lines.join('\n'), { ...(await buildInlineKb(ctx)) })
    } catch (e) {
      console.error('查询指定用户账单失败', e)
      await ctx.reply('❌ 查询账单失败，请稍后重试')
    }
  })
}

/**
 * 我的账单
 */
export function registerMyBill(bot, ensureChat) {
  bot.hears(/^(我的账单|\/我)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    const chatId = await ensureDbChat(ctx, chat)
    const userId = String(ctx.from?.id || '')
    const username = ctx.from?.username ? `@${ctx.from.username}` : null

    try {
      const { bill } = await getOrCreateTodayBill(chatId)

      const items = await prisma.billItem.findMany({
        where: {
          billId: bill.id,
          OR: [
            username ? { operator: username } : undefined,
            username ? { replier: username.replace('@', '') } : undefined,
            { operator: { contains: userId } },
            { replier: { contains: userId } }
          ].filter(Boolean)
        },
        orderBy: { createdAt: 'desc' },
        take: 50 // 限制查询数量，优化性能
      })

      if (items.length === 0) {
        return ctx.reply('❌ 您在本群暂无记账记录')
      }

      const lines = []
      lines.push(`📋 您的账单记录（共 ${items.length} 条）：\n`)

      let totalIncome = 0
      let totalDispatch = 0
      let totalUSDT = 0

      items.forEach(item => {
        const amount = Number(item.amount || 0)
        const usdt = Number(item.usdt || 0)
        const isIncome = item.type === 'INCOME'
        const remark = item.remark // 🔥 获取备注

        if (isIncome) {
          totalIncome += amount
          let line = ''
          if (item.rate) {
            line = `💰 +${amount} / ${item.rate}=${usdt.toFixed(1)}U`
          } else {
            line = `💰 +${amount}${usdt > 0 ? ` (${usdt.toFixed(1)}U)` : ''}`
          }
          // 🔥 如果有备注，在账单后面显示备注
          if (remark) {
            line += ` [${remark}]`
          }
          lines.push(line)
        } else {
          totalDispatch += amount
          totalUSDT += usdt
          lines.push(`📤 下发 ${usdt.toFixed(1)}U (${amount})`)
        }
      })

      // 🔥 计算总入款的USDT
      const { getEffectiveRate } = await import('../helpers.js')
      const effectiveRate = await getEffectiveRate(chatId, chat)
      const totalIncomeUSDT = effectiveRate ? (totalIncome / effectiveRate).toFixed(1) : '0'

      lines.push(`\n📊 汇总：`)
      lines.push(`入款：${totalIncome.toFixed(2)} (${totalIncomeUSDT}U)`) // 🔥 显示入款的U
      if (totalDispatch > 0 || totalUSDT > 0) {
        lines.push(`下发：${totalDispatch.toFixed(2)} (${totalUSDT.toFixed(1)}U)`)
      }

      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' })
    } catch (e) {
      console.error('查询我的账单失败', e)
      await ctx.reply('❌ 查询账单失败，请稍后重试')
    }
  })
}

