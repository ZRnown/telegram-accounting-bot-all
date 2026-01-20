// 用户功能设置处理器
import { prisma } from '../../lib/db.js'
import { buildInlineKb, hasWhitelistOnlyPermission } from '../helpers.js'

/**
 * 注册功能设置相关的 action
 */
export function registerUserSettings(bot) {
  // 主菜单：功能设置
  bot.action('user_settings', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[user_settings][answerCbQuery]', e)
    }

    // 只在私聊中处理
    if (ctx.chat?.type !== 'private') {
      return
    }

    // 检查白名单权限
    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) {
      return ctx.reply('⚠️ 您不在白名单中，无法使用功能设置')
    }

    const { Markup } = await import('telegraf')

    const msg = `⚙️ *功能设置*\n\n请选择要设置的功能：`

    const inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📊 记账模式', 'settings_accounting_mode')],
      [Markup.button.callback('🔘 按钮显示', 'settings_button_display')],
      [Markup.button.callback('🔙 返回主菜单', 'back_to_main')]
    ])

    try {
      await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...inlineKeyboard
      })
    } catch (e) {
      console.error('[user_settings][error]', e)
      await ctx.reply('❌ 打开功能设置失败，请稍后重试').catch(() => {})
    }
  })

  // 记账模式设置
  bot.action('settings_accounting_mode', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[settings_accounting_mode][answerCbQuery]', e)
    }

    const { Markup } = await import('telegraf')

    const msg = `📊 *记账模式设置*\n\n` +
      `选择记账模式：\n\n` +
      `• **累计模式**：账单金额累计，不自动清零\n` +
      `• **清零模式**：每天自动清零账单\n` +
      `• **单笔订单**：每天只有一笔订单`

    const inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📈 累计模式', 'set_mode_carry_over')],
      [Markup.button.callback('🔄 清零模式', 'set_mode_daily_reset')],
      [Markup.button.callback('📝 单笔订单', 'set_mode_single_bill')],
      [Markup.button.callback('🔙 返回设置', 'user_settings')]
    ])

    try {
      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...inlineKeyboard
      })
    } catch (e) {
      console.error('[settings_accounting_mode][error]', e)
      await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...inlineKeyboard
      }).catch(() => {})
    }
  })

  // 设置累计模式
  bot.action('set_mode_carry_over', async (ctx) => {
    try {
      await ctx.answerCbQuery('✅ 已设置为累计模式')
    } catch (e) {
      console.error('[set_mode_carry_over][answerCbQuery]', e)
    }

    await ctx.reply(`✅ 记账模式已设置为：**累计模式**\n\n账单金额将累计，不自动清零。\n\n注意：此设置需要在群组中使用"设置记账模式 累计模式"命令来应用。`, {
      parse_mode: 'Markdown'
    })
  })

  // 设置清零模式
  bot.action('set_mode_daily_reset', async (ctx) => {
    try {
      await ctx.answerCbQuery('✅ 已设置为清零模式')
    } catch (e) {
      console.error('[set_mode_daily_reset][answerCbQuery]', e)
    }

    await ctx.reply(`✅ 记账模式已设置为：**清零模式**\n\n每天自动清零账单。\n\n注意：此设置需要在群组中使用"设置记账模式 清零模式"命令来应用。`, {
      parse_mode: 'Markdown'
    })
  })

  // 设置单笔订单模式
  bot.action('set_mode_single_bill', async (ctx) => {
    try {
      await ctx.answerCbQuery('✅ 已设置为单笔订单')
    } catch (e) {
      console.error('[set_mode_single_bill][answerCbQuery]', e)
    }

    await ctx.reply(`✅ 记账模式已设置为：**单笔订单**\n\n每天只有一笔订单。\n\n注意：此设置需要在群组中使用"设置记账模式 单笔订单"命令来应用。`, {
      parse_mode: 'Markdown'
    })
  })

  // 按钮显示设置
  bot.action('settings_button_display', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[settings_button_display][answerCbQuery]', e)
    }

    const { Markup } = await import('telegraf')

    const msg = `🔘 *按钮显示设置*\n\n` +
      `控制群组中显示的按钮：\n\n` +
      `• 使用说明按钮\n` +
      `• 查看订单按钮`

    const inlineKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📋 显示使用说明', 'btn_show_help'),
        Markup.button.callback('🚫 隐藏使用说明', 'btn_hide_help')
      ],
      [
        Markup.button.callback('📊 显示查看订单', 'btn_show_order'),
        Markup.button.callback('🚫 隐藏查看订单', 'btn_hide_order')
      ],
      [Markup.button.callback('🔙 返回设置', 'user_settings')]
    ])

    try {
      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...inlineKeyboard
      })
    } catch (e) {
      console.error('[settings_button_display][error]', e)
      await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...inlineKeyboard
      }).catch(() => {})
    }
  })

  // 显示使用说明按钮
  bot.action('btn_show_help', async (ctx) => {
    try {
      await ctx.answerCbQuery('ℹ️ 请在群组中使用此设置')
    } catch (e) {
      console.error('[btn_show_help][answerCbQuery]', e)
    }

    await ctx.reply(`ℹ️ 要显示使用说明按钮，请在对应群组中发送：\n\n\`显示使用说明按钮\``, {
      parse_mode: 'Markdown'
    })
  })

  // 隐藏使用说明按钮
  bot.action('btn_hide_help', async (ctx) => {
    try {
      await ctx.answerCbQuery('ℹ️ 请在群组中使用此设置')
    } catch (e) {
      console.error('[btn_hide_help][answerCbQuery]', e)
    }

    await ctx.reply(`ℹ️ 要隐藏使用说明按钮，请在对应群组中发送：\n\n\`隐藏使用说明按钮\``, {
      parse_mode: 'Markdown'
    })
  })

  // 显示查看订单按钮
  bot.action('btn_show_order', async (ctx) => {
    try {
      await ctx.answerCbQuery('ℹ️ 请在群组中使用此设置')
    } catch (e) {
      console.error('[btn_show_order][answerCbQuery]', e)
    }

    await ctx.reply(`ℹ️ 要显示查看订单按钮，请在对应群组中发送：\n\n\`显示订单按钮\``, {
      parse_mode: 'Markdown'
    })
  })

  // 隐藏查看订单按钮
  bot.action('btn_hide_order', async (ctx) => {
    try {
      await ctx.answerCbQuery('ℹ️ 请在群组中使用此设置')
    } catch (e) {
      console.error('[btn_hide_order][answerCbQuery]', e)
    }

    await ctx.reply(`ℹ️ 要隐藏查看订单按钮，请在对应群组中发送：\n\n\`隐藏订单按钮\``, {
      parse_mode: 'Markdown'
    })
  })

  // 返回主菜单
  bot.action('back_to_main', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[back_to_main][answerCbQuery]', e)
    }

    const userId = ctx.from?.id
    const username = ctx.from?.username ? `@${ctx.from.username}` : '无'
    const firstName = ctx.from?.first_name || ''
    const lastName = ctx.from?.last_name || ''
    const fullName = `${firstName} ${lastName}`.trim() || '无'

    try {
      const inlineKb = await buildInlineKb(ctx)
      await ctx.reply(
        `👤 欢迎使用记账机器人！\n\n` +
        `🆔 用户ID：\`${userId}\`\n` +
        `👤 用户名：${username}\n` +
        `📛 昵称：${fullName}\n\n` +
        `💡 点击下方按钮开始使用：`,
        {
          parse_mode: 'Markdown',
          ...inlineKb
        }
      )
    } catch (e) {
      console.error('[back_to_main][error]', e)
      await ctx.reply('❌ 返回主菜单失败，请发送 /start').catch(() => {})
    }
  })
}
