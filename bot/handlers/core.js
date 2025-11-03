// 核心命令处理器（start, myid, help, dashboard等）
import { prisma } from '../../lib/db.ts'
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
        // 🔥 非白名单用户：显示详细提示信息
        await ctx.reply(
          `👤 您的用户信息：\n\n` +
          `🆔 用户ID：\`${userId}\`\n` +
          `👤 用户名：${username}\n` +
          `📛 昵称：${fullName || '无'}\n\n` +
          `💡 将上面的用户ID提供给管理员，添加到白名单后，您邀请机器人进群将自动授权。\n\n` +
          `⚠️ 使用提示：\n` +
          `本机器人仅支持在群组中使用记账功能。\n` +
          `如需使用，请：\n` +
          `1. 将机器人添加到群组\n` +
          `2. 联系管理员将您的ID添加到白名单\n` +
          `3. 点击下方按钮查看使用说明`,
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
    const help = [
      ' 📖 机器人使用说明 ',
      '',
      '【💰 基础记账】',
      '• 开始记账 - 初始化群组记账',
      '• +720 - 记录人民币收入（720元）',
      '• +100u - 记录USDT收入（100U）',
      '• +720/7.2 - 指定汇率的人民币收入',
      '• -720 或 -100u - 撤销/负数记录',
      '• 下发10 - 下发10人民币',
      '• 下发10u - 下发10USDT',
      '• 下发-10 - 撤销下发',
      '• 显示账单 或 +0 - 查看当前账单',
      '• 显示历史账单 - 查看已保存账单',
      '• 保存账单 - 保存并清空当前',
      '• 删除账单 - 清空当前（不保存）',
      '• 删除全部账单 - 清除全部账单（请谨慎使用）',
      '• 我的账单 或 /我 - 查看自己的记账记录',
      '• 指定账单 - 回复指定人消息，输入"账单"查看该人记录',
      '',
      '【🧮 数学计算】',
      '• +100-20 - 记账时支持数学表达式（结果+80）',
      '• +1000*0.95 - 支持乘法（结果+950）',
      '• +100/2 - 支持除法（结果+50）',
      '• 288-38 - 纯计算，机器人回复"288-38=250"',
      '• 注：记账时+11/21表示除法，+100/7.2表示汇率',
      '',
      '【💱 汇率与费率】',
      '• 设置汇率 7.2 - 固定汇率（1U = 7.2元）',
      '• 设置实时汇率 - 自动抓取市场汇率（每小时更新）',
      '• 刷新实时汇率 - 手动更新实时汇率',
      '• 显示实时汇率 - 查看汇率',
      '• z0 - 查询OKX实时U价',
      '• 查询汇率 或 查询映射表 - 查看点位汇率映射关系',
      '• 查询汇率 7.2 - 自定义查询指定汇率的映射关系',
      '• 设置费率 5 - 手续费5%（可选）',
      '',
      '【📊 记账模式】',
      '• 累计模式 - 未下发累计到次日',
      '• 清零模式 - 每日独立（默认）',
      '• 查看记账模式 - 查看当前模式',
      '',
      '【📱 显示模式】',
      '• 显示模式1 - 最近3笔（默认）',
      '• 显示模式2 - 最近5笔',
      '• 显示模式3 - 仅总计',
      '• 显示模式4 - 最近10笔 ⭐',
      '• 显示模式5 - 最近20笔 ⭐',
      '• 显示模式6 - 显示全部 ⭐',
      '• 人民币模式 - 仅显示RMB',
      '• 双显模式 - RMB | USDT',
      '',
      '【👥 权限管理】',
      '添加操作员方式一：添加操作员 @AAA @BBB',
      '添加操作员方式二：回复指定人消息：添加操作员（对方无用户名）',
      '添加操作员方式三：添加操作员 @所有人（群内所有人都可以记账）',
      '删除操作员方式一：删除操作员 @AAA @BBB',
      '删除操作员方式二：回复指定人消息：删除操作员（对方无用户名）',
      '• 显示操作人 / 管理员 / 权限人 - 显示群组权限信息',
      '💡 需禁用Privacy Mode或设为管理员',
      '💡 管理员和操作人可记账！',
      '',
      '【🔧 其他功能】',
      '• 设置标题 xxx - 自定义账单标题',
      '• 撤销入款 - 撤销最近一条入款记录',
      '• 撤销下发 - 撤销最近一条下发记录',
      '• 删除 - 回复指定记录消息，输入"删除"可删除该记录',
      '• 佣金模式 - 佣金统计（高级）',
      '• 上课/下课 - 禁言管理（需管理员）',
      '',
      '【⚙️ 功能开关】（管理员/白名单用户）',
      '• 开启所有功能 - 启用所有功能开关',
      '• 关闭所有功能 - 关闭所有功能开关',
      '• 开启地址验证 - 启用钱包地址验证功能',
      '• 关闭地址验证 - 关闭钱包地址验证功能',
      '• 设置额度 10000 - 设置超押提醒额度（设置为0则关闭）',
      '• 机器人退群 - 机器人自动退群并删除所有权限和数据',
      '💡 适用于机器人只发送通告的群，与其他机器人互不打扰',
      '',
      '【💡 使用示例】',
      '场景：客户充100U，做单扣10U',
      '1️⃣ 设置汇率 7.2',
      '2️⃣ +100u（记录充值100U）',
      '3️⃣ 下发10u（扣10U）',
      '4️⃣ 显示账单（查看剩余90U）',
      '5️⃣ 保存账单（当天结束保存）',
      '',
      '【⚙️ 常用设置】',
      '• 显示模式4 - 推荐设置！',
      '• 设置汇率 7.2 - 设置你的汇率',
      '• 设置操作人 @xxx - 添加员工权限',
    ].join('\n')
    await ctx.reply(help, { ...(await buildInlineKb(ctx)) })
  })
}

