// 显示/记账/佣金 模式相关指令
import { prisma } from '../../lib/db.js'
import { hasPermissionWithWhitelist, buildInlineKb } from '../helpers.js'
import { ensureDbChat, updateSettings } from '../database.js'

export function registerDisplayMode(bot, ensureChat) {
  // 显示模式[1-6]
  bot.hears(/^显示模式[123456]$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    const m = ctx.message.text.match(/(\d)/)
    const mode = Number(m[1])
    chat.displayMode = mode
    const modeDesc = {
      1: '最近3笔',
      2: '最近5笔',
      3: '仅总计',
      4: '最近10笔',
      5: '最近20笔',
      6: '显示全部'
    }
    await ctx.reply(`显示模式已切换为 ${mode}（${modeDesc[mode] || '未知模式'}）`)
  })

  // 单显模式（兼容人民币模式）
  bot.hears(/^(单显模式|人民币模式)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    chat.rmbMode = true
    await ctx.reply('已切换为单显模式（仅显示当前币种）')
  })

  // 双显模式
  bot.hears(/^(双显模式|显示两列)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    chat.rmbMode = false
    await ctx.reply('已切换为双显模式（当前币种 | USDT）')
  })
}

export function registerAccountingModes(bot, ensureChat) {
  // 记账模式切换（累计/结转）
  bot.hears(/^(累计模式|结转模式)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    const chatId = await ensureDbChat(ctx)
    await updateSettings(chatId, { accountingMode: 'CARRY_OVER' })
    await ctx.reply('已切换为【累计模式】\n未下发金额将累计到次日，持续统计直到完全下发。')
  })

  // 单笔订单模式
  bot.hears(/^(单笔订单|单笔订单模式)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    const chatId = await ensureDbChat(ctx)
    await updateSettings(chatId, { accountingMode: 'SINGLE_BILL_PER_DAY' })
    await ctx.reply('已切换为【单笔订单模式】\n每天只有一笔订单，不支持保存账单，但支持删除账单。日切时会自动关闭昨天的账单。')
  })

  // 清零模式
  bot.hears(/^(清零模式|按日清零)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    const chatId = await ensureDbChat(ctx)
    await updateSettings(chatId, { accountingMode: 'DAILY_RESET' })
    await ctx.reply('已切换为【清零模式】\n每日账单独立计算，不结转历史未下发金额。')
  })

  // 设置记账模式 指令
  bot.hears(/^设置记账模式\s+(累计模式|清零模式|单笔订单)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    const chatId = await ensureDbChat(ctx)
    const mode = ctx.match[1]
    let accountingMode = 'DAILY_RESET'
    let modeName = '清零模式'
    let desc = '每日账单独立计算，不结转历史未下发金额。'

    if (mode === '累计模式') {
      accountingMode = 'CARRY_OVER'
      modeName = '累计模式'
      desc = '未下发金额将累计到次日，持续统计直到完全下发。'
    } else if (mode === '单笔订单') {
      accountingMode = 'SINGLE_BILL_PER_DAY'
      modeName = '单笔订单模式'
      desc = '每天只有一笔订单，不支持保存账单，但支持删除账单。日切时会自动关闭昨天的账单。'
    }

    await updateSettings(chatId, { accountingMode })
    await ctx.reply(`✅ 已切换为【${modeName}】\n${desc}`, { ...(await buildInlineKb(ctx)) })
  })

  // 查看记账模式
  bot.hears(/^查看记账模式$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    const chatId = await ensureDbChat(ctx)
    const settings = await prisma.setting.findUnique({ where: { chatId } })
    const mode = settings?.accountingMode || 'DAILY_RESET'
    let modeName = '清零模式（按日清零）'
    let desc = '当前模式：每日账单独立计算，不结转历史'

    if (mode === 'CARRY_OVER') {
      modeName = '累计模式（结转未下发）'
      desc = '当前模式：未下发金额会累计到次日继续统计'
    } else if (mode === 'SINGLE_BILL_PER_DAY') {
      modeName = '单笔订单模式'
      desc = '当前模式：每天只有一笔订单，不支持保存，但支持删除。日切时会自动关闭昨天的账单。'
    }

    await ctx.reply(`${modeName}\n${desc}`)
  })
}

export function registerCommissionMode(bot, ensureChat) {
  bot.hears(/^佣金\s*模式$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    chat.commissionMode = true
    await ensureDbChat(ctx)
    await ctx.reply('已开启佣金模式（在回复某人消息时输入 +N 或 -N 调整佣金）')
  })
}
