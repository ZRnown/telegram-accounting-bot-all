// 核心命令处理器（start, myid, help, dashboard等）
import { prisma } from '../../lib/db.js'
import { getChat } from '../state.js'
import { buildInlineKb } from '../helpers.js'

const BACKEND_URL = process.env.BACKEND_URL

/**
 * 注册 start 命令
 */
export function registerStart(bot, ensureChat) {
  bot.start(async (ctx) => {
    const userId = ctx.from?.id
    const username = ctx.from?.username ? `@${ctx.from.username}` : '无'
    const firstName = ctx.from?.first_name || ''
    const lastName = ctx.from?.last_name || ''
    const fullName = `${firstName} ${lastName}`.trim()

    if (ctx.chat?.type === 'private') {
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
        const { Markup } = await import('telegraf')
        const inlineKb = Markup.inlineKeyboard([
          [Markup.button.callback('📋 使用说明', 'help')]
        ])

        await ctx.reply(
          `👤 您的用户信息：\n\n` +
          `🆔 用户ID：\`${userId}\`\n` +
          `👤 用户名：${username}\n` +
          `📛 昵称：${fullName || '无'}\n\n` +
          `您不在白名单中，请联系管理员将您加入白名单。\n\n` +
          `💡 点击下方按钮获取使用说明：`,
          {
            parse_mode: 'Markdown',
            ...inlineKb
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
    '*💰 记账快捷指令*',
    '• 开始 / 开始记账 \\- 开启记账；停止 / 停止记账 \\- 暂停记账',
    '• \\+100 或 \\+100u \\- 入款（当前币种 / USDT）',
    '• \\+100/7\\.2 \\- 指定汇率入款；李四\\+10000 或 备注 \\+1000 \\- 带备注入款',
    '• 下发100 / 下发100u \\- 记录下发；下发\\-100 \\- 撤销下发金额',
    '• 显示账单 或 \\+0 \\- 查看当前账单；保存账单 / 删除账单 / 删除全部账单',
    '• 撤销入款 / 撤销下发 \\- 默认撤销最后一条，回复消息可撤销指定记录',
    '• 查看入款历史 / 查看下发历史 \\- 最近500条（展示50条）',
    '• 显示历史账单 \\- 最近已保存账单',
    '• 我的账单 / 指定账单 \\- 查看自己或回复目标的记录',
    '',
    '*👁️ 展示与模式*',
    '• 显示模式1\\~6 \\- 1:3笔 2:5笔 3:仅总计 4:10笔 5:20笔 6:全部',
    '• 单显模式 / 双显模式 \\- 仅当前币种 或 当前币种\\|USDT',
    '• 设置标题 xxx \\- 自定义账单标题',
    '',
    '*💱 汇率与费率*',
    '• 设置汇率 7\\.2 \\- 固定汇率；设置实时汇率 / 刷新实时汇率',
    '• 实时汇率每10分钟自动更新，与 z0 第一档保持一致',
    '• 设置货币 USD \\- 切换币种（支持 CNY/USD/EUR/JPY/GBP/AUD/CHF/CAD/NZD/TWD/KRW/HKD）',
    '• 设置费率 5 \\- 手续费5%；设置额度 10000 \\- 超押提醒',
    '• z0 \\- OKX 实时U价；z600u \\- 第三档汇率计算 600U；z600 \\- 第三档汇率计算 600元',
    '• lz / lw / lk \\- 支付宝 / 微信 / 银行卡 U价',
    '',
    '*🧮 计算器与表达式*',
    '• 288\\-32、288\\*2、288/2、288\\+21 \\- 数学表达式（需打开计算器）',
    '• \\+1000\\*0\\.95 \\- 单笔费率；\\+1000/7\\.2 \\- 单笔汇率；\\+1000/7\\*0\\.95 \\- 组合',
    '• 打开计算器 / 关闭计算器 \\- 控制表达式计算',
    '',
    '*📊 记账模式与日切*',
    '• 设置记账模式 累计模式 / 清零模式 / 单笔订单',
    '• 设置日切时间 2 \\- 设置凌晨2点日切（清零/单笔模式生效）',
    '• 查看记账模式 \\- 查看当前模式',
    '',
    '*👥 权限与管理*',
    '• 添加操作员 @AAA 或 回复消息添加操作员；添加操作员 @所有人 \\- 全员可记账',
    '• 删除操作员 @AAA 或 回复消息删除操作员',
    '• 显示操作人 / 管理员 / 权限人 \\- 查看权限',
    '• 开启所有功能 / 关闭所有功能；开启地址验证 / 关闭地址验证',
    '• 机器人退群 \\- 退出并清理数据',
    '💡 需禁用 Privacy Mode 或将机器人设为管理员',
    '',
    '*🚫 上下课与禁言*',
    '• 上课 / 开始上课 \\- 本群已开始营业',
    '• 下课 \\- 本群今日已下课\\n如需交易，请在该群恢复营业后在群内交易！ 切勿私下交易！',
    '• 解除禁言 / 开口 \\- 解除全体禁言；查询工时 \\- 查看累计上课时长',
    '',
    '*📢 后台与群发*',
    '• 后台登录后可管理群组、分组、群发：选择指定群或分组进行群发',
    '• 群列表 / 分组管理 在后台操作，支持创建/修改/删除分组并分配群',
    '',
    '*ℹ️ 其他*',
    '• 查询汇率 / 查询映射表 以及 查询汇率 7\\.2 \\- 查看点位映射',
    '• 添加/删除/查看自定义指令；设置自定义图片',
    '• 群列表 \\- 列出当前机器人所在的群',
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
      // 🔥 私聊和群聊都显示完整的使用说明（MarkdownV2格式）
      const help = getHelpText()
      const inlineKb = await buildInlineKb(ctx)
      await ctx.reply(help, { 
        parse_mode: 'MarkdownV2', 
        ...inlineKb 
      })
    } catch (e) {
      console.error('[help-action][reply-error]', e)
      // 如果 MarkdownV2 失败，尝试使用普通文本
      try {
    const help = getHelpText()
        // 移除 MarkdownV2 转义字符
        const plainHelp = help.replace(/\\([\\_*\[\]()~`>#+\-=|{}.!])/g, '$1')
        await ctx.reply(plainHelp, { 
          ...(await buildInlineKb(ctx))
        })
      } catch (e2) {
        console.error('[help-action][fallback-error]', e2)
        await ctx.reply('❌ 发送使用说明失败，请稍后重试').catch(() => {})
      }
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

    const help = getHelpText()
    await ctx.reply(help, { parse_mode: 'MarkdownV2', ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 注册 open_dashboard action
 */
export function registerDashboard(bot) {
  bot.action('open_dashboard', async (ctx) => {
    try { await ctx.answerCbQuery('已发送链接') } catch { }
    if (!BACKEND_URL) return ctx.reply('未配置后台地址。')
    const chatId = String(ctx.chat?.id || '')
    try {
      const u = new URL(BACKEND_URL)
      u.searchParams.set('chatId', chatId)
      await ctx.reply(`查看完整订单：\n${u.toString()}`)
    } catch {
      await ctx.reply(`查看完整订单：\n${BACKEND_URL}`)
    }
  })
}

/**
 * 注册查看账单命令（发送账单链接）
 */
export function registerViewBill(bot, ensureChat) {
  bot.hears(/^查看账单$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    if (!BACKEND_URL) {
      return ctx.reply('❌ 未配置后台地址')
    }

    const chatId = String(ctx.chat?.id || '')
    try {
      const u = new URL(BACKEND_URL)
      u.searchParams.set('chatId', chatId)
      await ctx.reply(
        `📊 查看完整账单：\n${u.toString()}`,
        { ...(await buildInlineKb(ctx)) }
      )
    } catch {
      await ctx.reply(
        `📊 查看完整账单：\n${BACKEND_URL}`,
        { ...(await buildInlineKb(ctx)) }
      )
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

