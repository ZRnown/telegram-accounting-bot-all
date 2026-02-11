// 核心命令处理器（start, myid, help, dashboard等）
import { prisma } from '../../lib/db.js'
import { getChat } from '../state.js'
import { buildInlineKb, buildBotDeepLink, hasWhitelistOnlyPermission } from '../helpers.js'

const BACKEND_URL = process.env.BACKEND_URL

function buildDashboardUrl(chatId) {
  if (!BACKEND_URL) return null
  try {
    const u = new URL(BACKEND_URL)
    if (chatId) {
      u.searchParams.set('chatId', chatId)
    }
    return u.toString()
  } catch {
    return BACKEND_URL
  }
}

function splitText(text, maxLen = 3500) {
  if (!text) return []
  const lines = text.split('\n')
  const chunks = []
  let buf = ''

  for (const line of lines) {
    if (!buf) {
      if (line.length > maxLen) {
        for (let i = 0; i < line.length; i += maxLen) {
          chunks.push(line.slice(i, i + maxLen))
        }
      } else {
        buf = line
      }
      continue
    }

    if (buf.length + 1 + line.length > maxLen) {
      chunks.push(buf)
      if (line.length > maxLen) {
        for (let i = 0; i < line.length; i += maxLen) {
          chunks.push(line.slice(i, i + maxLen))
        }
        buf = ''
      } else {
        buf = line
      }
    } else {
      buf += `\n${line}`
    }
  }

  if (buf) chunks.push(buf)
  return chunks
}

async function sendHelpMessage(ctx) {
  const help = getHelpText()
  let inlineKb = null

  try {
    inlineKb = await buildInlineKb(ctx)
  } catch (e) {
    console.error('[help][keyboard-error]', e)
  }

  try {
    await ctx.reply(help, { parse_mode: 'MarkdownV2', ...(inlineKb || {}) })
    return
  } catch (e) {
    console.error('[help][reply-error]', e)
  }

  const plainHelp = help.replace(/\\([\\_*\[\]()~`>#+\-=|{}.!])/g, '$1')
  const chunks = splitText(plainHelp)
  for (let i = 0; i < chunks.length; i += 1) {
    const extra = i === 0 && inlineKb ? inlineKb : {}
    await ctx.reply(chunks[i], { ...extra }).catch((e) => {
      console.error('[help][fallback-error]', e)
    })
  }
}

/**
 * 注册 start 命令
 */
export function registerStart(bot, ensureChat) {
  bot.start(async (ctx) => {
    const startPayload = ctx.startPayload || ''
    const userId = ctx.from?.id
    const username = ctx.from?.username ? `@${ctx.from.username}` : '无'
    const firstName = ctx.from?.first_name || ''
    const lastName = ctx.from?.last_name || ''
    const fullName = `${firstName} ${lastName}`.trim()

    if (ctx.chat?.type === 'private') {
      if (startPayload === 'help') {
        await sendHelpMessage(ctx)
        return
      }
      // 🔥 私聊：检查是否在白名单，显示不同的提示信息
      const userIdStr = String(userId || '')
      const whitelistedUser = await prisma.whitelistedUser.findUnique({
        where: { userId: userIdStr }
      })

      if (whitelistedUser) {
        // 🔥 白名单用户：显示简要信息，提供内联菜单
        await ctx.reply(
          `👤 您的用户信息：\n\n` +
          `🆔 用户ID：\`${userId}\`\n` +
          `👤 用户名：${username}\n` +
          `📛 昵称：${fullName || '无'}\n\n` +
          `✅ 您已在白名单中，可以邀请机器人进群自动授权。\n\n` +
          `💡 点击下方按钮开始使用：`,
          {
            parse_mode: 'Markdown',
            ...(await buildInlineKb(ctx))
          }
        )
      } else {
        // 🔥 非白名单用户：显示详细提示信息（只显示使用说明按钮）
        await ctx.reply(
          `👤 您的用户信息：\n\n` +
          `🆔 用户ID：\`${userId}\`\n` +
          `👤 用户名：${username}\n` +
          `📛 昵称：${fullName || '无'}\n\n` +
          `您不在白名单中，请联系管理员将您加入白名单。\n\n` +
          `💡 点击下方按钮获取使用说明或开始记账：`,
          {
            parse_mode: 'Markdown',
            ...(await buildInlineKb(ctx))
          }
        )
      }
    } else {
      // 群聊：初始化记账
      const chat = ensureChat(ctx)
      if (!chat) return
      await ctx.reply(
        `开始记账，使用 +金额 / -金额 记录入款，使用 "下发金额" 记录下发。输入 "显示账单" 查看汇总。\n\n` +
        `👤 您的ID：\`${userId}\` 用户名：${username}`,
        { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' }
      )
    }
  })
}

