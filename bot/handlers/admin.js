// 管理员相关命令处理器
import { prisma } from '../../lib/db.js'
import { ensureDbChat } from '../database.js'
import { buildInlineKb, isAdmin, hasPermissionWithWhitelist, getEffectiveRate, getDisplayCurrencySymbol } from '../helpers.js'
import { setGlobalDailyCutoffHour } from '../utils.js'
import { getChat } from '../state.js'

/**
 * 机器人退群
 */
export function registerBotLeave(bot) {
  bot.hears(/^机器人退群$/i, async (ctx) => {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('此命令仅在群组中使用')
    }

    // 🔥 优化：使用统一的权限检查
    const chat = getChat(process.env.BOT_TOKEN, String(ctx.chat?.id || ''))
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员或白名单用户可以执行此操作。')
    }

    const chatId = String(ctx.chat?.id || '')

    try {
      // 并行删除所有相关数据
      await Promise.all([
        prisma.chatFeatureFlag.deleteMany({ where: { chatId } }),
        prisma.setting.deleteMany({ where: { chatId } }),
        prisma.operator.deleteMany({ where: { chatId } }),
        prisma.addressVerification.deleteMany({ where: { chatId } }),
        prisma.featureWarningLog.deleteMany({ where: { chatId } }),
        prisma.bill.deleteMany({ where: { chatId } }),
        prisma.income.deleteMany({ where: { chatId } }),
        prisma.dispatch.deleteMany({ where: { chatId } }),
        prisma.commission.deleteMany({ where: { chatId } })
      ])

      await prisma.chat.delete({ where: { id: chatId } }).catch(() => { })
      await ctx.leaveChat()
      console.log('[机器人退群]', { chatId })
    } catch (e) {
      console.error('[机器人退群]', e)
      try {
        await ctx.leaveChat()
      } catch { }
    }
  })
}

/**
 * 群列表：列出当前机器人所在的群
 */
