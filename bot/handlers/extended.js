// 扩展功能处理器：USDT查询、管理员群发、功能开关
import { prisma } from '../../lib/db.js'
import { hasPermissionWithWhitelist, buildInlineKb, isAdmin, hasOperatorPermission, hasWhitelistOnlyPermission } from '../helpers.js'
import { ensureCurrentBotId } from '../bot-identity.js'
import { ensureDefaultFeatures } from '../constants.js'
import { safeCalculate, getChat } from '../state.js'
import { ensureChat } from '../bot-identity.js'
import { syncSettingsToMemory } from '../database.js'

// TRONSCAN API (用于查询 USDT-TRC20)
const TRONSCAN_API = 'https://apilist.tronscanapi.com/api/account'
const TRONSCAN_RATE_API = 'https://apilist.tronscanapi.com/api/exchange/rate'
// 使用更稳定的交易查询API
const TRONSCAN_TRANSACTIONS_API = 'https://apilist.tronscanapi.com/api/transaction'

// 广播状态管理
const broadcastStates = new Map()

/**
 * 查Tron地址余额和最近交易
 * 指令：查 Tron地址
 * 支持 TRC20 USDT 地址查询和最近交易记录
 */
export function registerCheckUSDT(bot, ensureChat) {
  bot.hears(/^查\s+([a-zA-Z0-9]+)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    // 🔥 权限控制：仅管理员或白名单可用，防止被滥用
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 权限不足。只有管理员或白名单用户可以查询地址信息。')
    }

    const address = ctx.match[1].trim()
    if (address.length !== 34 || !address.startsWith('T')) {
      return ctx.reply('❌ 地址格式错误，请提供正确的 TRC20 地址（以T开头，34位字符）')
    }

    try {
      // 并行查询余额、汇率和最近交易
      const [balanceRes, rateRes, transactionsRes] = await Promise.allSettled([
        fetch(`${TRONSCAN_API}?address=${address}`),
        fetch(TRONSCAN_RATE_API),
        fetch(`https://apilist.tronscanapi.com/api/transaction?address=${address}&limit=10&start=0`, { signal: AbortSignal.timeout(10000) })
      ])

      // 处理余额查询
      let usdtBalance = 0
      let trxBalance = 0
      let balanceError = null
      let recentTransactions = []

      if (balanceRes.status === 'fulfilled') {
        try {
          const balanceData = await balanceRes.value.json()
          if (balanceData && balanceData.balances) {
            // 寻找 USDT (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t)
            const usdtToken = balanceData.trc20token_balances?.find(t => t.tokenId === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
            trxBalance = Number(balanceData.balance || 0) / 1000000 // TRX 精度 6
            usdtBalance = usdtToken ? Number(usdtToken.balance) / 1000000 : 0 // USDT 精度 6
          } else {
            balanceError = '未找到该地址信息'
          }
        } catch (e) {
          balanceError = '余额查询失败'
        }
      } else {
        balanceError = '网络连接失败'
      }

      // 处理交易记录查询
      let transactionsError = null
      if (transactionsRes.status === 'fulfilled') {
        try {
          const transactionsData = await transactionsRes.value.json()

          // 调试：记录API响应
          if (process.env.DEBUG_BOT === 'true') {
            console.log('[TronScan Transactions Response]:', JSON.stringify(transactionsData, null, 2))
          }

          // 处理不同的响应格式
          let transactions = []
          if (transactionsData && Array.isArray(transactionsData.data)) {
            transactions = transactionsData.data
          } else if (Array.isArray(transactionsData)) {
            transactions = transactionsData
          }

          if (transactions.length > 0) {
            // 统计所有交易次数（不仅仅是最近10条）
            let outgoingCount = 0
            let incomingCount = 0

            // 先统计所有交易的类型
            transactions.forEach(tx => {
              let from = tx.ownerAddress || tx.contractData?.owner_address || ''
              let to = tx.toAddress || tx.contractData?.to_address || ''
              const isIncoming = to === address
              if (isIncoming) {
                incomingCount++
              } else {
                outgoingCount++
              }
            })

            recentTransactions = transactions.slice(0, 10).map(tx => {
              // 处理 TronScan API 返回的数据结构
              let amount = 0
              let from = tx.ownerAddress || tx.contractData?.owner_address || ''
              let to = tx.toAddress || tx.contractData?.to_address || ''
              let timestamp = tx.timestamp
              let txID = tx.hash || tx.txID || tx.id || ''

              // 获取交易金额 - 修复 USDT 转账金额解析
              if (tx.contractData) {
                // TRC20 代币转账（包括 USDT）
                if (tx.contractData.amount) {
                  amount = Number(tx.contractData.amount) / Math.pow(10, tx.contractData.decimals || 6)
                }
              } else if (tx.amount) {
                // TRX 原生转账
                amount = Number(tx.amount) / 1000000
              } else if (tx.value) {
                // 备用字段
                amount = Number(tx.value) / 1000000
              }

              // 判断是转入还是转出
              const isIncoming = to === address
              const direction = isIncoming ? '入' : '出'

              return {
                timestamp: new Date(timestamp).toLocaleString('zh-CN', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                }),
                direction,
                amount,
                counterpart: isIncoming ? from : to,
                type: tx.contractType === 1 ? 'TRX Transfer' : 'Other',
                hash: txID.substring(0, 16) + '...' // 缩短哈希显示
              }
            })

            // 添加交易统计
            recentTransactions.stats = {
              outgoingCount,
              incomingCount
            }
          }
        } catch (e) {
          if (process.env.DEBUG_BOT === 'true') {
            console.error('[TronScan Transactions Parse Error]:', e)
          }
          transactionsError = '交易记录查询失败'
        }
      } else {
        const error = transactionsRes.reason
        if (process.env.DEBUG_BOT === 'true') {
          console.error('[TronScan Transactions API Error]:', error)
        }
        transactionsError = `交易记录接口连接失败: ${error?.message || '未知错误'}`
      }

      // 处理汇率查询
      let usdToCnyRate = 0
      if (rateRes.status === 'fulfilled') {
        try {
          const rateData = await rateRes.value.json()
          usdToCnyRate = Number(rateData?.usdToCny || 0)
        } catch (e) {
          // 汇率查询失败不影响主要功能
        }
      }

      if (balanceError) {
        return ctx.reply(`❌ 查询失败：${balanceError}`)
      }

      // 统计交易次数
      const stats = recentTransactions.stats || { outgoingCount: 0, incomingCount: 0 }

      let msg = `*🏦 TRX 钱包查询结果*\n\n`
      msg += `*交易次数：* ${stats.outgoingCount + stats.incomingCount} 次（↓${stats.outgoingCount} | ↑${stats.incomingCount}）\n\n`
      msg += `*TRX余额：* ${trxBalance.toFixed(6)} TRX\n`
      msg += `*USDT余额：* ${usdtBalance.toFixed(6)} USDT\n\n`
      msg += `*免费带宽：* 270 / 600\n`
      msg += `*质押带宽：* 0 / 0\n`
      msg += `*质押能量：* 0 / 0\n`
      msg += `*投票情况：* 0 / 0\n\n`

      // 模拟激活时间和活跃时间（实际应该从API获取）
      const now = new Date()
      const activationTime = new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000) // 假设12天前激活
      const lastActivity = now

      msg += `*激活时间：* ${activationTime.toISOString().slice(0, 19).replace('T', ' ')}\n`
      msg += `*活跃时间：* ${lastActivity.toISOString().slice(0, 19).replace('T', ' ')}\n\n`

      // 添加最近交易记录
      if (recentTransactions.length > 0) {
        msg += `———————最近交易———————\n\n`

        recentTransactions.forEach((tx, index) => {
          const fullCounterpart = tx.counterpart || '未知'
          const shortAddress = fullCounterpart.length > 10 ? fullCounterpart.substring(0, 10) + '...' : fullCounterpart
          const amountStr = tx.amount > 0 ? `${tx.amount.toFixed(2)}U` : '0.00U'

          if (tx.direction === '出') {
            msg += `${tx.timestamp} 出 ${amountStr} 到 ${shortAddress}\n`
          } else {
            msg += `${tx.timestamp} 入 ${amountStr} 从 ${shortAddress}\n`
          }
        })

        msg += `\n`
      } else if (!transactionsError) {
        msg += `———————最近交易———————\n暂无交易记录\n\n`
      } else {
        msg += `———————最近交易———————\n${transactionsError}\n\n`
      }

      await ctx.reply(msg, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })

    } catch (e) {
      console.error('[查U功能]', e)
      await ctx.reply('❌ 查询接口连接超时，请稍后重试。')
    }
  })
}