// 🔥 /myid 命令已删除，只保留中文指令

/**
 * 获取机器人使用说明文本（MarkdownV2 格式）
 */
function getHelpText() {
  const content = [
    '*📖 机器人使用说明*',
    '',
    '*💰 记账功能*',
    '• 开始记账 / 停止记账 \\- 开启/暂停记账',
    '• \\+720 \\- 记录人民币收入（720元）',
    '• \\+100u \\- 记录USDT收入（100U）',
    '• \\+720/7\\.2 \\- 指定汇率的人民币收入',
    '• 备注 \\+1000 \\- 备注入账（备注和金额之间必须有空格）',
    '• 李四\\+10000 \\- 备注入账（传统格式，在金额前加备注）',
    '• \\-720 或 \\-100u \\- 撤销/负数记录',
    '• 下发10 \\- 下发10（当前币种）',
    '• 下发10u \\- 下发10USDT',
    '• 备注 下发1000 \\- 备注重下发（备注和金额之间必须有空格）',
    '• 下发\\-10 \\- 撤销下发',
    '• 显示账单 或 \\+0 \\- 查看当前账单',
    '• 显示历史账单 \\- 查看已保存账单',
    '• 查看账单 \\- 查看完整账单（点击按钮打开）',
    '• 保存账单 \\- 保存并清空当前',
    '• 删除账单 \\- 清空当前（不保存）',
    '• 删除全部账单 \\- 清除全部账单（请谨慎使用）',
    '• 我的账单 或 /我 \\- 查看自己的记账记录（含备注）',
    '• 指定账单 \\- 回复指定人消息，输入"账单"查看该人记录（含备注）',
    '',
    '*⚙️ 设置功能*',
    '• 显示模式1\\-6 \\- 设置显示笔数',
    '• 单显模式 / 双显模式 \\- 单/双币种显示',
    '• 设置汇率 7\\.2 \\- 固定汇率；设置实时汇率 \\- 实时汇率',
    '• 设置货币 USD \\- 切换币种',
    '• 设置费率 5 \\- 手续费率',
    '• 设置标题 xxx \\- 自定义标题',
    '• 设置记账模式 累计模式/清零模式/单笔订单',
    '• 设置日切时间 2 \\- 日切时间',
    '',
    '*👥 权限管理*',
    '• 添加操作员 @用户 \\- 添加操作员',
    '• 回复用户消息发送“添加操作员” \\- 快速添加操作员',
    '• 删除操作员 @用户 \\- 删除操作员',
    '• 显示操作人 \\- 查看权限',
    '• 开启/关闭所有功能 \\- 功能开关',
    '• 开启/关闭地址验证 \\- 地址验证',
    '',
    '*🧮 计算器*',
    '• 288\\*2、288/2 等 \\- 数学表达式',
    '• 打开/关闭计算器 \\- 计算器开关',
    '',
    '*📊 营业管理*',
    '• 上课 / 开始上课 \\- 开始营业',
    '• 下课 \\- 结束营业并禁言',
    '• 解除禁言 / 开口 \\- 解除禁言',
    '• 查询工时 \\- 查看营业时长',
    '',
    '*📢 广播功能*',
    '• 全员广播 \\- 向所有群组广播',
    '• 分组广播 分组名 \\- 向指定分组广播',
    '• 分组管理 \\- 管理分组和群组',
    '• 分组列表 \\- 查看所有分组',
    '',
    '*🔍 查询功能*',
    '• z0 \\- OKX实时U价；z600u \\- 计算600U',
    '• lz/lw/lk \\- 支付宝/微信/银行卡U价',
    '• 查 T开头的地址 \\- 查询TRON地址',
    '• 查 18888888888 \\- 查询手机号归属地',
    '• 查 20000000000000000 \\- 查询银行卡信息（含开户地区）',
    '• 查询汇率 \\- 查看汇率映射',
    '',
    '*🔧 其他功能*',
    '• 添加自定义指令 \\- 自定义命令',
    '• 设置自定义图片 \\- 自定义图片',
    '• 群列表 \\- 查看所在群组',
    '• 机器人退群 \\- 退出群组',
    '',
    '*❓ 帮助*',
    '• 使用说明 或 /help \\- 显示此帮助',
    '• /start \\- 开始使用',
    '',
  ]

  return content.join('\n')
}

