// 管理员相关命令处理器
import { prisma } from '../../lib/db.ts'
import { ensureDbChat } from '../database.js'
import { buildInlineKb, isAdmin } from '../helpers.js'
import { setGlobalDailyCutoffHour } from '../utils.js'

/**
 * 机器人退群
 */
export function registerBotLeave(bot) {
  bot.hears(/^机器人退群$/i, async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('此命令仅在群组中使用')
    }
    
    const isAdminUser = await isAdmin(ctx)
    if (!isAdminUser) {
      const userId = String(ctx.from?.id || '')
      const whitelistedUser = await prisma.whitelistedUser.findUnique({ where: { userId } })
      if (!whitelistedUser) {
        return ctx.reply('⚠️ 您没有权限。只有管理员或白名单用户可以执行此操作。')
      }
    }
    
    const chatId = String(ctx.chat?.id || '')
    
    try {
      // 并行删除所有相关数据
      await Promise.all([
        prisma.chatFeatureFlag.deleteMany({ where: { chatId } }),
        prisma.setting.deleteMany({ where: { chatId } }),
        prisma.operator.deleteMany({ where: { chatId } }),
        prisma.addressVerification.deleteMany({ where: { chatId } }),
        prisma.featureWarningLog.deleteMany({ where: { chatId } })
      ])
      
      await prisma.chat.delete({ where: { id: chatId } }).catch(() => {})
      await ctx.leaveChat()
      console.log('[机器人退群]', { chatId })
    } catch (e) {
      console.error('[机器人退群]', e)
      try {
        await ctx.leaveChat()
      } catch {}
    }
  })
}

/**
 * 查询汇率/映射表
 */
export function registerQueryRate(bot, ensureChat) {
  bot.hears(/^(查询汇率|查询映射表)(?:\s+(.+))?$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    
    const query = ctx.match[2]?.trim() || ''
    const chatId = await ensureDbChat(ctx, chat)
    
    try {
      const setting = await prisma.setting.findUnique({
        where: { chatId },
        select: { fixedRate: true, realtimeRate: true, feePercent: true }
      })
      
      let rateText = ''
      if (query) {
        const rate = parseFloat(query)
        if (!isNaN(rate) && rate > 0) {
          rateText = `查询汇率 ${rate} 的映射关系：\n` +
            `• 1 USDT = ${rate} CNY\n` +
            `• 1 CNY = ${(1 / rate).toFixed(6)} USDT\n` +
            `• 100 CNY = ${(100 / rate).toFixed(2)} USDT\n` +
            `• 100 USDT = ${(100 * rate).toFixed(2)} CNY`
        } else {
          rateText = `❌ 无效的汇率值：${query}`
        }
      } else {
        const fixedRate = setting?.fixedRate
        const realtimeRate = setting?.realtimeRate
        const feePercent = setting?.feePercent || 0
        
        rateText = ' 💱 汇率映射表 \n\n'
        
        if (fixedRate) {
          rateText += `【固定汇率】\n` +
            `• 1 USDT = ${fixedRate} CNY\n` +
            `• 1 CNY = ${(1 / fixedRate).toFixed(6)} USDT\n` +
            `• 100 CNY = ${(100 / fixedRate).toFixed(2)} USDT\n` +
            `• 100 USDT = ${(100 * fixedRate).toFixed(2)} CNY\n\n`
        } else if (realtimeRate) {
          rateText += `【实时汇率】\n` +
            `• 1 USDT = ${realtimeRate} CNY\n` +
            `• 1 CNY = ${(1 / realtimeRate).toFixed(6)} USDT\n` +
            `• 100 CNY = ${(100 / realtimeRate).toFixed(2)} USDT\n` +
            `• 100 USDT = ${(100 * realtimeRate).toFixed(2)} CNY\n\n`
        } else {
          rateText += `⚠️ 未设置汇率\n\n`
        }
        
        if (feePercent > 0) {
          rateText += `【费率】${feePercent}%\n`
        }
        
        rateText += `\n💡 提示：使用"查询汇率 7.2"可以查询指定汇率的映射关系`
      }
      
      await ctx.reply(rateText, { ...(await buildInlineKb(ctx)) })
    } catch (e) {
      console.error('[查询汇率]', e)
      await ctx.reply('❌ 查询失败，请稍后重试')
    }
  })
}

/**
 * 群内管理员信息
 */
export function registerAdminInfo(bot) {
  bot.hears(/^(管理员|权限人|显示操作员)$/i, async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('此命令仅在群组中使用')
    }
    
    const chatId = await ensureDbChat(ctx)
    
    try {
      const [admins, operators, setting] = await Promise.all([
        ctx.getChatAdministrators(),
        prisma.operator.findMany({ where: { chatId }, select: { username: true } }),
        prisma.setting.findUnique({ where: { chatId }, select: { everyoneAllowed: true } })
      ])
      
      const adminList = admins
        .filter(a => !a.user.is_bot)
        .map(a => {
          const name = a.user.username 
            ? `@${a.user.username}` 
            : `${a.user.first_name || ''} ${a.user.last_name || ''}`.trim() || `用户${a.user.id}`
          const status = a.status === 'creator' ? '👑 群主' : '👤 管理员'
          return `• ${name} (${status})`
        })
      
      let text = ' 👥 群组权限信息 \n\n'
      
      if (adminList.length > 0) {
        text += `【👑 群主/管理员】\n${adminList.join('\n')}\n\n`
      }
      
      if (setting?.everyoneAllowed) {
        text += `【✅ 权限设置】\n• 所有人可操作\n\n`
      } else if (operators.length > 0) {
        text += `【👤 操作员】\n${operators.map(op => `• ${op.username}`).join('\n')}\n\n`
      } else {
        text += `【👤 操作员】\n• 仅管理员可操作\n\n`
      }
      
      await ctx.reply(text, { ...(await buildInlineKb(ctx)) })
    } catch (e) {
      console.error('[群内管理员]', e)
      await ctx.reply('❌ 获取信息失败，请稍后重试')
    }
  })
}