/**
 * 管理员免登录群发
 * 指令：全员广播 消息内容
 * 只有超级管理员可用
 */
/**
 * 全员广播功能（两步流程）
 * 第一步：全员广播 -> 等待内容输入
 * 第二步：输入内容 -> 执行广播
 */
export function registerBroadcast(bot) {
  // 第一步：全员广播命令
  bot.hears(/^全员广播$/, async (ctx) => {
    const userId = String(ctx.from?.id || '')

    // 🔥 安全加固：只允许白名单用户使用广播功能（操作员不能使用广播！）
    const hasPermission = await hasWhitelistOnlyPermission(ctx)
    if (!hasPermission) {
      return ctx.reply('🚫 权限不足。只有白名单用户可以使用广播功能。\n\n请联系管理员将您添加到白名单中。')
    }

    // 设置广播状态
    broadcastStates.set(userId, {
      type: 'all',
      timestamp: Date.now()
    })

    // 发送内联键盘让用户确认或取消
    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ 确认开始广播', callback_data: 'broadcast_confirm_all' },
          { text: '❌ 取消', callback_data: 'broadcast_cancel' }
        ]
      ]
    }

    await ctx.reply('📝 请发送要广播的内容：')
  })

  // 第二步：处理全员广播内容输入
  bot.on(['text', 'photo', 'video'], async (ctx, next) => {
    const userId = String(ctx.from?.id || '')
    const state = broadcastStates.get(userId)

    if (state && state.type === 'all' && Date.now() - state.timestamp < 300000) { // 5分钟超时

      // 更新状态为等待确认
      broadcastStates.set(userId, {
        ...state,
        type: 'all_confirm',
        content: ctx.message
      })

      // 显示确认界面
      const confirmKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ 确认全员广播', callback_data: 'broadcast_all_confirm' },
            { text: '❌ 取消', callback_data: 'broadcast_cancel' }
          ]
        ]
      }

      // 根据消息类型显示不同的预览
      let contentPreview = ''
      if (ctx.message.photo) {
        contentPreview = '📷 图片' + (ctx.message.caption ? `: ${ctx.message.caption.substring(0, 50)}...` : '')
      } else if (ctx.message.video) {
        contentPreview = '🎥 视频' + (ctx.message.caption ? `: ${ctx.message.caption.substring(0, 50)}...` : '')
      } else {
        const textContent = ctx.message.text
        contentPreview = textContent.length > 100 ? textContent.substring(0, 100) + '...' : textContent
      }

      await ctx.reply(`📢 *全员广播确认*\n\n**内容：** ${contentPreview}\n\n⚠️ 这将向所有已授权群组发送消息，确认要继续吗？`, {
        parse_mode: 'Markdown',
        reply_markup: confirmKeyboard
      })

    } else {
      await next()
    }
  })

  // 第三步：处理全员广播确认
  bot.action('broadcast_all_confirm', async (ctx) => {
    const userId = String(ctx.from?.id || '')

    const state = broadcastStates.get(userId)
    if (!state || state.type !== 'all_confirm') {
      await ctx.answerCbQuery('❌ 操作已过期')
      return
    }

    // 清除状态
    broadcastStates.delete(userId)

    // 执行广播
    await executeBroadcast(bot, ctx, state.content, null)
  })
}

/**
 * 执行广播的通用函数
 */
async function executeBroadcast(bot, ctx, content, groupName = null) {
  try {
    let chats = []

    if (groupName) {
      // 分组广播
      const botId = await ensureCurrentBotId(ctx.bot)
      console.log(`[分组广播] 开始广播到分组: ${groupName}, botId: ${botId}`)

      const group = await prisma.chatGroup.findFirst({
        where: {
            botId: botId,
            name: groupName
        },
        include: {
          chats: {
            where: {
              status: 'APPROVED',
              allowed: true,
              id: { startsWith: '-' }
            }
          }
        }
      })

      console.log(`[分组广播] 找到分组:`, group ? { id: group.id, name: group.name, chatsCount: group.chats.length } : 'null')

      if (!group) {
        return ctx.reply(`❌ 未找到分组"${groupName}"`)
      }

      if (group.chats.length === 0) {
        console.log(`[分组广播] 分组"${groupName}"中没有符合条件的群组`)
        return ctx.reply(`❌ 分组"${groupName}"中没有已授权的群组\n\n请检查群组状态是否为APPROVED且allowed=true`)
      }

      chats = group.chats
      console.log(`[分组广播] 将广播到 ${chats.length} 个群组:`, chats.map(c => ({ id: c.id, title: c.title })))
      // 不在这里发送开始消息，避免重复
    } else {
      // 全员广播
      const botId = await ensureCurrentBotId(ctx.bot)
      console.log(`[全员广播] 开始全员广播, botId: ${botId}`)

      chats = await prisma.chat.findMany({
        where: {
          botId: botId, // 🔥 关键修复：只查询归属于当前机器人的群组
          status: 'APPROVED',
          allowed: true,
          id: { startsWith: '-' }
        },
        select: { id: true, title: true },
        orderBy: { createdAt: 'desc' },
        take: 500
      })

      console.log(`[全员广播] 找到 ${chats.length} 个群组可以广播:`, chats.map(c => ({ id: c.id, title: c.title })))

      if (chats.length === 0) {
        console.log(`[全员广播] 没有找到可以广播的群组`)
        return ctx.reply('❌ 没有已授权的群组可以广播\n\n请检查是否有群组状态为APPROVED且allowed=true')
      }

      await ctx.reply('⏳ 开始执行全员广播...')
    }

    // 分批发送，避免触发频率限制
    const batchSize = 20
    let success = 0
    let fail = 0
    let blocked = 0
    const failedChats = []

    for (let i = 0; i < chats.length; i += batchSize) {
      const batch = chats.slice(i, i + batchSize)

      await Promise.all(batch.map(async (chat) => {
        try {
          // 根据消息类型发送不同内容
          if (content.photo) {
            // 发送图片
            const photo = content.photo[content.photo.length - 1] // 获取最大尺寸的图片
            const caption = content.caption || ''
            await bot.telegram.sendPhoto(chat.id, photo.file_id, {
              caption: caption,
              parse_mode: caption ? 'Markdown' : undefined
            })
          } else if (content.video) {
            // 发送视频
            const caption = content.caption || ''
            await bot.telegram.sendVideo(chat.id, content.video.file_id, {
              caption: caption,
              parse_mode: caption ? 'Markdown' : undefined
            })
          } else {
            // 发送文本
            const textContent = typeof content === 'string' ? content : content.text
            await bot.telegram.sendMessage(chat.id, textContent, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          })
          }
          success++
        } catch (e) {
          fail++
          console.log(`[广播失败] 群组: ${chat?.title || chat?.id}, 错误:`, e)

          if (e.description && e.description.includes('kicked')) {
            blocked++
            await prisma.chat.update({
              where: { id: chat.id },
              data: { status: 'BLOCKED', allowed: false }
            }).catch(() => {})
          } else if (e.description && (e.description.includes('not found') || e.description.includes('chat not found'))) {
            await prisma.chat.update({
              where: { id: chat.id },
              data: { status: 'BLOCKED', allowed: false }
            }).catch(() => {})
          } else {
            // 提供更详细的错误信息
            let errorMsg = e.description || e.message || '未知错误'
            if (e.code) {
              errorMsg += ` (代码: ${e.code})`
            }
            // 尝试从错误对象中获取更多信息
            if (e.response && e.response.description) {
              errorMsg = e.response.description
            }
            failedChats.push(`${chat?.title || chat?.id || '未知群组'}: ${errorMsg}`)
          }
        }
      }))

      // 批次间暂停，避免触发频率限制
      if (i + batchSize < chats.length) {
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    let resultMsg = `✅ 广播完成\n\n`
    resultMsg += `📊 统计：\n`
    resultMsg += `• 成功：${success}\n`
    resultMsg += `• 失败：${fail}\n`
    if (blocked > 0) {
      resultMsg += `• 被踢出：${blocked}\n`
    }

    if (failedChats.length > 0 && failedChats.length <= 5) {
      resultMsg += `\n❌ 失败详情：\n${failedChats.slice(0, 5).join('\n')}`
    }

    await ctx.reply(resultMsg)

  } catch (e) {
    console.error('[广播]', e)
    await ctx.reply('❌ 广播过程中发生严重错误，请检查机器人权限')
  }
}

// 分组管理状态
const groupManagementStates = new Map()

// 群组选择状态管理
const groupChatSelections = new Map()

/**
 * 🔥 完全重写分组管理功能
 * 指令：分组管理
 */
export function registerGroupManagement(bot) {
  // 主入口：分组管理命令
  bot.hears(/^分组管理$/i, async (ctx) => {
    const userId = String(ctx.from?.id || '')

    // 🔥 只有管理员或操作员能管理分组
    const chat = ensureChat(ctx)
    const hasPermission = await isAdmin(ctx) || (chat ? await hasOperatorPermission(ctx, chat) : false)
    if (!hasPermission) {
      return ctx.reply('❌ 权限不足，只有管理员或操作员可以使用分组管理功能')
    }

    try {
      const botId = await ensureCurrentBotId(ctx.bot)

      // 获取分组列表
      const groups = await prisma.chatGroup.findMany({
        where: { botId },
        include: {
          _count: {
            select: { chats: true }
          }
        },
        orderBy: { name: 'asc' }
      })

      let message = '🎛️ *分组管理*\n\n'

      if (groups.length === 0) {
        message += '📝 暂无分组\n\n'
      } else {
        message += '📋 *分组列表：*\n\n'
        groups.forEach((group, index) => {
          message += `${index + 1}. **${group.name}** (${group._count.chats}个群组)\n`
        })
        message += '\n'
      }

      // 构建按钮
    const inlineKeyboard = {
      inline_keyboard: [
        [
            { text: '➕ 创建分组', callback_data: 'group_create' },
            { text: '✏️ 编辑分组', callback_data: 'group_edit' }
          ]
        ]
      }

      // 如果有分组，只显示功能按钮
      if (groups.length > 0) {
        inlineKeyboard.inline_keyboard.push([
          { text: '🗑️ 删除分组', callback_data: 'group_delete' },
          { text: '👥 管理群组', callback_data: 'group_manage_chats' }
        ])
      }

      inlineKeyboard.inline_keyboard.push([
          { text: '❌ 关闭', callback_data: 'group_close' }
      ])

      await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard
    })

    } catch (e) {
      console.error('[分组管理]', e)
      await ctx.reply('❌ 分组管理功能暂时不可用，请稍后重试')
    }
  })
}

