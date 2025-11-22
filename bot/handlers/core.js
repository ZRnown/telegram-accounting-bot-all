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
 * 获取机器人使用说明文本（统一函数，避免重复）
 */
function getHelpText() {
  return [
    '## 📖 机器人使用说明',
    '',
    '### 💰 基础记账',
    '- 开始 / 开始记账 - 激活机器人并开始记录',
    '- 停止 / 停止记账 - 暂停机器人记录（需管理员/操作员权限）',
    '- +720 - 记录人民币收入（720元）',
    '- +100u - 记录USDT收入（100U）',
    '- +720/7.2 - 指定汇率的人民币收入',
    '- 备注 +1000 - 备注入账（备注和金额之间必须有空格，如"备注 +1000"）',
    '- 李四+10000 - 备注入账（传统格式，在金额前加备注，如"李四+10000"）',
    '- -720 或 -100u - 撤销/负数记录',
    '- 下发10 - 下发10（当前币种）',
    '- 下发10u - 下发10USDT',
    '- 备注 下发1000 - 备注重下发（备注和金额之间必须有空格，如"备注 下发1000"）',
    '- 下发-10 - 撤销下发',
    '- 显示账单 或 +0 - 查看当前账单',
    '- 显示历史账单 - 查看已保存账单',
    '- 查看账单 - 查看完整账单（后台链接）',
    '- 使用说明 - 显示此使用说明',
    '- 保存账单 - 保存并清空当前',
    '- 删除账单 - 清空当前（不保存）',
    '- 删除全部账单 - 清除全部账单（请谨慎使用）',
    '- 我的账单 或 /我 - 查看自己的记账记录（含备注）',
    '- 指定账单 - 回复指定人消息，输入"账单"查看该人记录（含备注）',
    '',
    '### 🌐 货币与金额规则',
    '- 基准货币：USDT。所有汇率基于 USDT→当前币种',
    '- +100 表示当前币种金额；+100u / +100usdt 表示 USDT 金额',
    '- 切换币种后，如启用实时汇率，会自动刷新为新币种汇率',
    '',
    '### 🧮 数学计算与费率汇率',
    '- +3232+321 - 支持加法计算（结果+3553）',
    '- +100-20 - 支持减法计算（结果+80）',
    '- +1000*0.95 - 乘法表示费率（结果+950元，扣除5%）',
    '- +100/2 - 除法表示汇率（100元按汇率2计算，入账100元）',
    '- +100/7.2 - 指定汇率7.2',
    '- +1000/7*0.95 - 组合：汇率7和费率0.95',
    '- 288-32、288*2、288/2、288+21 - 支持数学计算（需打开计算器功能）',
    '- 打开计算器 - 启用数学计算功能',
    '- 关闭计算器 - 禁用数学计算功能',
    '- 注：*表示费率（0-1），/表示汇率（通常6-10），+-表示数学计算',
    '',
    '### 💱 汇率与费率',
    '- 设置汇率 7.2 或 设置汇率7.2 - 固定汇率（1U = 7.2元，支持有无空格）',
    '- 设置实时汇率 - 自动抓取市场汇率（每半小时更新）',
    '- 刷新实时汇率 - 手动更新实时汇率',
    '- 显示实时汇率 - 查看汇率',
    '- 显示货币 - 查看当前记账币种及符号',
    '- 设置货币 USD - 切换本群记账币种（支持：CNY, USD, EUR, JPY, GBP, AUD, CHF, CAD, NZD, TWD, KRW, HKD）',
    '- z0 - 查询OKX实时U价',
    '- 查询汇率 或 查询映射表 - 查看点位汇率映射关系',
    '- 查询汇率 7.2 - 自定义查询指定汇率的映射关系',
    '- 设置费率 5 - 手续费5%（可选）',
    '- 设置额度 10000 或 设置额度10000 - 设置超押提醒额度（支持有无空格）',
    '',
    '### 📊 记账模式',
    '- 设置记账模式 累计模式 - 未下发累计到次日',
    '- 设置记账模式 清零模式 - 每日独立（默认）',
    '- 设置记账模式 单笔订单 - 每天一笔订单',
    '- 查看记账模式 - 查看当前模式',
    '- 设置日切时间 2 - 设置为凌晨2点日切（累计模式不支持）',
    '',
    '### 📱 显示模式',
    '- 显示模式1 - 最近3笔（默认）',
    '- 显示模式2 - 最近5笔',
    '- 显示模式3 - 仅总计',
    '- 显示模式4 - 最近10笔 ⭐',
    '- 显示模式5 - 最近20笔 ⭐',
    '- 显示模式6 - 显示全部 ⭐',
    '- 单显模式 - 仅显示当前币种',
    '- 双显模式 - 当前币种 | USDT',
    '',
    '### 👥 权限管理',
    '添加操作员方式一：添加操作员 @AAA @BBB',
    '添加操作员方式二：回复指定人消息：添加操作员（对方无用户名）',
    '添加操作员方式三：添加操作员 @所有人（群内所有人都可以记账）',
    '删除操作员方式一：删除操作员 @AAA @BBB',
    '删除操作员方式二：回复指定人消息：删除操作员（对方无用户名）',
    '- 显示操作人 / 管理员 / 权限人 - 显示群组权限信息',
    '💡 需禁用Privacy Mode或设为管理员',
    '💡 管理员和操作人可记账！',
    '',
    '### 🔧 其他功能',
    '- 设置标题 xxx - 自定义账单标题',
    '- 撤销入款 - 撤销最近一条入款记录',
    '- 撤销下发 - 撤销最近一条下发记录',
    '- 删除 - 回复指定记录消息，输入"删除"可删除该记录',
    '- 佣金模式 - 佣金统计（高级）',
    '- 添加自定义指令 触发词 内容 - 新增/编辑自定义文本（示例：添加自定义指令 小十地址 这里是内容）',
    '- 设置自定义图片 触发词 图片URL - 为指令设置图片（示例：设置自定义图片 小十地址 https://.../img.png）',
    '- 删除自定义指令 触发词 - 删除自定义指令（示例：删除自定义指令 小十地址）',
    '- 自定义指令列表 - 查看所有自定义指令',
    '- 群列表 - 列出当前机器人所在的群',
    '',
    '### 🚫 禁言管理（需管理员权限）',
    '- 上课 / 开始上课 - 开始营业（机器人为管理员时有效）',
    '- 下课 - 停止营业（机器人为管理员时有效）',
    '- 解除禁言 / 开口 - 解除全体禁言',
    '- 查询工时 - 查询累计上课时长',
    '',
    '### 💰 U价查询',
    '- z0 - 查询OKX实时U价（所有支付方式）',
    '- lz - 查询OKX支付宝U价',
    '- lw - 查询OKX微信U价',
    '- lk - 查询OKX银行卡U价',
    '',
    '### ⚙️ 功能开关（管理员/白名单用户）',
    '- 开启所有功能 - 启用所有功能开关',
    '- 关闭所有功能 - 关闭所有功能开关',
    '- 开启地址验证 - 启用钱包地址验证功能',
    '- 关闭地址验证 - 关闭钱包地址验证功能',
    '- 打开计算器 - 启用数学计算功能（支持288-32、288*2等）',
    '- 关闭计算器 - 禁用数学计算功能',
    '- 机器人退群 - 机器人自动退群并删除所有权限和数据',
    '💡 适用于机器人只发送通告的群，与其他机器人互不打扰',
  ].join('\n')
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

    // 🔥 私聊和群聊都显示完整的使用说明
    const help = getHelpText()
    await ctx.reply(help, { parse_mode: 'Markdown', ...(await buildInlineKb(ctx)) })
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
    await ctx.reply(help, { ...(await buildInlineKb(ctx)) })
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
    try { await ctx.answerCbQuery() } catch { }

    // 只在私聊中处理
    if (ctx.chat?.type !== 'private') {
      return
    }

    // 🔥 发送完整的使用说明（与 help action 一致）
    const help = getHelpText()
    await ctx.reply(help, { ...(await buildInlineKb(ctx)) })
  })
}

