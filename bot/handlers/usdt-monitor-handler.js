// USDT监听用户交互处理器
import { prisma } from '../../lib/db.js'
import { buildInlineKb, hasWhitelistOnlyPermission } from '../helpers.js'
import { addMonitor, removeMonitor, getUserMonitors, setTransferCallback, loadAllMonitors } from '../usdt-monitor.js'

// 存储用户的输入状态
const userInputStates = new Map()

/**
 * 注册USDT监听相关的 action
 */
export function registerUsdtMonitorHandler(bot) {
  // 设置转账通知回调
  setTransferCallback(async (userId, transfer) => {
    try {
      const directionText = transfer.direction === 'in' ? '收到' : '发出'
      const directionEmoji = transfer.direction === 'in' ? '📥' : '📤'
      const counterpart = transfer.direction === 'in' ? transfer.from : transfer.to

      const msg = `${directionEmoji} *USDT转账通知*\n\n` +
        `💰 ${directionText} **${transfer.amount.toFixed(2)} USDT**\n\n` +
        `📍 监听地址：\n\`${transfer.address}\`\n\n` +
        `${transfer.direction === 'in' ? '📤 发送方' : '📥 接收方'}：\n\`${counterpart}\`\n\n` +
        `🕐 时间：${transfer.timestamp.toLocaleString('zh-CN')}\n\n` +
        `🔗 交易ID：\n\`${transfer.txid}\``

      await bot.telegram.sendMessage(userId, msg, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    } catch (e) {
      console.error('[USDT Monitor] 发送通知失败:', e.message)
    }
  })

  // 主菜单：USDT监听
  bot.action('usdt_monitor', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[usdt_monitor][answerCbQuery]', e)
    }

    // 只在私聊中处理
    if (ctx.chat?.type !== 'private') {
      return
    }

    // 检查白名单权限
    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) {
      return ctx.reply('⚠️ 您不在白名单中，无法使用USDT监听功能')
    }

    await showMonitorMenu(ctx)
  })

  // 显示监听菜单
  async function showMonitorMenu(ctx) {
    const { Markup } = await import('telegraf')
    const userId = String(ctx.from?.id || '')

    // 获取用户的监听地址
    const monitors = await getUserMonitors(userId)

    let msg = `💰 *USDT监听管理*\n\n`

    if (monitors.length === 0) {
      msg += `📝 您还没有添加任何监听地址\n\n`
      msg += `点击下方按钮添加监听地址，当该地址有USDT转账时，机器人会自动通知您。`
    } else {
      msg += `📋 *已监听的地址：*\n\n`
      monitors.forEach((m, i) => {
        const status = m.enabled ? '✅' : '⏸️'
        const shortAddr = `${m.address.substring(0, 8)}...${m.address.substring(m.address.length - 6)}`
        msg += `${i + 1}. ${status} \`${shortAddr}\`\n`
      })
      msg += `\n共 ${monitors.length} 个监听地址`
    }

    const buttons = [
      [Markup.button.callback('➕ 添加监听地址', 'usdt_add_address')],
    ]

    if (monitors.length > 0) {
      buttons.push([Markup.button.callback('➖ 删除监听地址', 'usdt_remove_address')])
      buttons.push([Markup.button.callback('📋 查看完整地址', 'usdt_view_addresses')])
    }

    buttons.push([Markup.button.callback('🔙 返回主菜单', 'back_to_main')])

    const inlineKeyboard = Markup.inlineKeyboard(buttons)

    try {
      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        ...inlineKeyboard
      })
    } catch (e) {
      // 如果编辑失败，发送新消息
      await ctx.reply(msg, {
        parse_mode: 'Markdown',
        ...inlineKeyboard
      }).catch(() => {})
    }
  }

  // 添加监听地址
  bot.action('usdt_add_address', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[usdt_add_address][answerCbQuery]', e)
    }

    const userId = String(ctx.from?.id || '')

    // 设置用户输入状态
    userInputStates.set(userId, {
      action: 'add_address',
      timestamp: Date.now()
    })

    const { Markup } = await import('telegraf')
    const inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('❌ 取消', 'usdt_cancel_input')]
    ])

    await ctx.reply(`📝 *添加监听地址*\n\n请发送要监听的TRC20地址（以T开头，34位字符）：`, {
      parse_mode: 'Markdown',
      ...inlineKeyboard
    })
  })

  // 删除监听地址
  bot.action('usdt_remove_address', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[usdt_remove_address][answerCbQuery]', e)
    }

    const { Markup } = await import('telegraf')
    const userId = String(ctx.from?.id || '')

    const monitors = await getUserMonitors(userId)

    if (monitors.length === 0) {
      return ctx.reply('📝 您还没有添加任何监听地址')
    }

    const buttons = monitors.map((m, i) => {
      const shortAddr = `${m.address.substring(0, 6)}...${m.address.substring(m.address.length - 4)}`
      return [Markup.button.callback(`🗑️ ${shortAddr}`, `usdt_delete_${m.id}`)]
    })

    buttons.push([Markup.button.callback('🔙 返回', 'usdt_monitor')])

    const inlineKeyboard = Markup.inlineKeyboard(buttons)

    await ctx.editMessageText(`🗑️ *选择要删除的地址：*`, {
      parse_mode: 'Markdown',
      ...inlineKeyboard
    })
  })

  // 查看完整地址
  bot.action('usdt_view_addresses', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[usdt_view_addresses][answerCbQuery]', e)
    }

    const userId = String(ctx.from?.id || '')
    const monitors = await getUserMonitors(userId)

    if (monitors.length === 0) {
      return ctx.reply('📝 您还没有添加任何监听地址')
    }

    let msg = `📋 *监听地址列表：*\n\n`
    monitors.forEach((m, i) => {
      const status = m.enabled ? '✅ 监听中' : '⏸️ 已暂停'
      msg += `${i + 1}. ${status}\n\`${m.address}\`\n\n`
    })

    const { Markup } = await import('telegraf')
    const inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔙 返回', 'usdt_monitor')]
    ])

    await ctx.reply(msg, {
      parse_mode: 'Markdown',
      ...inlineKeyboard
    })
  })

  // 删除特定地址
  bot.action(/^usdt_delete_(.+)$/, async (ctx) => {
    const monitorId = ctx.match[1]

    try {
      await ctx.answerCbQuery('正在删除...')
    } catch (e) {
      console.error('[usdt_delete][answerCbQuery]', e)
    }

    const userId = String(ctx.from?.id || '')

    try {
      // 查找监听记录
      const monitor = await prisma.usdtMonitor.findUnique({
        where: { id: monitorId }
      })

      if (!monitor || monitor.userId !== userId) {
        return ctx.reply('❌ 监听地址不存在或无权限')
      }

      // 删除监听
      const result = await removeMonitor(userId, monitor.address)

      if (result.success) {
        await ctx.reply(`✅ 已删除监听地址：\n\`${monitor.address}\``, {
          parse_mode: 'Markdown'
        })
        // 刷新菜单
        await showMonitorMenu(ctx)
      } else {
        await ctx.reply(`❌ 删除失败：${result.error}`)
      }
    } catch (e) {
      console.error('[usdt_delete][error]', e)
      await ctx.reply('❌ 删除失败，请稍后重试')
    }
  })

  // 取消输入
  bot.action('usdt_cancel_input', async (ctx) => {
    const userId = String(ctx.from?.id || '')
    userInputStates.delete(userId)

    try {
      await ctx.answerCbQuery('已取消')
    } catch (e) {
      console.error('[usdt_cancel_input][answerCbQuery]', e)
    }

    await showMonitorMenu(ctx)
  })

  // 处理用户输入的地址
  bot.on('text', async (ctx, next) => {
    const userId = String(ctx.from?.id || '')
    const state = userInputStates.get(userId)

    // 检查是否在等待输入状态
    if (!state || Date.now() - state.timestamp > 300000) { // 5分钟超时
      userInputStates.delete(userId)
      return next()
    }

    // 只在私聊中处理
    if (ctx.chat?.type !== 'private') {
      return next()
    }

    const text = ctx.message.text?.trim() || ''

    if (state.action === 'add_address') {
      userInputStates.delete(userId)

      // 验证地址格式
      if (!text || text.length !== 34 || !text.startsWith('T')) {
        return ctx.reply('❌ 地址格式错误，请提供正确的TRC20地址（以T开头，34位字符）')
      }

      // 添加监听
      const result = await addMonitor(userId, text)

      if (result.success) {
        await ctx.reply(`✅ 监听地址添加成功！\n\n\`${text}\`\n\n当该地址有USDT转账时，机器人会自动通知您。`, {
          parse_mode: 'Markdown'
        })
      } else {
        await ctx.reply(`❌ 添加失败：${result.error}`)
      }

      return
    }

    return next()
  })
}

/**
 * 初始化USDT监听（在机器人启动时调用）
 */
export async function initUsdtMonitor() {
  console.log('[USDT Monitor] 初始化监听服务...')
  await loadAllMonitors()
}