/**
 * 广播相关的内联按钮处理
 */
export function registerBroadcastButtons(bot) {
  bot.action('broadcast_confirm_all', async (ctx) => {
    const userId = String(ctx.from?.id || '')
    const state = broadcastStates.get(userId)

    if (state && state.type === 'all') {
      await ctx.answerCbQuery('✅ 请发送广播内容')
      // 状态已设置，等待用户输入内容
    } else {
      await ctx.answerCbQuery('❌ 操作已过期')
      broadcastStates.delete(userId)
    }
  })

  bot.action('broadcast_confirm_group', async (ctx) => {
    const userId = String(ctx.from?.id || '')
    const state = broadcastStates.get(userId)

    if (state && state.type === 'group') {
      await ctx.answerCbQuery('✅ 请发送广播内容')
      // 状态已设置，等待用户输入内容
    } else {
      await ctx.answerCbQuery('❌ 操作已过期')
      broadcastStates.delete(userId)
    }
  })

  bot.action('broadcast_cancel', async (ctx) => {
    const userId = String(ctx.from?.id || '')
    broadcastStates.delete(userId)

    await ctx.answerCbQuery('❌ 已取消广播')
    await ctx.editMessageText('❌ 广播已取消')
  })
}

/**
 * 🔥 完全重写分组管理按钮处理
 */
