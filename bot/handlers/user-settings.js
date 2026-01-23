// 用户功能设置处理器
import { prisma } from '../../lib/db.js'
import { buildInlineKb, hasWhitelistOnlyPermission } from '../helpers.js'
import { setUserInputState, getUserInputState, clearUserInputState } from '../user-input-state.js'

/**
 * 注册功能设置相关的 action
 */
export function registerUserSettings(bot) {
  async function showSettingsMenu(ctx) {
    const { Markup } = await import('telegraf')

    const msg = `⚙️ *功能设置*\n\n请选择要设置的功能：`

    const inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📊 记账模式', 'settings_accounting_mode')],
      [Markup.button.callback('🔘 按钮显示', 'settings_button_display')],
      [Markup.button.callback('📞 客服文本', 'settings_support_contact')],
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
  }

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

    await showSettingsMenu(ctx)
  })

  // 记账模式设置（全局）
  bot.action('settings_accounting_mode', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[settings_accounting_mode][answerCbQuery]', e)
    }

    const { Markup } = await import('telegraf')

    // 获取当前全局记账模式
    let currentMode = 'DAILY_RESET'
    try {
      const config = await prisma.globalConfig.findUnique({
        where: { key: 'global_accounting_mode' }
      })
      if (config?.value) currentMode = config.value
    } catch {}

    const modeLabels = {
      'CARRY_OVER': '📈 累计模式',
      'DAILY_RESET': '🔄 清零模式',
      'SINGLE_BILL_PER_DAY': '📝 单笔订单'
    }

    const msg = `📊 *全局记账模式设置*\n\n` +
      `当前模式：${modeLabels[currentMode] || currentMode}\n\n` +
      `选择记账模式（设置后对所有群组生效）：\n\n` +
      `• *累计模式*：账单金额累计，不自动清零\n` +
      `• *清零模式*：每天自动清零账单\n` +
      `• *单笔订单*：每天只有一笔订单`

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

  // 设置累计模式（全局）
  bot.action('set_mode_carry_over', async (ctx) => {
    const userId = String(ctx.from?.id || '')
    try {
      await prisma.globalConfig.upsert({
        where: { key: 'global_accounting_mode' },
        create: { key: 'global_accounting_mode', value: 'CARRY_OVER', description: '全局记账模式', updatedBy: userId },
        update: { value: 'CARRY_OVER', updatedBy: userId }
      })
      await ctx.answerCbQuery('✅ 已设置为累计模式')
      await ctx.reply(`✅ 全局记账模式已设置为：*累计模式*\n\n账单金额将累计，不自动清零。\n\n此设置对所有群组生效。`, {
        parse_mode: 'Markdown'
      })
    } catch (e) {
      console.error('[set_mode_carry_over][error]', e)
      await ctx.answerCbQuery('❌ 设置失败')
    }
  })

  // 设置清零模式（全局）
  bot.action('set_mode_daily_reset', async (ctx) => {
    const userId = String(ctx.from?.id || '')
    try {
      await prisma.globalConfig.upsert({
        where: { key: 'global_accounting_mode' },
        create: { key: 'global_accounting_mode', value: 'DAILY_RESET', description: '全局记账模式', updatedBy: userId },
        update: { value: 'DAILY_RESET', updatedBy: userId }
      })
      await ctx.answerCbQuery('✅ 已设置为清零模式')
      await ctx.reply(`✅ 全局记账模式已设置为：*清零模式*\n\n每天自动清零账单。\n\n此设置对所有群组生效。`, {
        parse_mode: 'Markdown'
      })
    } catch (e) {
      console.error('[set_mode_daily_reset][error]', e)
      await ctx.answerCbQuery('❌ 设置失败')
    }
  })

  // 设置单笔订单模式（全局）
  bot.action('set_mode_single_bill', async (ctx) => {
    const userId = String(ctx.from?.id || '')
    try {
      await prisma.globalConfig.upsert({
        where: { key: 'global_accounting_mode' },
        create: { key: 'global_accounting_mode', value: 'SINGLE_BILL_PER_DAY', description: '全局记账模式', updatedBy: userId },
        update: { value: 'SINGLE_BILL_PER_DAY', updatedBy: userId }
      })
      await ctx.answerCbQuery('✅ 已设置为单笔订单')
      await ctx.reply(`✅ 全局记账模式已设置为：*单笔订单*\n\n每天只有一笔订单。\n\n此设置对所有群组生效。`, {
        parse_mode: 'Markdown'
      })
    } catch (e) {
      console.error('[set_mode_single_bill][error]', e)
      await ctx.answerCbQuery('❌ 设置失败')
    }
  })

  // 按钮显示设置（全局）
  bot.action('settings_button_display', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[settings_button_display][answerCbQuery]', e)
    }

    const { Markup } = await import('telegraf')

    // 获取当前全局按钮显示设置
    let hideHelp = false
    let hideOrder = false
    try {
      const [helpConfig, orderConfig] = await Promise.all([
        prisma.globalConfig.findUnique({ where: { key: 'global_hide_help_button' } }),
        prisma.globalConfig.findUnique({ where: { key: 'global_hide_order_button' } })
      ])
      hideHelp = helpConfig?.value === 'true'
      hideOrder = orderConfig?.value === 'true'
    } catch {}

    const msg = `🔘 *全局按钮显示设置*\n\n` +
      `控制所有群组中显示的按钮：\n\n` +
      `• 使用说明按钮：${hideHelp ? '🚫 已隐藏' : '✅ 显示中'}\n` +
      `• 查看订单按钮：${hideOrder ? '🚫 已隐藏' : '✅ 显示中'}`

    const inlineKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(hideHelp ? '✅ 显示使用说明' : '🚫 隐藏使用说明', 'btn_toggle_help')
      ],
      [
        Markup.button.callback(hideOrder ? '✅ 显示查看订单' : '🚫 隐藏查看订单', 'btn_toggle_order')
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

  // 设置联系客服文本
  bot.action('settings_support_contact', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[settings_support_contact][answerCbQuery]', e)
    }

    // 只在私聊中处理
    if (ctx.chat?.type !== 'private') {
      return
    }

    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) {
      return ctx.reply('⚠️ 您不在白名单中，无法设置客服文本')
    }

    const userId = String(ctx.from?.id || '')
    setUserInputState(userId, 'support_contact')

    const { Markup } = await import('telegraf')
    const inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('❌ 取消', 'settings_support_contact_cancel')]
    ])

    await ctx.reply('📞 *设置联系客服文本*\n\n请发送要展示的客服信息文本：', {
      parse_mode: 'Markdown',
      ...inlineKeyboard
    })
  })

  // 取消设置客服文本
  bot.action('settings_support_contact_cancel', async (ctx) => {
    const userId = String(ctx.from?.id || '')
    clearUserInputState(userId, 'support_contact')

    try {
      await ctx.answerCbQuery('已取消')
    } catch (e) {
      console.error('[settings_support_contact_cancel][answerCbQuery]', e)
    }

    await showSettingsMenu(ctx)
  })

  // 切换使用说明按钮显示（全局）
  bot.action('btn_toggle_help', async (ctx) => {
    const userId = String(ctx.from?.id || '')
    try {
      // 获取当前状态
      const config = await prisma.globalConfig.findUnique({
        where: { key: 'global_hide_help_button' }
      })
      const currentHide = config?.value === 'true'
      const newValue = currentHide ? 'false' : 'true'

      await prisma.globalConfig.upsert({
        where: { key: 'global_hide_help_button' },
        create: { key: 'global_hide_help_button', value: newValue, description: '全局隐藏使用说明按钮', updatedBy: userId },
        update: { value: newValue, updatedBy: userId }
      })

      await ctx.answerCbQuery(newValue === 'true' ? '✅ 已隐藏使用说明按钮' : '✅ 已显示使用说明按钮')

      // 刷新按钮显示设置菜单
      const { Markup } = await import('telegraf')
      const [helpConfig, orderConfig] = await Promise.all([
        prisma.globalConfig.findUnique({ where: { key: 'global_hide_help_button' } }),
        prisma.globalConfig.findUnique({ where: { key: 'global_hide_order_button' } })
      ])
      const hideHelp = helpConfig?.value === 'true'
      const hideOrder = orderConfig?.value === 'true'

      const msg = `🔘 *全局按钮显示设置*\n\n` +
        `控制所有群组中显示的按钮：\n\n` +
        `• 使用说明按钮：${hideHelp ? '🚫 已隐藏' : '✅ 显示中'}\n` +
        `• 查看订单按钮：${hideOrder ? '🚫 已隐藏' : '✅ 显示中'}`

      const inlineKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback(hideHelp ? '✅ 显示使用说明' : '🚫 隐藏使用说明', 'btn_toggle_help')],
        [Markup.button.callback(hideOrder ? '✅ 显示查看订单' : '🚫 隐藏查看订单', 'btn_toggle_order')],
        [Markup.button.callback('🔙 返回设置', 'user_settings')]
      ])

      await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...inlineKeyboard })
    } catch (e) {
      console.error('[btn_toggle_help][error]', e)
      await ctx.answerCbQuery('❌ 设置失败')
    }
  })

  // 切换查看订单按钮显示（全局）
  bot.action('btn_toggle_order', async (ctx) => {
    const userId = String(ctx.from?.id || '')
    try {
      // 获取当前状态
      const config = await prisma.globalConfig.findUnique({
        where: { key: 'global_hide_order_button' }
      })
      const currentHide = config?.value === 'true'
      const newValue = currentHide ? 'false' : 'true'

      await prisma.globalConfig.upsert({
        where: { key: 'global_hide_order_button' },
        create: { key: 'global_hide_order_button', value: newValue, description: '全局隐藏查看订单按钮', updatedBy: userId },
        update: { value: newValue, updatedBy: userId }
      })

      await ctx.answerCbQuery(newValue === 'true' ? '✅ 已隐藏查看订单按钮' : '✅ 已显示查看订单按钮')

      // 刷新按钮显示设置菜单
      const { Markup } = await import('telegraf')
      const [helpConfig, orderConfig] = await Promise.all([
        prisma.globalConfig.findUnique({ where: { key: 'global_hide_help_button' } }),
        prisma.globalConfig.findUnique({ where: { key: 'global_hide_order_button' } })
      ])
      const hideHelp = helpConfig?.value === 'true'
      const hideOrder = orderConfig?.value === 'true'

      const msg = `🔘 *全局按钮显示设置*\n\n` +
        `控制所有群组中显示的按钮：\n\n` +
        `• 使用说明按钮：${hideHelp ? '🚫 已隐藏' : '✅ 显示中'}\n` +
        `• 查看订单按钮：${hideOrder ? '🚫 已隐藏' : '✅ 显示中'}`

      const inlineKeyboard = Markup.inlineKeyboard([
        [Markup.button.callback(hideHelp ? '✅ 显示使用说明' : '🚫 隐藏使用说明', 'btn_toggle_help')],
        [Markup.button.callback(hideOrder ? '✅ 显示查看订单' : '🚫 隐藏查看订单', 'btn_toggle_order')],
        [Markup.button.callback('🔙 返回设置', 'user_settings')]
      ])

      await ctx.editMessageText(msg, { parse_mode: 'Markdown', ...inlineKeyboard })
    } catch (e) {
      console.error('[btn_toggle_order][error]', e)
      await ctx.answerCbQuery('❌ 设置失败')
    }
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

  // 处理客服文本输入
  bot.on('text', async (ctx, next) => {
    const userId = String(ctx.from?.id || '')
    const state = getUserInputState(userId)
    if (!state) return next()

    if (ctx.chat?.type !== 'private') {
      return next()
    }

    if (state.action !== 'support_contact') {
      return next()
    }

    clearUserInputState(userId, 'support_contact')

    const content = ctx.message.text?.trim() || ''
    if (!content) {
      return ctx.reply('❌ 客服文本不能为空')
    }

    try {
      await prisma.globalConfig.upsert({
        where: { key: 'support_contact' },
        create: { key: 'support_contact', value: content, description: '客服联系方式', updatedBy: userId },
        update: { value: content, updatedAt: new Date(), updatedBy: userId }
      })

      await ctx.reply('✅ 客服文本已更新')
      await showSettingsMenu(ctx)
    } catch (e) {
      console.error('[support_contact][save-error]', e)
      await ctx.reply('❌ 保存失败，请稍后重试')
    }
  })
}