/**
 * 注册 help action
 */
export function registerHelp(bot) {
  bot.action('help', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[help-action][answerCbQuery-error]', e)
    }

    try {
      if (ctx.chat?.type !== 'private') {
        const helpLink = await buildBotDeepLink(ctx, 'help')
        if (!helpLink) {
          return ctx.reply('请私聊机器人查看使用说明')
        }
        const { Markup } = await import('telegraf')
        const inlineKeyboard = Markup.inlineKeyboard([
          [Markup.button.url('私聊查看使用说明', helpLink)]
        ])
        return ctx.reply('请点击下方按钮私聊查看使用说明：', {
          ...inlineKeyboard
        })
      }
      // 🔥 私聊显示完整使用说明（MarkdownV2格式）
      await sendHelpMessage(ctx)
    } catch (e) {
      console.error('[help-action][reply-error]', e)
      await ctx.reply('❌ 发送使用说明失败，请稍后重试').catch(() => {})
    }
  })
}

/**
 * 注册使用说明命令
 */
export function registerHelpCommand(bot, ensureChat) {
  bot.hears(/^使用说明$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (ctx.chat?.type !== 'private') {
      const helpLink = await buildBotDeepLink(ctx, 'help')
      if (!helpLink) {
        return ctx.reply('请私聊机器人查看使用说明')
      }
      const { Markup } = await import('telegraf')
      const inlineKeyboard = Markup.inlineKeyboard([
        [Markup.button.url('私聊查看使用说明', helpLink)]
      ])
      return ctx.reply('请点击下方按钮私聊查看使用说明：', {
        ...inlineKeyboard
      })
    }

    await sendHelpMessage(ctx)
  })
}

/**
 * 注册 open_dashboard action
 */
export function registerDashboard(bot) {
  bot.action('open_dashboard', async (ctx) => {
    const chatId = String(ctx.chat?.id || '')
    const url = buildDashboardUrl(chatId)
    if (!url) return ctx.reply('未配置后台地址。')

    try {
      await ctx.answerCbQuery({ url })
      return
    } catch {
      try { await ctx.answerCbQuery() } catch { }
    }

    try {
      const { Markup } = await import('telegraf')
      const inlineKeyboard = Markup.inlineKeyboard([
        [Markup.button.url('查看完整订单', url)]
      ])
      await ctx.reply('📊 点击下方按钮查看完整账单：', {
        ...inlineKeyboard
      })
    } catch (e) {
      await ctx.reply(`查看完整订单：\n${url}`)
    }
  })
}

/**
 * 注册查看账单命令（发送账单按钮）
 */