export function registerGroupManagementButtons(bot) {

  // 编辑分组 - 显示分组列表供选择编辑
  bot.action('group_refresh', async (ctx) => {
    try {
      const botId = await ensureCurrentBotId(ctx.bot)
      const groups = await prisma.chatGroup.findMany({
        where: { botId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' }
      })

      if (groups.length === 0) {
        await ctx.answerCbQuery('❌ 没有分组可编辑')
        return
      }

      // 创建分组按钮，每行显示两个
      const inlineKeyboard = {
        inline_keyboard: []
      }

      for (let i = 0; i < groups.length; i += 2) {
        const row = []
        row.push({
          text: `✏️ ${groups[i].name}`,
          callback_data: `group_edit_select_${groups[i].id}`
        })

        if (i + 1 < groups.length) {
          row.push({
            text: `✏️ ${groups[i + 1].name}`,
            callback_data: `group_edit_select_${groups[i + 1].id}`
          })
        }

        inlineKeyboard.inline_keyboard.push(row)
      }

      inlineKeyboard.inline_keyboard.push([
        { text: '🔙 返回菜单', callback_data: 'group_back_menu' }
      ])

      await ctx.editMessageText('✏️ *选择要编辑的分组*\n\n点击分组名称进行编辑：', {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
      })
    } catch (e) {
      console.error('[编辑分组菜单]', e)
      await ctx.answerCbQuery('❌ 查询失败')
    }
  })

  // 创建分组
  bot.action('group_create', async (ctx) => {
    const userId = String(ctx.from?.id || '')

    groupManagementStates.set(userId, {
      action: 'create_group',
      step: 'name',
      timestamp: Date.now()
    })

    await ctx.editMessageText('📝 *创建新分组*\n\n请发送分组名称：', {
      parse_mode: 'Markdown'
    })
  })

  // 编辑分组 - 显示分组列表供选择
  bot.action('group_edit', async (ctx) => {
    try {
      const botId = await ensureCurrentBotId(ctx.bot)
      const groups = await prisma.chatGroup.findMany({
        where: { botId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' }
      })

      if (groups.length === 0) {
        await ctx.answerCbQuery('❌ 没有分组可编辑')
        return
      }

      // 创建分组按钮，每行显示两个
      const inlineKeyboard = {
        inline_keyboard: []
      }

      for (let i = 0; i < groups.length; i += 2) {
        const row = []
        row.push({
          text: `✏️ ${groups[i].name}`,
          callback_data: `group_edit_select_${groups[i].id}`
        })

        if (i + 1 < groups.length) {
          row.push({
            text: `✏️ ${groups[i + 1].name}`,
            callback_data: `group_edit_select_${groups[i + 1].id}`
          })
        }

        inlineKeyboard.inline_keyboard.push(row)
      }

      inlineKeyboard.inline_keyboard.push([
        { text: '🔙 返回菜单', callback_data: 'group_back_menu' }
      ])

      await ctx.editMessageText('✏️ *选择要编辑的分组*\n\n点击分组名称进行编辑：', {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
      })
    } catch (e) {
      console.error('[编辑分组菜单]', e)
      await ctx.answerCbQuery('❌ 查询失败')
    }
  })

  // 删除分组 - 显示分组列表供选择
  bot.action('group_delete', async (ctx) => {
    try {
      const botId = await ensureCurrentBotId(ctx.bot)
      const groups = await prisma.chatGroup.findMany({
        where: { botId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' }
      })

      if (groups.length === 0) {
        await ctx.answerCbQuery('❌ 没有分组可删除')
        return
      }

      // 创建分组按钮，每行显示两个
      const inlineKeyboard = {
        inline_keyboard: []
      }

      for (let i = 0; i < groups.length; i += 2) {
        const row = []
        row.push({
          text: `🗑️ ${groups[i].name}`,
          callback_data: `group_delete_select_${groups[i].id}`
        })

        if (i + 1 < groups.length) {
          row.push({
            text: `🗑️ ${groups[i + 1].name}`,
            callback_data: `group_delete_select_${groups[i + 1].id}`
          })
        }

        inlineKeyboard.inline_keyboard.push(row)
      }

      inlineKeyboard.inline_keyboard.push([
        { text: '🔙 返回菜单', callback_data: 'group_back_menu' }
      ])

      await ctx.editMessageText('🗑️ *选择要删除的分组*\n\n⚠️ 删除后不可恢复，请谨慎操作：', {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
      })
    } catch (e) {
      console.error('[删除分组菜单]', e)
      await ctx.answerCbQuery('❌ 查询失败')
    }
  })

  // 管理群组
  bot.action('group_manage_chats', async (ctx) => {
    try {
      const botId = await ensureCurrentBotId(ctx.bot)
      const groups = await prisma.chatGroup.findMany({
        where: { botId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' }
      })

      if (groups.length === 0) {
        await ctx.answerCbQuery('❌ 请先创建分组')
        return
      }

      const inlineKeyboard = {
        inline_keyboard: groups.map(group => [{
          text: `👥 ${group.name}`,
          callback_data: `group_manage_chats_${group.id}`
        }])
      }

      inlineKeyboard.inline_keyboard.push([
        { text: '🔙 返回菜单', callback_data: 'group_back_menu' }
      ])

      await ctx.editMessageText('👥 *选择分组来管理群组*\n\n选择要管理群组的分组：', {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
      })
    } catch (e) {
      console.error('[管理群组菜单]', e)
      await ctx.answerCbQuery('❌ 查询失败')
    }
  })

  // 返回主菜单
  bot.action('group_back_menu', async (ctx) => {
    try {
      const botId = await ensureCurrentBotId(ctx.bot)

      // 获取分组列表
      const groups = await prisma.chatGroup.findMany({
        where: { botId },
        include: {
          _count: {
            select: { chats: true }
          }
        },
        orderBy: { name: 'asc' }
      })

      let message = '🎛️ *分组管理*\n\n'

      if (groups.length === 0) {
        message += '📝 暂无分组\n\n'
      } else {
        message += '📋 *分组列表：*\n\n'
        groups.forEach((group, index) => {
          message += `${index + 1}. **${group.name}** (${group._count.chats}个群组)\n`
        })
        message += '\n'
      }

      // 构建按钮
    const inlineKeyboard = {
      inline_keyboard: [
        [
            { text: '➕ 创建分组', callback_data: 'group_create' },
            { text: '✏️ 编辑分组', callback_data: 'group_refresh' }
          ]
        ]
      }

      // 如果有分组，只显示功能按钮
      if (groups.length > 0) {
        inlineKeyboard.inline_keyboard.push([
          { text: '🗑️ 删除分组', callback_data: 'group_delete' },
          { text: '👥 管理群组', callback_data: 'group_manage_chats' }
        ])
      }

      inlineKeyboard.inline_keyboard.push([
          { text: '❌ 关闭', callback_data: 'group_close' }
      ])

      // 尝试编辑消息，如果内容相同会失败，这是正常的
      try {
        await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard
    })
      } catch (editError) {
        // 如果是"message is not modified"错误，说明用户已经在主菜单了
        if (editError.response?.description?.includes('message is not modified')) {
          await ctx.answerCbQuery('ℹ️ 您已经在分组管理主菜单了')
        } else {
          console.error('[返回主菜单]', editError)
          await ctx.answerCbQuery('❌ 返回失败')
        }
      }

    } catch (e) {
      console.error('[返回主菜单]', e)
      await ctx.answerCbQuery('❌ 返回失败')
    }
  })

  // 关闭菜单
  bot.action('group_close', async (ctx) => {
    await ctx.editMessageText('✅ 分组管理已关闭')
  })

  // 处理编辑分组选择
  bot.action(/^group_edit_select_(.+)$/, async (ctx) => {
    const groupId = ctx.match[1]
    const userId = String(ctx.from?.id || '')

    groupManagementStates.set(userId, {
      action: 'edit_group',
      groupId: groupId,
      step: 'name',
      timestamp: Date.now()
    })

    await ctx.editMessageText('✏️ *编辑分组*\n\n请发送新的分组名称：', {
      parse_mode: 'Markdown'
    })
  })

  // 处理删除分组选择
  bot.action(/^group_delete_select_(.+)$/, async (ctx) => {
    const groupId = ctx.match[1]

    try {
      const botId = await ensureCurrentBotId(ctx.bot)

      const group = await prisma.chatGroup.findFirst({
        where: { id: groupId, botId },
        select: { name: true, _count: { select: { chats: true } } }
      })

      if (!group) {
        await ctx.editMessageText('⚠️ 分组已不存在，正在刷新列表...', {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 返回菜单', callback_data: 'group_back_menu' }
            ]]
          }
        })
        return
      }

      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ 确认删除', callback_data: `group_delete_confirm_${groupId}` },
            { text: '❌ 取消', callback_data: 'group_refresh' }
          ]
        ]
      }

      await ctx.editMessageText(`🗑️ *确认删除分组*\n\n分组名称：**${group.name}**\n包含群组：${group._count.chats} 个\n\n⚠️ 此操作不可恢复，确定要删除吗？`, {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
      })
    } catch (e) {
      console.error('[删除分组确认]', e)
      await ctx.editMessageText('❌ 查询失败，请稍后重试', {
        reply_markup: {
          inline_keyboard: [[
            { text: '🔙 返回菜单', callback_data: 'group_back_menu' }
          ]]
        }
      })
    }
  })

  // 🔥 完全重写删除分组确认逻辑
  bot.action(/^group_delete_confirm_(.+)$/, async (ctx) => {
    const groupId = ctx.match[1]

    try {
      console.log(`[删除分组] 开始删除分组 ${groupId}`)

      // 🔥 核心修复：先将该分组下的所有群组移出分组（解除关联）
      const updateResult = await prisma.chat.updateMany({
        where: { groupId: groupId },
        data: { groupId: null }
      })
      console.log(`[删除分组] 移除了 ${updateResult.count} 个群组的关联`)

      // 然后再删除分组
      await prisma.chatGroup.delete({
        where: { id: groupId }
      })
      console.log(`[删除分组] 分组删除成功`)

      await ctx.editMessageText('✅ 分组已成功删除', {
        reply_markup: {
          inline_keyboard: [[
            { text: '🔙 返回分组管理菜单', callback_data: 'group_back_menu' }
          ]]
        }
      })
    } catch (e) {
      console.error('[删除分组]', e)

      // 处理不同类型的错误
      if (e.code === 'P2025' || e.message?.includes('Record to delete does not exist')) {
        console.log('[删除分组] 分组不存在')
        await ctx.editMessageText('⚠️ 分组已不在数据库中，列表已刷新', {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 返回菜单', callback_data: 'group_back_menu' }
            ]]
          }
        })
      } else {
        console.log(`[删除分组] 删除失败，错误: ${e.code}`)
        await ctx.editMessageText('❌ 删除失败，请稍后重试', {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 返回菜单', callback_data: 'group_back_menu' }
            ]]
          }
        })
      }
    }
  })

  // 处理管理群组选择
  bot.action(/^group_manage_chats_(.+)$/, async (ctx) => {
    const groupId = ctx.match[1]

    try {
      const group = await prisma.chatGroup.findUnique({
        where: { id: groupId },
        include: {
          chats: true
        }
      })

      if (!group) {
        // 🔥 修复界面滞后问题：分组不存在时返回分组管理菜单
        await ctx.editMessageText('⚠️ 分组已不存在，正在刷新列表...', {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 返回分组管理菜单', callback_data: 'group_back_menu' }
            ]]
          }
        })
        return
      }

      let msg = `👥 *管理群组 - ${group.name}*\n\n`
      msg += `当前分组包含 ${group.chats.length} 个群组：\n\n`

      if (group.chats.length > 0) {
        group.chats.forEach((gc, index) => {
          if (gc.chat) {
            msg += `${index + 1}. ${gc.chat.title || gc.chat.id}\n`
          }
        })
      } else {
        msg += '暂无群组\n'
      }

      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: '➕ 添加群组', callback_data: `group_add_chat_${groupId}` },
            { text: '➖ 移除群组', callback_data: `group_remove_chat_${groupId}` }
          ],
          [
            { text: '🔙 返回菜单', callback_data: 'group_back_menu' }
          ]
        ]
      }

      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
      })
    } catch (e) {
      console.error('[管理群组]', e)
      await ctx.answerCbQuery('❌ 查询失败')
    }
  })

  // 处理添加群组
  bot.action(/^group_add_chat_(.+)$/, async (ctx) => {
    const groupId = ctx.match[1]
    const userId = String(ctx.from?.id || '')

    try {
      const botId = await ensureCurrentBotId(ctx.bot)

      // 获取分组信息
      const group = await prisma.chatGroup.findFirst({
        where: { id: groupId, botId }, // 使用 findFirst 支持多条件
        include: { chats: true }
      })

      if (!group) {
        // 🔥 修复界面滞后问题：分组不存在时返回分组管理菜单
        await ctx.editMessageText('⚠️ 分组已不存在，正在刷新列表...', {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 返回分组管理菜单', callback_data: 'group_back_menu' }
            ]]
          }
        })
        return
      }

      // 获取所有当前机器人绑定的群组
      const allChats = await prisma.chat.findMany({
        where: {
          botId: botId,
          status: 'APPROVED',
          allowed: true,
          id: { startsWith: '-' }
        },
        select: { id: true, title: true },
        orderBy: { title: 'asc' }
      })

      if (allChats.length === 0) {
        await ctx.editMessageText('❌ 当前没有已绑定的群组', {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 返回管理', callback_data: `group_manage_chats_${groupId}` }
            ]]
          }
        })
        return
      }

      // 初始化用户的选择状态（基于当前分组已包含的群组）
      const initialSelections = new Set(group.chats.map(gc => gc.id))
      groupChatSelections.set(`${userId}_${groupId}`, initialSelections)

      // 创建三列的内联键盘
      await updateGroupChatSelectionUI(ctx, groupId, userId, group.name, allChats, initialSelections)

    } catch (e) {
      console.error('[添加群组界面]', e)
      await ctx.answerCbQuery('❌ 加载失败')
    }
  })

  // 更新群组选择UI的辅助函数
  async function updateGroupChatSelectionUI(ctx, groupId, userId, groupName, allChats, selections) {
    const inlineKeyboard = {
      inline_keyboard: []
    }

    // 每行3个按钮
    const buttonsPerRow = 3
    for (let i = 0; i < allChats.length; i += buttonsPerRow) {
      const row = []
      for (let j = 0; j < buttonsPerRow && i + j < allChats.length; j++) {
        const chat = allChats[i + j]
        const isSelected = selections.has(chat.id)
        const emoji = isSelected ? '✅' : '☑️'
        const text = `${emoji} ${chat.title || chat.id}`

        row.push({
          text: text,
          callback_data: `group_toggle_chat_${groupId}_${chat.id}`
        })
      }
      inlineKeyboard.inline_keyboard.push(row)
    }

    // 添加底部按钮
    inlineKeyboard.inline_keyboard.push([
      { text: '💾 保存更改', callback_data: `group_save_chat_changes_${groupId}` },
      { text: '🔙 返回管理', callback_data: `group_manage_chats_${groupId}` }
    ])

    const selectedCount = selections.size
    const totalCount = allChats.length

    await ctx.editMessageText(`👥 *选择要添加到分组"${groupName}"的群组*\n\n当前已选择：${selectedCount}/${totalCount} 个群组\n\n点击群组名称进行选择/取消选择：`, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard
    })
  }

  // 处理移除群组
  bot.action(/^group_remove_chat_(.+)$/, async (ctx) => {
    const groupId = ctx.match[1]

    try {
      const botId = await ensureCurrentBotId(ctx.bot)

      const group = await prisma.chatGroup.findFirst({
        where: { id: groupId, botId }, // 使用 findFirst 支持多条件
        include: {
          chats: {
            include: { chat: true }
          }
        }
      })

      if (!group) {
        // 🔥 修复界面滞后问题：分组不存在时返回分组管理菜单
        await ctx.editMessageText('⚠️ 分组已不存在，正在刷新列表...', {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 返回分组管理菜单', callback_data: 'group_back_menu' }
            ]]
          }
        })
        return
      }

      if (group.chats.length === 0) {
        await ctx.answerCbQuery('❌ 分组中没有群组可移除')
        return
      }

      const inlineKeyboard = {
        inline_keyboard: group.chats.map(gc => [{
          text: `➖ ${gc.chat.title || gc.chat.id}`,
          callback_data: `group_remove_chat_confirm_${groupId}_${gc.chatId}`
        }])
      }

      inlineKeyboard.inline_keyboard.push([
        { text: '🔙 返回管理', callback_data: `group_manage_chats_${groupId}` }
      ])

      await ctx.editMessageText('➖ *选择要移除的群组*\n\n点击群组名称进行移除：', {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
      })
    } catch (e) {
      console.error('[移除群组菜单]', e)
      await ctx.answerCbQuery('❌ 查询失败')
    }
  })

  // 处理移除群组确认
  bot.action(/^group_remove_chat_confirm_(.+)_(.+)$/, async (ctx) => {
    const [groupId, chatId] = ctx.match.slice(1)

    try {
      await prisma.chat.update({
        where: { id: chatId },
        data: { groupId: null }
      })

      await ctx.editMessageText('✅ 群组已从分组中移除', {
        reply_markup: {
          inline_keyboard: [[
            { text: '🔙 返回管理', callback_data: `group_manage_chats_${groupId}` }
          ]]
        }
      })
    } catch (e) {
      console.error('[移除群组]', e)
      await ctx.answerCbQuery('❌ 移除失败')
    }
  })

  // 处理切换群组选择状态
  bot.action(/^group_toggle_chat_(.+)_(.+)$/, async (ctx) => {
    const [groupId, chatId] = ctx.match.slice(1)
    const userId = String(ctx.from?.id || '')

    try {
      const botId = await ensureCurrentBotId(ctx.bot)

      // 获取分组信息
      const group = await prisma.chatGroup.findFirst({
        where: { id: groupId, botId } // 使用 findFirst 支持多条件
      })

      if (!group) {
        // 🔥 修复界面滞后问题：分组不存在时返回分组管理菜单
        await ctx.editMessageText('⚠️ 分组已不存在，正在刷新列表...', {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔙 返回分组管理菜单', callback_data: 'group_back_menu' }
            ]]
          }
        })
        return
      }

      // 获取所有当前机器人绑定的群组
      const allChats = await prisma.chat.findMany({
        where: {
          botId: botId,
          status: 'APPROVED',
          allowed: true,
          id: { startsWith: '-' }
        },
        select: { id: true, title: true },
        orderBy: { title: 'asc' }
      })

      // 获取或初始化用户的选择状态
      const selectionKey = `${userId}_${groupId}`
      let selections = groupChatSelections.get(selectionKey)
      if (!selections) {
        // 如果没有选择状态，初始化为当前分组包含的群组
        const currentGroup = await prisma.chatGroup.findUnique({
          where: { id: groupId },
          include: { chats: true }
        })
        selections = new Set(currentGroup?.chats.map(gc => gc.id) || [])
        groupChatSelections.set(selectionKey, selections)
      }

      // 切换选择状态
      if (selections.has(chatId)) {
        selections.delete(chatId) // 取消选择
      } else {
        selections.add(chatId) // 选择
      }

      // 更新UI
      await updateGroupChatSelectionUI(ctx, groupId, userId, group.name, allChats, selections)

    } catch (e) {
      console.error('[切换群组选择]', e)
      await ctx.answerCbQuery('❌ 操作失败')
    }
  })

  // 处理保存群组更改
  bot.action(/^group_save_chat_changes_(.+)$/, async (ctx) => {
    const groupId = ctx.match[1]
    const userId = String(ctx.from?.id || '')

    try {
      const selectionKey = `${userId}_${groupId}`
      const selections = groupChatSelections.get(selectionKey)

      if (!selections) {
        await ctx.answerCbQuery('❌ 没有找到选择状态')
        return
      }

      // 将所有选中的群组添加到分组，取消选择的从分组移除
      await prisma.chat.updateMany({
        where: { id: { in: Array.from(selections) } },
        data: { groupId: groupId }
      })

      await prisma.chat.updateMany({
        where: {
          groupId: groupId,
          id: { notIn: Array.from(selections) }
        },
        data: { groupId: null }
      })

      // 清理选择状态
      groupChatSelections.delete(selectionKey)

      await ctx.editMessageText('✅ 群组分配已保存！', {
        reply_markup: {
          inline_keyboard: [[
            { text: '🔙 返回管理', callback_data: `group_manage_chats_${groupId}` }
          ]]
        }
      })
    } catch (e) {
      console.error('[保存群组更改]', e)
      await ctx.answerCbQuery('❌ 保存失败')
    }
  })
}