export function registerListGroups(bot) {
  bot.hears(/^群列表$/i, async (ctx) => {
    // 仅在私聊或群内管理员/操作员可用
    try {
      const isPrivate = ctx.chat?.type === 'private'
      if (!isPrivate) {
        // 在群聊中，要求有权限
        const chat = getChat(process.env.BOT_TOKEN, String(ctx.chat?.id || ''))
        const hasPermission = await isAdmin(ctx) || (chat ? await hasOperatorPermission(ctx, chat) : false)
        if (!hasPermission) {
          return ctx.reply('⚠️ 您没有权限。只有管理员或操作员可以执行此操作。')
        }
      }

      // 查询已允许运行的群
      const chats = await prisma.chat.findMany({
        where: { allowed: true },
        select: { id: true, title: true, status: true },
        orderBy: [{ title: 'asc' }]
      })

      if (!chats || chats.length === 0) {
        return ctx.reply('当前机器人尚未加入任何已授权的群。')
      }

      // 限制输出长度，最多显示前 50 个（仅展示群名称）
      const list = chats.slice(0, 50).map(c => `• ${c.title || '(无标题)'}`)
      let text = ' 📜 群列表（前50）\n\n' + list.join('\n')
      if (chats.length > 50) text += `\n\n... 以及其他 ${chats.length - 50} 个群`
      await ctx.reply(text)
    } catch (e) {
      console.error('[群列表] 失败', e)
      await ctx.reply('❌ 查询失败，请稍后重试')
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
      // 🔥 优化：使用统一的汇率获取函数
      const [setting, effectiveRate] = await Promise.all([
        prisma.setting.findUnique({
          where: { chatId },
          select: { feePercent: true }
        }),
        getEffectiveRate(chatId, ensureChat(ctx))
      ])

      let rateText = ''
      if (query) {
        const rate = parseFloat(query)
        if (!isNaN(rate) && rate > 0) {
          const code = (ensureChat(ctx)?.currencyCode || 'cny')
          const sym = getDisplayCurrencySymbol(code)
          rateText = `查询汇率 ${rate.toFixed(2)} 的映射关系：\n` +
            `• 1 USDT = ${rate.toFixed(2)} ${sym}\n` +
            `• 1 ${code.toUpperCase()} = ${(1 / rate).toFixed(6)} USDT\n` +
            `• 100 ${code.toUpperCase()} = ${(100 / rate).toFixed(2)} USDT\n` +
            `• 100 USDT = ${(100 * rate).toFixed(2)} ${sym}`
        } else {
          rateText = `❌ 无效的汇率值：${query}`
        }
      } else {
        const chat = ensureChat(ctx)
        const fixedRate = chat?.fixedRate ?? null
        const realtimeRate = chat?.realtimeRate ?? null
        const feePercent = setting?.feePercent || 0
        const displayRate = effectiveRate ?? null
        const code = (chat?.currencyCode || 'cny')
        const sym = getDisplayCurrencySymbol(code)
        rateText = ' 💱 汇率映射表 \n\n'

        if (fixedRate && displayRate) {
          rateText += `【固定汇率】\n` +
            `• 1 USDT = ${Number(displayRate).toFixed(2)} ${sym}\n` +
            `• 1 ${code.toUpperCase()} = ${(1 / displayRate).toFixed(6)} USDT\n` +
            `• 100 ${code.toUpperCase()} = ${(100 / displayRate).toFixed(2)} USDT\n` +
            `• 100 USDT = ${(100 * displayRate).toFixed(2)} ${sym}\n\n`
        } else if (realtimeRate && displayRate) {
          rateText += `【实时汇率】\n` +
            `• 1 USDT = ${Number(displayRate).toFixed(2)} ${sym}\n` +
            `• 1 ${code.toUpperCase()} = ${(1 / displayRate).toFixed(6)} USDT\n` +
            `• 100 ${code.toUpperCase()} = ${(100 / displayRate).toFixed(2)} USDT\n` +
            `• 100 USDT = ${(100 * displayRate).toFixed(2)} ${sym}\n\n`
        } else if (displayRate) {
          rateText += `【当前汇率】\n` +
            `• 1 USDT = ${Number(displayRate).toFixed(2)} ${sym}\n` +
            `• 1 ${code.toUpperCase()} = ${(1 / displayRate).toFixed(6)} USDT\n` +
            `• 100 ${code.toUpperCase()} = ${(100 / displayRate).toFixed(2)} USDT\n` +
            `• 100 USDT = ${(100 * displayRate).toFixed(2)} ${sym}\n\n`
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
 * 群内管理员信息（显示所有管理员和操作员）
 */
export function registerAdminInfo(bot) {
  bot.hears(/^(管理员|权限人|显示操作员|显示操作人)$/i, async (ctx) => {
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

      // 🔥 分类：群主、管理员、操作员
      const creators = []
      const adminsList = []
      const operatorUsernames = new Set(operators.map(op => op.username))

      admins
        .filter(a => !a.user.is_bot)
        .forEach(a => {
          const name = a.user.username
            ? `@${a.user.username}`
            : `${a.user.first_name || ''} ${a.user.last_name || ''}`.trim() || `用户${a.user.id}`
          const status = a.status === 'creator' ? '👑 群主' : '👤 管理员'
          const item = { name, status, isCreator: a.status === 'creator' }

          if (a.status === 'creator') {
            creators.push(item)
          } else {
            adminsList.push(item)
          }
        })

      // 🔥 过滤出非群主和管理员的操作员
      const otherOperators = operators
        .filter(op => {
          const username = op.username.startsWith('@') ? op.username : `@${op.username}`
          return !creators.some(c => c.name === username) &&
            !adminsList.some(a => a.name === username)
        })
        .map(op => op.username)

      let text = ' 👥 群组权限信息 \n\n'

      // 🔥 群主最上面
      if (creators.length > 0) {
        text += `【👑 群主】\n${creators.map(c => `• ${c.name}`).join('\n')}\n\n`
      }

      // 🔥 然后管理员
      if (adminsList.length > 0) {
        text += `【👤 管理员】\n${adminsList.map(a => `• ${a.name}`).join('\n')}\n\n`
      }

      // 🔥 然后其他操作员
      if (setting?.everyoneAllowed) {
        text += `【✅ 权限设置】\n• 所有人可操作\n\n`
      } else if (otherOperators.length > 0) {
        text += `【👤 操作员】\n${otherOperators.map(op => `• @${op}`).join('\n')}\n\n`
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

