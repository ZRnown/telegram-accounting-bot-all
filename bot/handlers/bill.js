// 账单相关命令处理器
import { prisma } from '../../lib/db.ts'
import { getChat } from '../state.js'
import { ensureDbChat, getOrCreateTodayBill, deleteLastIncome, deleteLastDispatch } from '../database.js'
import { buildInlineKb, hasOperatorPermission } from '../helpers.js'
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
    
    if (!(await hasOperatorPermission(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员或已添加的操作人可以操作。')
    }
    
    const chatId = await ensureDbChat(ctx, chat)
    
    try {
      const { bill } = await getOrCreateTodayBill(chatId)
      await prisma.bill.update({
        where: { id: bill.id },
        data: { status: 'CLOSED', closedAt: new Date() }
      })
      
      // 清空内存
      chat.history.push({
        savedAt: new Date(),
        data: {
          incomes: [...chat.current.incomes],
          dispatches: [...chat.current.dispatches]
        }
      })
      chat.current.incomes = []
      chat.current.dispatches = []
      
      await ctx.reply('✅ 账单已保存并清空', { ...(await buildInlineKb(ctx)) })
    } catch (e) {
      console.error('保存账单失败', e)
      await ctx.reply('❌ 保存账单失败，请稍后重试')
    }
  })
}

/**
 * 删除账单（清空当前，不保存）
 */
export function registerDeleteBill(bot, ensureChat) {
  bot.hears(/^删除账单$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    if (!(await hasOperatorPermission(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员或已添加的操作人可以操作。')
    }
    
    const chatId = await ensureDbChat(ctx, chat)
    
    try {
      const { bill } = await getOrCreateTodayBill(chatId)
      await prisma.billItem.deleteMany({ where: { billId: bill.id } })
      
      chat.current.incomes = []
      chat.current.dispatches = []
      
      await ctx.reply('✅ 当前账单已清空', { ...(await buildInlineKb(ctx)) })
    } catch (e) {
      console.error('删除账单失败', e)
      await ctx.reply('❌ 删除账单失败，请稍后重试')
    }
  })
}

/**
 * 删除全部账单
 */
export function registerDeleteAllBills(bot, ensureChat) {
  bot.hears(/^(删除全部账单|清除全部账单)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    if (!(await hasOperatorPermission(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员或已添加的操作人可以操作。')
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
 * 撤销入款
 */
export function registerUndoIncome(bot, ensureChat) {
  bot.hears(/^撤销入款$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    if (!(await hasOperatorPermission(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员或已添加的操作人可以操作。')
    }
    
    const chatId = await ensureDbChat(ctx, chat)
    const result = await deleteLastIncome(chatId)
    
    if (!result) {
      return ctx.reply('❌ 没有可撤销的入款记录')
    }
    
    // 从内存中移除最后一条
    if (chat.current.incomes.length > 0) {
      chat.current.incomes.pop()
    }
    
    await ctx.reply(`✅ 已撤销最后一条入款：${result.amount}`, { ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 撤销下发
 */
export function registerUndoDispatch(bot, ensureChat) {
  bot.hears(/^撤销下发$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    if (!(await hasOperatorPermission(ctx, chat))) {
      return ctx.reply('⚠️ 您没有记账权限。只有管理员或已添加的操作人可以操作。')
    }
    
    const chatId = await ensureDbChat(ctx, chat)
    const result = await deleteLastDispatch(chatId)
    
    if (!result) {
      return ctx.reply('❌ 没有可撤销的下发记录')
    }
    
    // 从内存中移除最后一条
    if (chat.current.dispatches.length > 0) {
      chat.current.dispatches.pop()
    }
    
    await ctx.reply(`✅ 已撤销最后一条下发：${result.usdt}U`, { ...(await buildInlineKb(ctx)) })
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
        
        if (isIncome) {
          totalIncome += amount
          if (item.rate) {
            lines.push(`💰 +${amount} / ${item.rate}=${usdt.toFixed(1)}U`)
          } else {
            lines.push(`💰 +${amount}${usdt > 0 ? ` (${usdt.toFixed(1)}U)` : ''}`)
          }
        } else {
          totalDispatch += amount
          totalUSDT += usdt
          lines.push(`📤 下发 ${usdt.toFixed(1)}U (${amount})`)
        }
      })
      
      lines.push(`\n📊 汇总：`)
      lines.push(`入款：${totalIncome.toFixed(2)}`)
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