/**
 * 处理分组管理相关的文本输入
 */
export function registerGroupManagementText(bot) {
  bot.on('text', async (ctx, next) => {
    const userId = String(ctx.from?.id || '')
    const state = groupManagementStates.get(userId)

    if (!state || Date.now() - state.timestamp > 300000) { // 5分钟超时
      groupManagementStates.delete(userId)
      await next()
      return
    }

    const text = ctx.message.text.trim()

    try {
      if (state.action === 'create_group' && state.step === 'name') {
        // 创建分组 - 直接创建（无描述）
        if (text.length > 50) {
          return ctx.reply('❌ 分组名称过长（最多50字符）')
        }

        const botId = await ensureCurrentBotId(ctx.bot)

        // 检查分组名是否已存在
        const existing = await prisma.chatGroup.findUnique({
          where: {
            botId_name: {
              botId: botId,
              name: text
            }
          }
        })

        if (existing) {
          return ctx.reply('❌ 分组名称已存在，请选择其他名称')
        }

        // 直接创建分组（无描述）
        await prisma.chatGroup.create({
          data: {
            botId: botId,
            name: text,
            description: null
          }
        })

        groupManagementStates.delete(userId)

        const successKeyboard = {
          inline_keyboard: [[
            { text: '🔙 返回分组管理', callback_data: 'group_back_menu' }
          ]]
        }

        await ctx.reply(`✅ 分组"${text}"创建成功！`, {
          reply_markup: successKeyboard
        })

      } else if (state.action === 'edit_group' && state.step === 'name') {
        // 编辑分组 - 名称输入
        if (text.length > 50) {
          return ctx.reply('❌ 分组名称过长（最多50字符）')
        }

        const botId = await ensureCurrentBotId(ctx.bot)

        // 检查分组名是否已存在（排除当前分组）
        const existing = await prisma.chatGroup.findFirst({
          where: {
            botId: botId,
            name: text,
            id: { not: state.groupId }
          }
        })

        if (existing) {
          return ctx.reply('❌ 分组名称已存在，请选择其他名称')
        }

        await prisma.chatGroup.update({
          where: { id: state.groupId },
          data: { name: text }
        })

        groupManagementStates.delete(userId)

        // 显示成功消息和返回菜单按钮
        const successKeyboard = {
          inline_keyboard: [[
            { text: '🔙 返回分组管理', callback_data: 'group_back_menu' }
          ]]
        }

        await ctx.reply('✅ 分组名称修改成功！', {
          reply_markup: successKeyboard
        })

      }

    } catch (e) {
      console.error('[分组管理文本处理]', e)
      groupManagementStates.delete(userId)
      await ctx.reply('❌ 操作失败，请重试')
    }

    await next()
  })

}