export function registerViewBill(bot, ensureChat) {
  bot.hears(/^查看账单$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    const chatId = String(ctx.chat?.id || '')
    const url = buildDashboardUrl(chatId)
    if (!url) {
      return ctx.reply('❌ 未配置后台地址')
    }

    try {
      const { Markup } = await import('telegraf')
      const inlineKeyboard = Markup.inlineKeyboard([
        [Markup.button.url('查看完整订单', url)]
      ])
      await ctx.reply(
        '📊 点击下方按钮查看完整账单：',
        { ...inlineKeyboard }
      )
    } catch {
      await ctx.reply(`查看完整订单：\n${url}`)
    }
  })
}

/**
 * 注册 command_menu action（私聊时"指令菜单"按钮回调）
 */
export function registerCommandMenuAction(bot) {
  bot.action('command_menu', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[command_menu][answerCbQuery]', e)
    }

    // 只在私聊中处理
    if (ctx.chat?.type !== 'private') {
      return
    }

    try {
      // 🔥 发送完整的使用说明（与 help action 一致，MarkdownV2格式）
      const help = getHelpText()
      const inlineKb = await buildInlineKb(ctx)
      await ctx.reply(help, {
        parse_mode: 'MarkdownV2',
        ...inlineKb
      })
    } catch (e) {
      console.error('[command_menu][reply-error]', e)
      // 如果 MarkdownV2 失败，尝试使用普通文本
      try {
    const help = getHelpText()
        // 移除 MarkdownV2 转义字符
        const plainHelp = help.replace(/\\([\\_*\[\]()~`>#+\-=|{}.!])/g, '$1')
        await ctx.reply(plainHelp, {
          ...(await buildInlineKb(ctx))
        })
      } catch (e2) {
        console.error('[command_menu][fallback-error]', e2)
        await ctx.reply('❌ 发送使用说明失败，请稍后重试').catch(() => {})
      }
    }
  })
}

/**
 * 注册个人中心 action
 */
export function registerPersonalCenter(bot) {
  bot.action('personal_center', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[personal_center][answerCbQuery]', e)
    }

    // 只在私聊中处理
    if (ctx.chat?.type !== 'private') {
      return
    }

    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) {
      return ctx.reply('⚠️ 您不在白名单中，无法查看个人中心')
    }

    const userId = ctx.from?.id
    const username = ctx.from?.username ? `@${ctx.from.username}` : '无'
    const firstName = ctx.from?.first_name || ''
    const lastName = ctx.from?.last_name || ''
    const fullName = `${firstName} ${lastName}`.trim() || '无'

    try {
      let msg = `👤 *您的用户信息：*\n\n`
      msg += `🆔 用户ID：\`${userId}\`\n`
      msg += `👤 用户名：${username}\n`
      msg += `📛 昵称：${fullName}\n\n`
      msg += `✅ 您已在白名单中，可以邀请机器人进群自动授权`

      const inlineKb = await buildInlineKb(ctx)
      await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...inlineKb
      })
    } catch (e) {
      console.error('[personal_center][error]', e)
      await ctx.reply('❌ 获取个人信息失败，请稍后重试').catch(() => {})
    }
  })
}

/**
 * 注册联系客服 action
 */
export function registerContactSupport(bot) {
  bot.action('contact_support', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[contact_support][answerCbQuery]', e)
    }

    // 只在私聊中处理
    if (ctx.chat?.type !== 'private') {
      return
    }

    try {
      // 从 GlobalConfig 读取客服联系方式
      const config = await prisma.globalConfig.findUnique({
        where: { key: 'support_contact' }
      })

      let msg = `📞 *联系客服*\n\n`
      if (config?.value) {
        msg += config.value
      } else {
        msg += `暂未设置客服联系方式\n\n请联系管理员配置客服信息`
      }

      const inlineKb = await buildInlineKb(ctx)
      await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...inlineKb
      })
    } catch (e) {
      console.error('[contact_support][error]', e)
      await ctx.reply('❌ 获取客服信息失败，请稍后重试').catch(() => {})
    }
  })
}