/**
 * 注册 open_dashboard action
 */
export function registerDashboard(bot) {
  bot.action('open_dashboard', async (ctx) => {
    try { await ctx.answerCbQuery('已发送链接') } catch {}
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
 * 注册 start_accounting action（私聊时"开始记账"按钮回调）
 */
export function registerStartAccountingAction(bot) {
  bot.action('start_accounting', async (ctx) => {
    try { await ctx.answerCbQuery() } catch {}
    
    // 只在私聊中处理
    if (ctx.chat?.type !== 'private') {
      return ctx.reply('此功能仅在私聊中使用')
    }
    
    const userId = String(ctx.from?.id || '')
    
    // 🔥 检查是否在白名单
    const whitelistedUser = await prisma.whitelistedUser.findUnique({
      where: { userId }
    })
    
    if (!whitelistedUser) {
      // 非白名单用户：显示提示信息
      const username = ctx.from?.username ? `@${ctx.from.username}` : '无'
      const firstName = ctx.from?.first_name || ''
      const lastName = ctx.from?.last_name || ''
      const fullName = `${firstName} ${lastName}`.trim()
      
      return await ctx.reply(
        `👤 您的用户信息：\n\n` +
        `🆔 用户ID：\`${userId}\`\n` +
        `👤 用户名：${username}\n` +
        `📛 昵称：${fullName || '无'}\n\n` +
        `💡 将上面的用户ID提供给管理员，添加到白名单后，您邀请机器人进群将自动授权。`,
        { parse_mode: 'Markdown' }
      )
    }
    
    // 🔥 白名单用户：使用 Markup 创建邀请按钮
    try {
      const { Markup } = await import('telegraf')
      
      // 获取机器人用户名
      const me = await ctx.telegram.getMe()
      const botUsername = me?.username
      
      if (!botUsername) {
        return await ctx.reply('❌ 无法获取机器人信息，请联系管理员')
      }
      
      // 构建带管理员权限请求的邀请链接（请求删除消息和限制成员权限）
      const inviteLinkWithAdmin = `https://t.me/${botUsername}?startgroup=true&admin=can_delete_messages+can_restrict_members`
      
      // 创建管理员邀请按钮
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.url('➕ 添加为管理员', inviteLinkWithAdmin)
        ]
      ])
      
      await ctx.reply(
        '点击下方按钮将机器人添加到群组：\n\n' +
        '⚠️ 需要您有管理员权限才能添加机器人为管理员',
        { 
          ...keyboard,
          parse_mode: 'Markdown'
        }
      )
    } catch (e) {
      console.error('创建邀请链接失败', e)
      await ctx.reply('❌ 无法创建邀请链接，请联系管理员')
    }
  })
}