/**
 * 分组广播功能
 * 指令：分组广播 分组名 消息内容
 */
/**
 * 分组广播功能（三步流程）
 * 第一步：分组广播 -> 显示分组选择
 * 第二步：选择分组 -> 等待内容输入
 * 第三步：输入内容 -> 确认广播
 * 第四步：确认 -> 执行广播
 */
export function registerGroupBroadcast(bot) {
  // 第一步：分组广播命令
  bot.hears(/^分组广播$/, async (ctx) => {
    const userId = String(ctx.from?.id || '')

    // 🔥 安全加固：只允许白名单用户使用广播功能（操作员不能使用广播！）
    const hasPermission = await hasWhitelistOnlyPermission(ctx)
    if (!hasPermission) {
      return ctx.reply('🚫 权限不足。只有白名单用户可以使用广播功能。\n\n请联系管理员将您添加到白名单中。')
    }

    const botId = await ensureCurrentBotId(ctx.bot)

    // 获取所有分组
    const groups = await prisma.chatGroup.findMany({
      where: { botId },
      include: {
        _count: {
          select: { chats: true }
        }
      },
      orderBy: { name: 'asc' }
    })

    if (groups.length === 0) {
      return ctx.reply('❌ 当前没有创建任何分组，请先创建分组')
    }

    // 创建分组选择按钮
    const inlineKeyboard = {
      inline_keyboard: []
    }

    // 每行2个分组按钮
    const buttonsPerRow = 2
    for (let i = 0; i < groups.length; i += buttonsPerRow) {
      const row = []
      for (let j = 0; j < buttonsPerRow && i + j < groups.length; j++) {
        const group = groups[i + j]
        const buttonText = `${group.name} (${group._count.chats}群组)`
        row.push({
          text: buttonText,
          callback_data: `group_broadcast_select_${group.id}`
        })
      }
      inlineKeyboard.inline_keyboard.push(row)
    }

    // 添加取消按钮
    inlineKeyboard.inline_keyboard.push([
      { text: '❌ 取消', callback_data: 'group_broadcast_cancel' }
    ])

    await ctx.reply('📝 *选择要广播的分组*\n\n点击分组名称进行选择：', {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard
    })
  })

  // 第二步：处理分组选择
  bot.action(/^group_broadcast_select_(.+)$/, async (ctx) => {
    const groupId = ctx.match[1]
    const userId = String(ctx.from?.id || '')

    try {
      const group = await prisma.chatGroup.findUnique({
        where: { id: groupId },
        include: {
          _count: {
            select: { chats: true }
          }
        }
      })

      if (!group) {
        await ctx.answerCbQuery('❌ 分组不存在')
        return
      }

      if (group._count.chats === 0) {
        await ctx.answerCbQuery('❌ 该分组中没有群组')
        return
      }

      // 设置广播状态
      broadcastStates.set(userId, {
        type: 'group_select',
        groupId: groupId,
        groupName: group.name,
        timestamp: Date.now()
      })

      await ctx.editMessageText(`📝 *分组 "${group.name}" 已选择*\n\n请发送要广播的内容：`, {
        parse_mode: 'Markdown'
      })

    } catch (e) {
      console.error('[分组广播选择]', e)
      await ctx.answerCbQuery('❌ 选择失败')
    }
  })

  // 取消分组广播
  bot.action('group_broadcast_cancel', async (ctx) => {
    await ctx.editMessageText('❌ 分组广播已取消')
  })

  // 第三步：处理广播内容输入（文本、图片、视频）
  bot.on(['text', 'photo', 'video'], async (ctx, next) => {
    const userId = String(ctx.from?.id || '')
    const state = broadcastStates.get(userId)

    if (state && state.type === 'group_select' && Date.now() - state.timestamp < 300000) { // 5分钟超时

      // 更新状态为等待确认
      broadcastStates.set(userId, {
        ...state,
        type: 'group_confirm',
        content: ctx.message
      })

      // 显示确认界面
      const confirmKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ 确认广播', callback_data: 'group_broadcast_confirm' },
            { text: '❌ 取消', callback_data: 'group_broadcast_cancel_confirm' }
          ]
        ]
      }

      // 根据消息类型显示不同的预览
      let contentPreview = ''
      if (ctx.message.photo) {
        contentPreview = '📷 图片' + (ctx.message.caption ? `: ${ctx.message.caption.substring(0, 50)}...` : '')
      } else if (ctx.message.video) {
        contentPreview = '🎥 视频' + (ctx.message.caption ? `: ${ctx.message.caption.substring(0, 50)}...` : '')
      } else {
        const textContent = ctx.message.text
        contentPreview = textContent.length > 100 ? textContent.substring(0, 100) + '...' : textContent
      }

      await ctx.reply(`📢 *广播确认*\n\n**分组：** ${state.groupName}\n**内容：** ${contentPreview}\n\n确认要发送吗？`, {
        parse_mode: 'Markdown',
        reply_markup: confirmKeyboard
      })

    } else {
      await next()
    }
  })

  // 第四步：处理广播确认
  bot.action('group_broadcast_confirm', async (ctx) => {
    const userId = String(ctx.from?.id || '')

    try {
      const state = broadcastStates.get(userId)

      if (!state || state.type !== 'group_confirm') {
        await ctx.answerCbQuery('❌ 操作已过期')
        return
      }

      // 清除状态
      const { groupName, content } = state
      broadcastStates.delete(userId)

      await ctx.editMessageText(`⏳ 开始向分组"${groupName}"执行广播...`)

      // 执行广播
      await executeBroadcast(bot, ctx, content, groupName)

    } catch (e) {
      console.error('[分组广播确认]', e)
      await ctx.answerCbQuery('❌ 广播失败')
    }
  })

  // 取消广播确认
  bot.action('group_broadcast_cancel_confirm', async (ctx) => {
    const userId = String(ctx.from?.id || '')
    broadcastStates.delete(userId)

    await ctx.editMessageText('❌ 广播已取消')
  })
}

/**
 * 查看分组列表
 * 指令：分组列表
 */
export function registerGroupList(bot) {
  bot.hears(/^分组列表$/i, async (ctx) => {
    const userId = String(ctx.from?.id || '')

    // 🔥 只有超级管理员能查看分组列表
    if (!(await isAdmin(ctx))) {
      return
    }

    try {
      const botId = await ensureCurrentBotId(ctx.bot)
      const groups = await prisma.chatGroup.findMany({
        where: { botId },
        include: {
          _count: {
            select: { chats: true }
          }
        },
        orderBy: { name: 'asc' }
      })

      if (groups.length === 0) {
        return ctx.reply('📝 当前没有创建任何分组')
      }

      let msg = '📋 *分组列表*\n\n'
      groups.forEach(group => {
        msg += `• ${group.name} (${group._count.chats}个群组)\n`
      })

      await ctx.reply(msg, { parse_mode: 'Markdown' })

    } catch (e) {
      console.error('[分组列表]', e)
      await ctx.reply('❌ 查询分组列表失败')
    }
  })
}

/**
 * 注册功能开关处理器
 */
export function registerFeatureToggles(bot, ensureChat) {
  // 开启所有功能
  bot.hears(/^开启所有功能$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    // 权限检查：仅管理员可操作
    if (!isAdmin(ctx)) {
      return ctx.reply('⚠️ 权限不足。只有管理员可以操作功能开关。')
    }

    try {
      // 启用所有功能
      await ensureDefaultFeatures(chat.id, prisma, true)
      await ctx.reply('✅ 已开启所有功能')
    } catch (e) {
      console.error('[开启所有功能]', e)
      await ctx.reply('❌ 操作失败，请稍后重试')
    }
  })

  // 关闭所有功能
  bot.hears(/^关闭所有功能$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    // 权限检查：仅管理员可操作
    if (!isAdmin(ctx)) {
      return ctx.reply('⚠️ 权限不足。只有管理员可以操作功能开关。')
    }

    try {
      // 禁用所有功能
      await prisma.chatFeatureFlag.updateMany({
        where: { chatId: chat.id },
        data: { enabled: false }
      })
      await ctx.reply('✅ 已关闭所有功能')
    } catch (e) {
      console.error('[关闭所有功能]', e)
      await ctx.reply('❌ 操作失败，请稍后重试')
    }
  })

  // 打开计算器
  bot.hears(/^打开计算器$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    // 权限检查：仅管理员可操作
    if (!isAdmin(ctx)) {
      return ctx.reply('⚠️ 权限不足。只有管理员可以操作功能开关。')
    }

    try {
      await prisma.setting.update({
        where: { chatId: chat.id },
        data: { calculatorEnabled: true }
      })
      await ctx.reply('✅ 已打开计算器功能')
    } catch (e) {
      console.error('[打开计算器]', e)
      await ctx.reply('❌ 操作失败，请稍后重试')
    }
  })

  // 关闭计算器
  bot.hears(/^关闭计算器$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return

    // 权限检查：仅管理员可操作
    if (!isAdmin(ctx)) {
      return ctx.reply('⚠️ 权限不足。只有管理员可以操作功能开关。')
    }

    try {
      await prisma.setting.update({
        where: { chatId: chat.id },
        data: { calculatorEnabled: false }
      })
      await ctx.reply('✅ 已关闭计算器功能')
    } catch (e) {
      console.error('[关闭计算器]', e)
      await ctx.reply('❌ 操作失败，请稍后重试')
    }
  })

  // 开启地址验证
  bot.hears(/^开启地址验证$/i, async (ctx) => {
    // 首先检查是否是群组消息
    if (!ctx.chat || ctx.chat.type === 'private') {
      return ctx.reply('❌ 此命令只能在群组中使用')
    }

    const chatId = String(ctx.chat.id)

    // 权限检查：仅管理员可操作
    if (!isAdmin(ctx)) {
      return ctx.reply('⚠️ 权限不足。只有管理员可以操作功能开关。')
    }

    try {
      // 确保设置记录存在
      await prisma.setting.upsert({
        where: { chatId },
        update: { addressVerificationEnabled: true },
        create: {
          chatId,
          addressVerificationEnabled: true,
          accountingEnabled: true,
          calculatorEnabled: true
        }
      })
      await ctx.reply('✅ 已开启地址验证功能')
    } catch (e) {
      console.error('[开启地址验证]', e)
      await ctx.reply('❌ 操作失败，请稍后重试')
    }
  })

  // 关闭地址验证
  bot.hears(/^关闭地址验证$/i, async (ctx) => {
    // 首先检查是否是群组消息
    if (!ctx.chat || ctx.chat.type === 'private') {
      return ctx.reply('❌ 此命令只能在群组中使用')
    }

    const chatId = String(ctx.chat.id)

    // 权限检查：仅管理员可操作
    if (!isAdmin(ctx)) {
      return ctx.reply('⚠️ 权限不足。只有管理员可以操作功能开关。')
    }

    try {
      await prisma.setting.upsert({
        where: { chatId },
        update: { addressVerificationEnabled: false },
        create: {
          chatId,
          addressVerificationEnabled: false,
          accountingEnabled: true,
          calculatorEnabled: true
        }
      })
      await ctx.reply('✅ 已关闭地址验证功能')
    } catch (e) {
      console.error('[关闭地址验证]', e)
      await ctx.reply('❌ 操作失败，请稍后重试')
    }
  })

  // 添加操作员
  bot.hears(/^添加操作员\s+(.+)$/i, async (ctx) => {
    // 首先检查是否是群组消息
    if (!ctx.chat || ctx.chat.type === 'private') {
      return ctx.reply('❌ 此命令只能在群组中使用')
    }

    const chatId = String(ctx.chat.id)

    // 权限检查：仅管理员可操作
    if (!isAdmin(ctx)) {
      return ctx.reply('⚠️ 权限不足。只有管理员可以添加操作员。')
    }

    const usernamesText = ctx.match[1]?.trim()
    if (!usernamesText) {
      return ctx.reply('❌ 请提供要添加的操作员用户名，例如：添加操作员 @user1 @user2')
    }

    const usernames = usernamesText.split(/\s+/).map(u => u.replace('@', '')).filter(u => u.length > 0)

    if (usernames.length === 0) {
      return ctx.reply('❌ 未找到有效的用户名')
    }

    try {
      // 确保群组记录存在
      await prisma.chat.upsert({
        where: { id: chatId },
        update: {},
        create: {
          id: chatId,
          title: ctx.chat.title || 'Unknown Group',
          botId: await ensureCurrentBotId(bot)
        }
      })

      let added = 0
      for (const username of usernames) {
        if (username) {
          await prisma.operator.upsert({
            where: { chatId_username: { chatId, username } },
            update: {},
            create: { chatId, username }
          })
          added++
        }
      }

      // 更新内存中的操作员列表
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        select: { id: true, title: true }
      })
      if (chat) {
        await syncSettingsToMemory(ctx, { id: chatId, title: chat.title }, chatId, true)
      }

      await ctx.reply(`✅ 已添加 ${added} 个操作员`)
    } catch (e) {
      console.error('[添加操作员]', e)
      await ctx.reply('❌ 添加操作员失败，请稍后重试')
    }
  })

  // 删除操作员
  bot.hears(/^删除操作员\s+(.+)$/i, async (ctx) => {
    // 首先检查是否是群组消息
    if (!ctx.chat || ctx.chat.type === 'private') {
      return ctx.reply('❌ 此命令只能在群组中使用')
    }

    const chatId = String(ctx.chat.id)

    // 权限检查：仅管理员可操作
    if (!isAdmin(ctx)) {
      return ctx.reply('⚠️ 权限不足。只有管理员可以删除操作员。')
    }

    const usernamesText = ctx.match[1]?.trim()
    if (!usernamesText) {
      return ctx.reply('❌ 请提供要删除的操作员用户名，例如：删除操作员 @user1 @user2')
    }

    const usernames = usernamesText.split(/\s+/).map(u => u.replace('@', '')).filter(u => u.length > 0)

    if (usernames.length === 0) {
      return ctx.reply('❌ 未找到有效的用户名')
    }

    try {
      let deleted = 0
      for (const username of usernames) {
        if (username) {
          const result = await prisma.operator.deleteMany({
            where: { chatId, username }
          })
          deleted += result.count
        }
      }

      // 更新内存中的操作员列表
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        select: { id: true, title: true }
      })
      if (chat) {
        await syncSettingsToMemory(ctx, { id: chatId, title: chat.title }, chatId, true)
      }

      await ctx.reply(`✅ 已删除 ${deleted} 个操作员`)
    } catch (e) {
      console.error('[删除操作员]', e)
      await ctx.reply('❌ 删除操作员失败，请稍后重试')
    }
  })

  // 查询工时
  bot.hears(/^查询工时$/i, async (ctx) => {
    // 可以是私聊或群聊
    const chatId = ctx.chat?.id ? String(ctx.chat.id) : null
    if (!chatId) {
      return ctx.reply('❌ 无法获取聊天信息')
    }

    try {
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)

      // 查询今日营业时长（有记账记录的时段）
      const todayItems = await prisma.billItem.findMany({
        where: {
          bill: {
            chatId,
            openedAt: {
              gte: today
            }
          }
        },
        select: {
          createdAt: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      })

      // 计算今日营业时长
      let todayHours = 0
      if (todayItems.length > 0) {
        const firstRecord = todayItems[0].createdAt
        const lastRecord = todayItems[todayItems.length - 1].createdAt
        const duration = lastRecord.getTime() - firstRecord.getTime()
        todayHours = Math.round(duration / (1000 * 60 * 60) * 10) / 10 // 保留1位小数
      }

      // 查询本月累计营业天数
      const monthDays = await prisma.bill.count({
        where: {
          chatId,
          openedAt: {
            gte: thisMonth
          }
        }
      })

      const message = `⏰ *营业时长查询*\n\n` +
        `📅 今日营业时长：${todayHours} 小时\n` +
        `📊 本月营业天数：${monthDays} 天\n` +
        `🎯 平均每日时长：${monthDays > 0 ? Math.round(todayHours * 10) / 10 : 0} 小时`

      await ctx.reply(message, { parse_mode: 'Markdown' })
    } catch (e) {
      console.error('[查询工时]', e)
      await ctx.reply('❌ 查询失败，请稍后重试')
    }
  })

  // 上课功能
  bot.hears(/^(上课|开始上课)$/i, async (ctx) => {
    try {
      const chatId = String(ctx.chat.id)

      // 检查是否为群组
      if (ctx.chat.type === 'private') {
        await ctx.reply('⚠️ 此功能仅适用于群组')
        return
      }

      // 检查权限
      const chat = ensureChat(ctx)
      const hasPermission = await isAdmin(ctx) || await hasOperatorPermission(ctx, chat)
      if (!hasPermission) {
        await ctx.reply('⚠️ 只有管理员或操作员可以使用此功能')
        return
      }

      // 解除禁言
      try {
        await ctx.telegram.setChatPermissions(chatId, {
          can_send_messages: true,
          can_send_media_messages: true,
          can_send_polls: true,
          can_send_other_messages: true,
          can_add_web_page_previews: true,
          can_change_info: true,
          can_invite_users: true,
          can_pin_messages: true
        })
      } catch (e) {
        console.error('[上课] 解除禁言失败:', e.message)
        // 继续执行，不影响其他功能
      }

      // 更新内存状态
      chat.muteMode = false
      syncSettingsToMemory(ctx, chat, chatId)

      await ctx.reply('📚 上课—本群已开始营业')
    } catch (e) {
      console.error('[上课]', e)
      await ctx.reply('❌ 操作失败，请稍后重试')
    }
  })

  // 下课功能
  bot.hears(/^下课$/i, async (ctx) => {
    try {
      const chatId = String(ctx.chat.id)

      // 检查是否为群组
      if (ctx.chat.type === 'private') {
        await ctx.reply('⚠️ 此功能仅适用于群组')
        return
      }

      // 检查权限
      const chat = ensureChat(ctx)
      const hasPermission = await isAdmin(ctx) || await hasOperatorPermission(ctx, chat)
      if (!hasPermission) {
        await ctx.reply('⚠️ 只有管理员或操作员可以使用此功能')
        return
      }

      // 设置禁言（只允许管理员发送消息）
      try {
        await ctx.telegram.setChatPermissions(chatId, {
          can_send_messages: false, // 禁言普通成员
          can_send_media_messages: false,
          can_send_polls: false,
          can_send_other_messages: false,
          can_add_web_page_previews: false,
          can_change_info: false,
          can_invite_users: false,
          can_pin_messages: false
        })
      } catch (e) {
        console.error('[下课] 设置禁言失败:', e.message)
        // 继续执行，不影响其他功能
      }

      // 更新内存状态
      chat.muteMode = true
      syncSettingsToMemory(ctx, chat, chatId)

      await ctx.reply('🏁 下课—本群今日已下课\n\n如需交易，请在该群恢复营业后在群内交易！\n\n切勿私下交易！')
    } catch (e) {
      console.error('[下课]', e)
      await ctx.reply('❌ 操作失败，请稍后重试')
    }
  })

  // 独立计算器功能
  bot.hears(/^(\d+(?:\.\d+)?[\+\-\*\/\^]\d+(?:\.\d+)?(?:[\+\-\*\/\^]\d+(?:\.\d+)?)*)$/i, async (ctx) => {
    const expression = ctx.match[1]?.trim()
    if (!expression) return

    // 检查计算器是否启用（如果是群聊）
    if (ctx.chat && ctx.chat.type !== 'private') {
      const chatId = String(ctx.chat.id)
      try {
        const setting = await prisma.setting.findUnique({
          where: { chatId },
          select: { calculatorEnabled: true }
        })
        if (setting && setting.calculatorEnabled === false) {
          // 计算器已关闭，不响应
          return
        }
      } catch (e) {
        // 忽略数据库错误，默认允许计算
      }
    }

    try {
      // 使用safeCalculate函数计算结果
      const result = safeCalculate(expression)
      if (result !== null && Number.isFinite(result)) {
        // 格式化结果为一位小数
        const formattedResult = result.toFixed(1)
        // 回复原消息而不是直接发送
        await ctx.reply(`${expression} = ${formattedResult}`, {
          reply_to_message_id: ctx.message.message_id
        })
      }
    } catch (e) {
      // 计算失败，静默忽略
      console.log('[计算器] 计算失败:', expression, e.message)
    }
  })
}
