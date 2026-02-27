// Minimal Telegraf bot with Chinese commands and local proxy support
import 'dotenv/config'
// 默认使用中国时区（如未由环境变量指定）
if (!process.env.TZ) {
  process.env.TZ = 'Asia/Shanghai'
}
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dns from 'node:dns'
import dotenv from 'dotenv'


import { Telegraf, Markup } from 'telegraf'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getChat, safeCalculate, cleanupInactiveChats } from './state.js'
import { prisma } from '../lib/db.js'
import { ensureDefaultFeatures } from './constants.js'
import { 
  getGlobalDailyCutoffHour, 
  formatMoney, 
  formatDuration
} from './utils.js'
// 新模块导入
import { ensureDbChat, updateSettings, syncSettingsToMemory, getOrCreateTodayBill, checkAndClearIfNewDay, performAutoDailyCutoff, deleteLastIncome, deleteLastDispatch, deleteIncomeByMessageId, deleteDispatchByMessageId } from './database.js'
import { createPermissionMiddleware } from './middleware.js'
import { buildInlineKb, fetchRealtimeRateUSDTtoCNY, getUsername, isAdmin, hasPermissionWithWhitelist } from './helpers.js'
import { formatSummary } from './formatting.js'
import { registerAllHandlers } from './handlers/index.js'
import { hasPendingUserInput } from './user-input-state.js'
import { promoteCaptionToText } from './command-utils.js'
import { getChatSubscriptionStatus, getSubscriptionConfig } from './subscription-service.js'
import { formatSubscriptionExpiry } from './subscription-utils.js'
import logger from './logger.js'

logger.initLogger({ dir: 'logs', level: process.env.DEBUG_BOT === 'true' ? 'debug' : 'info', stdout: true })
logger.hijackConsole()

// 🔥 安全增强：生产环境隐藏敏感信息
if (process.env.NODE_ENV === 'production') {
  // 生产环境：禁用详细日志输出，防止Token泄露
  console.log = () => {}
  console.debug = () => {}
  console.info = () => {} // 只保留error和warn
}

// 🛡️ 安全增强：避免日志泄露 token
function maskToken(token) {
  if (!token || typeof token !== 'string') return '***'
  return `[len:${token.length}]`
}

// 🔧 优先使用 IPv4，避免部分环境 IPv6 解析导致 fetch 失败
try {
  dns.setDefaultResultOrder('ipv4first')
} catch {}

// 🔥 加载环境变量（如果未设置）
if (!process.env.BOT_TOKEN) {
  // fallback: try load config/env next to repo root
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const configEnvPath = path.resolve(__dirname, '../config/env')
  if (fs.existsSync(configEnvPath)) {
    dotenv.config({ path: configEnvPath })
  }
}

if (!process.env.BOT_TOKEN) {
  console.error('BOT_TOKEN 未设置，请在根目录 .env 或 config/env 中提供 BOT_TOKEN')
  process.exit(1)
}

// 🔥 验证 token 格式
const BOT_TOKEN = process.env.BOT_TOKEN.trim()
if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN 为空，请检查环境变量配置')
  process.exit(1)
}

// Telegram bot token 格式：数字:字母数字组合（例如：123456789:ABCdefGHIjklMNOpqrsTUVwxyz）
const tokenPattern = /^\d+:[A-Za-z0-9_-]+$/
if (!tokenPattern.test(BOT_TOKEN)) {
  console.error('❌ BOT_TOKEN 格式无效！')
  console.error('   正确格式：数字:字母数字组合（例如：123456789:ABCdefGHIjklMNOpqrsTUVwxyz）')
  process.exit(1)
}

const BACKEND_URL = process.env.BACKEND_URL
// Only use proxy when PROXY_URL is explicitly provided
const PROXY_URL = process.env.PROXY_URL || ''
const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined

const bot = new Telegraf(BOT_TOKEN, {
  telegram: agent ? { agent } : undefined,
})

// 🔥 地址验证功能：每个群只确认一个地址

// 🔥 处理my_chat_member事件（直接在中间件中处理，避免监听器冲突）
bot.use(async (ctx, next) => {
  if (ctx.update?.my_chat_member) {
    console.log('[DEBUG] 收到my_chat_member update', {
      updateId: ctx.update.update_id,
      chatId: ctx.chat?.id,
      chatTitle: ctx.chat?.title,
      newStatus: ctx.update.my_chat_member.new_chat_member?.status,
      oldStatus: ctx.update.my_chat_member.old_chat_member?.status,
      hasFrom: !!ctx.update.my_chat_member.from,
      fromId: ctx.update.my_chat_member.from?.id,
      timestamp: new Date().toISOString()
    })

    // 🔥 直接在这里处理my_chat_member事件，避免监听器冲突
    try {
      const upd = ctx.update.my_chat_member
      const chat = ctx.chat

      if (!upd || !chat) {
        console.log('[MIDDLEWARE] my_chat_member 数据不完整，跳过处理')
        await next()
        return
      }

      const newStatus = upd.new_chat_member?.status
      const oldStatus = upd.old_chat_member?.status
      const chatId = String(chat.id)

      console.log('[MIDDLEWARE] 开始处理my_chat_member事件', {
        chatId,
        oldStatus,
        newStatus,
        hasFrom: !!upd.from
      })

      // 🔥 只有在真正的新加群情况下才处理（从外部状态进入群组）
      if ((newStatus === 'member' || newStatus === 'administrator') &&
          (oldStatus === 'left' || oldStatus === 'kicked' || !oldStatus)) {

        console.log('[MIDDLEWARE] 检测到机器人新加群事件，开始处理欢迎逻辑')

        try {
          // 获取当前机器人的ID
          const botId = await ensureCurrentBotId()

          // 1. 获取机器人的自定义欢迎消息
          const botRecord = await prisma.bot.findUnique({
            where: { id: botId },
            select: { welcomeMessage: true }
          })

          // 2. 获取非白名单提醒模板
          const latestSetting = await prisma.setting.findFirst({
            where: { chat: { botId }, nonWhitelistWelcomeMessage: { not: null } },
            select: { nonWhitelistWelcomeMessage: true }
          })

          // 3. 检查邀请人是否在白名单中
          let isWhitelisted = false
          if (upd.from?.id) {
            const whitelistedUser = await prisma.whitelistedUser.findUnique({
              where: { userId: String(upd.from.id) }
            })
            isWhitelisted = !!whitelistedUser
          }

          // 4. 准备变量替换
          const vars = {
            '{inviter}': upd.from?.username ? `@${upd.from.username}` : (upd.from?.first_name || '未知用户'),
            '{chat}': chat.title || '本群',
            '{id}': upd.from?.id ? String(upd.from.id) : '未知'
          };

          const replaceVars = (str) => {
            if (!str) return str;
            let out = str;
            for (const [k, v] of Object.entries(vars)) {
              out = out.split(k).join(v);
            }
            return out;
          };

          console.log('[MIDDLEWARE] 消息模板获取结果', {
            botId,
            hasCustomWelcome: !!botRecord?.welcomeMessage,
            hasCustomNonWhitelist: !!latestSetting?.nonWhitelistWelcomeMessage,
            isWhitelisted
          })

          let messageToSend = ''
          let messageType = ''

          if (isWhitelisted) {
            // 白名单用户：使用自定义欢迎消息
            const rawMsg = botRecord?.welcomeMessage || `✅ *机器人已激活*\n\n欢迎白名单用户！`
            messageToSend = replaceVars(rawMsg)
            messageType = '白名单欢迎消息'
          } else {
            // 非白名单用户：使用自定义提醒消息
            const customNonMsg = latestSetting?.nonWhitelistWelcomeMessage
            const defaultNonMsg = `🚫 *未授权警告*\n\n本群尚未授权。邀请人: {inviter} (ID: {id})`
            const rawMsg = customNonMsg || defaultNonMsg
            messageToSend = replaceVars(rawMsg)
            messageType = '非白名单提醒消息'
          }

          console.log(`[MIDDLEWARE] 准备发送${messageType}`, {
            rawMessage: messageToSend.substring(0, 100) + (messageToSend.length > 100 ? '...' : ''),
            messageType,
            isWhitelisted
          })

          // 发送消息
          await ctx.reply(messageToSend, { parse_mode: 'Markdown' }).catch(async () => {
            await ctx.reply(messageToSend)
          })

          console.log(`[MIDDLEWARE] ${messageType}发送成功`)

        } catch (e) {
          console.error('[MIDDLEWARE] 处理欢迎逻辑失败', e)
          // 降级：发送简单的默认消息
          try {
            await ctx.reply('✅ *机器人已激活*\n\n欢迎使用！', { parse_mode: 'Markdown' }).catch(async () => {
              await ctx.reply('✅ 机器人已激活\n\n欢迎使用！')
            })
          } catch (fallbackError) {
            console.error('[MIDDLEWARE] 降级消息也发送失败', fallbackError)
          }
        }
      } else {
        console.log('[MIDDLEWARE] 非新加群事件，跳过处理', { oldStatus, newStatus })
      }

    } catch (e) {
      console.error('[MIDDLEWARE] 处理my_chat_member事件出错', e)
    }
  }

  await next()
})

// 兜底：收到任何消息时，确保 chat 记录已 upsert 并绑定到当前机器人
bot.on('message', async (ctx, next) => {
  try {
    const chat = ctx.chat
    if (!chat) return await next()
    if (chat.type === 'channel') return
    const chatId = String(chat.id)
    const title = chat.title || ''
    const from = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.id
    const text = ctx.message?.text || ctx.message?.caption || '[非文本消息]'
    // 🔥 调试日志：仅在 DEBUG_BOT=true 时输出
    if (process.env.DEBUG_BOT === 'true') {
      console.log('[message][recv]', { chatId, title, from, text })
    }
    
    
    // 🔥 核心修复：检查当前发消息的人是否是白名单
    const userId = String(ctx.from?.id || '')
    const whitelistedUser = await prisma.whitelistedUser.findUnique({
      where: { userId }
    })
    const isWhitelisted = !!whitelistedUser
    
    const botId = await ensureCurrentBotId()
    
    const chatData = {
      title,
      botId
    }
    // 如果是白名单用户操作，强制提升群组权限
    if (isWhitelisted) {
      chatData.status = 'APPROVED'
      chatData.allowed = true
    }

      const chatResult = await prisma.chat.upsert({
            where: { id: chatId },
            create: {
              id: chatId,
        ...chatData,
        status: isWhitelisted ? 'APPROVED' : 'PENDING',
        allowed: isWhitelisted
            },
      update: chatData,
      }).catch((e) => {
        console.error('[message][chat-upsert-error]', e)
        return null
      })

      if (chatResult) {
        await prisma.setting.upsert({
          where: { chatId },
          create: { chatId, accountingEnabled: true }, // 🔥 默认开启记账
          update: {},
        }).catch((e) => {
          console.error('[message][setting-upsert-error]', e)
        })

      // 如果触发了自动授权，确保功能开关也同步开启，并发送欢迎消息
      if (isWhitelisted && String(chatId).startsWith('-')) {
        await ensureDefaultFeatures(chatId, prisma)

        // 检查是否已经发送过欢迎消息（避免重复发送）
        const existingChat = await prisma.chat.findUnique({
        where: { id: chatId },
          select: { status: true, invitedBy: true }
        })

        // 如果群组之前是PENDING状态，现在变成APPROVED，说明是刚授权的
        if (existingChat && existingChat.status === 'PENDING') {
          logger.info('[message] 检测到白名单用户触发自动授权，发送欢迎消息', { chatId, userId })

          try {
            // 获取机器人欢迎消息
            const botId = await ensureCurrentBotId()
            const botRecord = await prisma.bot.findUnique({
              where: { id: botId },
              select: { welcomeMessage: true }
            })

            const welcomeMsg = botRecord?.welcomeMessage || `✅ *机器人已激活*\n\n白名单用户操作，本群已自动授权。`
            const variables = {
              '{inviter}': ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || '用户'),
              '{chat}': title,
              '{id}': userId
            }

            const finalMsg = welcomeMsg.replace(/\{(\w+)\}/g, (match, key) => variables[`{${key}}`] || match)

            await ctx.reply(finalMsg, { parse_mode: 'Markdown' }).catch(() =>
              ctx.reply(finalMsg)
            )

            logger.info('[message] 白名单欢迎消息发送成功', { chatId, userId })
          } catch (e) {
            logger.error('[message] 发送白名单欢迎消息失败', { chatId, userId, error: e.message })
        }
        }
      }
    }
    
    // 🔥 调试日志：仅在 DEBUG_BOT=true 时输出
    if (process.env.DEBUG_BOT === 'true') {
      console.log('[message][upsert-ok]', { chatId })
    }
  } catch {}
  finally {
    try { await next() } catch {}
  }
})

// Resolve current Bot record by token to support multi-bot state separation
// 🔥 优化：使用安全token验证，避免明文比较
import { verifyBotToken, hashToken } from '../lib/token-security.js'

let CURRENT_BOT_ID = null
let BOT_ID_INITIALIZING = false // 防止并发初始化
async function ensureCurrentBotId() {
  // 🔥 如果已有缓存，直接返回
  if (CURRENT_BOT_ID) return CURRENT_BOT_ID

  // 🔥 如果正在初始化，等待完成
  if (BOT_ID_INITIALIZING) {
    let waitCount = 0
    while (BOT_ID_INITIALIZING && waitCount < 50) {
      await new Promise(resolve => setTimeout(resolve, 100))
      waitCount++
      if (CURRENT_BOT_ID) return CURRENT_BOT_ID
    }
  }

  // 🔥 开始初始化
  BOT_ID_INITIALIZING = true
  try {
    // 使用安全token验证
    const botId = await verifyBotToken(BOT_TOKEN)
    let row = botId ? { id: botId } : null
    
    if (!row) {
      // try to get bot username for friendly name
      let name = 'EnvBot'
      try {
        // 🔥 添加30秒超时处理
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('TIMEOUT')), 30000)
        })
        
        const me = await Promise.race([
          bot.telegram.getMe(),
          timeoutPromise
        ])
        
        name = me?.username ? `@${me.username}` : (me?.first_name || 'EnvBot')
      } catch (e) {
        // 🔥 特别处理 401 Unauthorized 错误
        if (e.response?.error_code === 401 || e.message?.includes('401') || e.message?.includes('Unauthorized')) {
          console.error('❌ Telegram Bot Token 无效或已过期！')
          console.error('   错误信息：401 Unauthorized')
          console.error('   可能原因：')
          console.error('   1. Bot token 已过期或被撤销')
          console.error('   2. Bot token 格式错误（可能有多余空格或换行符）')
          console.error('   3. Bot 已被禁用或删除')
          console.error('   请检查：')
          console.error('   - 数据库中的 token 是否正确')
          console.error('   - 环境变量 BOT_TOKEN 是否正确设置')
          console.error('   - 是否在 @BotFather 处重新生成了 token')
          throw new Error('Bot token 无效，无法启动机器人')
        }
        // 🔥 如果超时，记录错误但不阻止启动
        if (e.message === 'TIMEOUT') {
          console.error('⚠️ 链接Telegram API超时（30秒），请检查服务器网络连接')
        } else {
          console.error('[ensureCurrentBotId] 获取机器人信息失败:', e.message)
        }
      }
      // 🔥 安全：创建机器人时同时存储哈希token
      const tokenHash = await hashToken(BOT_TOKEN)
      row = await prisma.bot.create({
        data: { name, token: BOT_TOKEN, tokenHash, enabled: true },
        select: { id: true } // 🔥 只选择需要的字段
      })
    }
    CURRENT_BOT_ID = row.id
    return CURRENT_BOT_ID
  } finally {
    BOT_ID_INITIALIZING = false
  }
}

// 🔥 简化：使用模块中的函数
function ensureChat(ctx) {
  const chatId = ctx.chat?.id
  if (chatId == null) return null
  if (!CURRENT_BOT_ID) return null
  return getChat(CURRENT_BOT_ID, chatId)
}

// 🔥 已删除未使用的 ensureDbChatWithSync 函数，优化性能

// 🔥 所有重复函数已移至对应模块：
// - getOrCreateTodayBill, deleteLastIncome, deleteLastDispatch -> database.js
// - startOfDay, endOfDay, formatMoney, formatDuration -> utils.js
// - isAdmin, hasOperatorPermission -> helpers.js
// - isFeatureEnabled, ensureFeature -> middleware.js
// - isPublicUrl -> utils.js
// - fetchCoinGeckoRateUSDTtoCNY, fetchExchangeRateHostUSDToCNY, fetchRealtimeRateUSDTtoCNY -> helpers.js
// - buildInlineKb -> helpers.js
// - formatSummary -> formatting.js

// Helpers to extract @username from text
function extractMention(text) {
  const m = text?.match(/@([A-Za-z0-9_]{5,})/) // Telegram username rules (len>=5)
  return m ? `@${m[1]}` : null
}

// 🔥 核心命令（bot.start）已移至 handlers/core.js，只保留 /start 命令

// /help 别名（与"使用说明"一致）
// 审批中间件：群组需后台审批通过（Chat.status === 'APPROVED'）后才允许普通指令
// 简易告警节流：每个群 60s 内只提醒一次
const LAST_WARN_AT = new Map() // chatId -> ts
function shouldWarnNow(chatId) {
  const now = Date.now()
  const prev = LAST_WARN_AT.get(chatId) || 0
  if (now - prev < 60_000) return false
  LAST_WARN_AT.set(chatId, now)
  return true
}

// 将图片/视频 caption 中的记账与上下课命令提升为 text，复用现有命令处理链路
bot.use(async (ctx, next) => {
  promoteCaptionToText(ctx)
  return next()
})

bot.use(async (ctx, next) => {
  // 🔥 如果是回调查询（callback_query），直接放行，让 action 处理
  if (ctx.update.callback_query) {
    return next()
  }
  
  if (!ctx.chat) return next()
  // 忽略频道类更新，机器人只服务群/超群
  if (ctx.chat.type === 'channel') {
    return
  }
  const text = ctx.message?.text || ''
  // 记录说话者的 userId 映射，若其 @username 在操作员列表中，则收集其 userId
  const chatState = ensureChat(ctx)
  try {
    if (chatState && ctx.from?.id) {
      const uname = ctx.from?.username ? `@${ctx.from.username}` : null
      if (uname) {
        if (chatState.userIdByUsername.size > 5000) {
          const it = chatState.userIdByUsername.keys()
          const first = it.next().value
          if (first) chatState.userIdByUsername.delete(first)
        }
        chatState.userIdByUsername.set(uname, ctx.from.id)
      }
      if (uname && chatState.operators.has(uname)) chatState.operatorIds.add(ctx.from.id)
    }
  } catch {}
  // 🔥 私聊：允许使用部分命令，但大部分功能需要通过内联菜单
  if (ctx.chat.type === 'private') {
    // 允许的命令：/start(含参数), /myid, /我, /help, 使用说明
    const allowedInPrivate = /^(?:\/start(?:\s+\S+)?|\/myid|\/我|\/help|使用说明|查看业务员(?:设置)?|设置业务员(?:\s+.+)?|删除业务员(?:\s+.+)?|清空业务员|设置业务员展示(?:\s+.+)?|查看订阅配置|设置订阅地址\s+\S+|设置订阅单价\s+\d+(?:\.\d+)?|设置试用天数\s+\d+|设置群到期\s+-?\d+\s+\d{4}-\d{2}-\d{2}|延长群到期\s+-?\d+\s+\d+)$/i.test(text)
    const userId = String(ctx.from?.id || '')
    const allowPendingInput = hasPendingUserInput(userId)
    if (!allowedInPrivate && !text.includes('我的账单') && !allowPendingInput) {
      // 对于其他命令，不回复（避免频繁提示），让用户使用内联菜单
      return
    }
    // 私聊不走绑定/允许校验，直接继续处理
    return next()
  }
  const botId = await ensureCurrentBotId()
  const chatId = await ensureDbChat(ctx, chatState)
  const dbChat = await prisma.chat.findUnique({ where: { id: chatId }, select: { botId: true, allowed: true, bot: { select: { id: true, token: true } } } })
  const bypass = /^(?:\/start|\/myid|显示账单|\+0|使用说明)$/i.test(text)
  const currentToken = BOT_TOKEN
  const boundToken = (dbChat?.bot?.token || '').trim()
  // 🔥 调试日志：仅在 DEBUG_BOT=true 时输出
  if (process.env.DEBUG_BOT === 'true') {
    try {
      const mask = (s) => (s ? `${s.slice(0,4)}...${s.slice(-4)}` : '')
      console.log('[bind-check]', {
        chatId,
        botId,
        dbBotId: dbChat?.botId || null,
        allowed: !!dbChat?.allowed,
        currentToken4: maskToken(currentToken),
        boundToken4: maskToken(boundToken),
      })
    } catch {}
  }
  const notBound = !dbChat?.botId || (boundToken ? boundToken !== currentToken : (dbChat?.botId !== botId))
  // 仅对文本消息给出提醒，且加频率限制，避免 429
  if (notBound) {
    if (!text) return // 非文本（如转发/图片等）不提醒
    if (!shouldWarnNow(chatId)) return
    const msg = '本群尚未在后台绑定当前机器人，请联系管理员到后台绑定后再使用。'
    try { await ctx.reply(msg) } catch {}
    return
  }
  if (!dbChat?.allowed) {
    if (!text) return
    if (!shouldWarnNow(chatId)) return
    // 获取自定义的未授权提示消息
    let msg = '本群尚未被后台允许使用，请联系管理员在后台将本群设置为允许后再使用。'
    try {
      const settings = await prisma.setting.findUnique({
        where: { chatId },
        select: { authPromptMessage: true, showAuthPrompt: true }
      })
      if (settings?.authPromptMessage?.trim()) {
        msg = settings.authPromptMessage.trim()
      }
      // 检查是否应该显示提示
      if (settings?.showAuthPrompt === false) {
        return
      }
    } catch (e) {
      // 如果查询失败，使用默认消息
    }
    try { await ctx.reply(msg) } catch {}
    return
  }

  // 订阅到期拦截：除“订阅状态 / 续费”外，群内功能全部停用
  try {
    const subBypass = /^(?:订阅状态|续费\s+\d+\s+[A-Fa-f0-9]{64})$/i.test(text || '')
    if (!subBypass) {
      const subscription = await getChatSubscriptionStatus(chatId)
      if (!subscription.active) {
        const cfg = await getSubscriptionConfig()
        const renewalGuide = cfg.receiveAddress
          ? `请向地址 ${cfg.receiveAddress} 转账后发送：续费 天数 交易哈希`
          : '管理员尚未配置收款地址，请联系管理员处理续费。'
        try {
          await ctx.reply(
            `⛔ 当前群订阅已到期，功能已暂停。\n` +
            `到期时间：${formatSubscriptionExpiry(subscription.expiresAt)}\n` +
            `续费单价：${cfg.usdtPerDay} USDT/天\n` +
            `${renewalGuide}\n` +
            `你也可以发送“订阅状态”查看详情。`
          )
        } catch {}
        return
      }
    }
  } catch (e) {
    console.error('[subscription-check][error]', e)
  }

  return next()
})

// ===== 自定义指令触发（按 bot 维度） =====
const CUSTOM_CMDS_CACHE = {
  map: null, // Record<string, { text?: string; imageUrl?: string }>
  ts: 0,
}

async function loadCustomCommandsForBot(botId) {
  // 5分钟缓存
  const now = Date.now()
  if (CUSTOM_CMDS_CACHE.map && now - CUSTOM_CMDS_CACHE.ts < 5 * 60 * 1000) return CUSTOM_CMDS_CACHE.map
  try {
    const key = `customcmds:bot:${botId}`
    const row = await prisma.globalConfig.findUnique({ where: { key } })
    let map = {}
    if (row?.value) {
      try { map = JSON.parse(String(row.value) || '{}') } catch {}
    }
    CUSTOM_CMDS_CACHE.map = map
    CUSTOM_CMDS_CACHE.ts = now
    return map
  } catch {
    return {}
  }
}

bot.on('text', async (ctx, next) => {
  try {
    const text = (ctx.message?.text || '').trim()
    if (!text) return next()
    const botId = await ensureCurrentBotId()
    const map = await loadCustomCommandsForBot(botId)
    if (!map || typeof map !== 'object') return next()
    const key = text.toLowerCase()
    const item = map[key]
    if (!item) return next()

    const chatId = String(ctx.chat?.id || '')
    // 简洁日志（命中）
    console.log('[customcmd][hit]', { chatId, name: key })

    if (item.imageUrl && item.text) {
      await ctx.replyWithPhoto(item.imageUrl, { caption: item.text })
      return
    } else if (item.imageUrl) {
      await ctx.replyWithPhoto(item.imageUrl)
      return
    } else if (item.text) {
      await ctx.reply(item.text)
      return
    }
    return next()
  } catch (e) {
    console.error('[customcmd][error]', e?.message || e)
    return next()
  }
})

// 🔥 注册所有命令处理器（模块化）
registerAllHandlers(bot, ensureChat)

// 🔥 注册成员变动处理器（统一管理机器人进出群）- 放在最后，确保不被覆盖
import { registerMemberHandlers } from './handlers/member-handler.js'
registerMemberHandlers(bot)

// 🔥 使用模块化的权限检查中间件（减少代码，提升性能）
bot.use(createPermissionMiddleware())


// 全局错误捕获：被群踢出等错误时避免进程退出
bot.catch(async (err, ctx) => {
  try {
    const code = err?.response?.error_code
    const desc = err?.response?.description || ''
    const chatId = String(ctx?.chat?.id || '')
    if (code === 403 && /kicked/i.test(desc)) {
      // 被移除群：删除该群记录
      if (chatId) {
        await prisma.operator.deleteMany({ where: { chatId } }).catch(() => {})
        await prisma.setting.deleteMany({ where: { chatId } }).catch(() => {})
        await prisma.chat.delete({ where: { id: chatId } }).catch(() => {})
      }
      return
    }
    // 429 等错误仅记录
    if (code === 429) return
  } catch {}
})

// 监听机器人在群内的成员状态变化：如被踢/离开则删除记录

// --- 定时任务 ---

// 汇率更新
async function updateAllRealtimeRates() {
  try {
    const { getOKXC2CSellers } = await import('../lib/okx-api.js')
    const sellers = await getOKXC2CSellers('all')
    if (!sellers || sellers.length === 0) return
    const okxRate = sellers[0].price

    // 修改这里：先尝试批量更新，如果失败则执行单个更新
    try {
      await prisma.setting.updateMany({
        where: { fixedRate: null },
        data: { realtimeRate: okxRate }
      })
    } catch (writeError) {
      console.error('[定时任务] 批量更新失败，尝试逐个更新:', writeError.message)

      // 容错：逐个更新逻辑
      const allSettings = await prisma.setting.findMany({
        where: { fixedRate: null },
          select: { chatId: true }
        })

      for (const s of allSettings) {
            await prisma.setting.update({
          where: { chatId: s.chatId },
              data: { realtimeRate: okxRate }
        }).catch(() => {}) // 忽略单个失败
      }
    }

    if (process.env.DEBUG_BOT === 'true') {
        logger.debug(`[定时任务] 汇率更新成功: ${okxRate}`)
    }
  } catch (e) {
    logger.error('[定时任务] 汇率更新失败', e)
  }
}

// 自动日切
  const autoDailyCutoffTask = async () => {
    try {
    // 传入获取聊天状态的回调
      await performAutoDailyCutoff((botId, chatId) => {
        return getChat(botId || BOT_TOKEN, chatId)
      })
    } catch (e) {
    logger.error('[定时任务] 自动日切检查失败', e)
    }
  }
  
// 启动机器人，明确指定允许的更新类型以确保接收chat_member事件
bot.launch({
  allowedUpdates: [
    'message',
    'edited_message',
    'channel_post',
    'edited_channel_post',
    'inline_query',
    'chosen_inline_result',
    'callback_query',
    'shipping_query',
    'pre_checkout_query',
    'poll',
    'poll_answer',
    'my_chat_member',
    'chat_member',
    'chat_join_request'
  ]
}).then(async () => {
  console.info('✅ Telegram 机器人已启动')
  await ensureCurrentBotId(bot) // 初始化机器人ID

  // 立即执行一次任务
  updateAllRealtimeRates()
  autoDailyCutoffTask()

  // 启动定时器
  setInterval(updateAllRealtimeRates, 10 * 60 * 1000) // 10分钟更新汇率
  setInterval(autoDailyCutoffTask, 10 * 60 * 1000) // 10分钟检查日切
  setInterval(cleanupInactiveChats, 30 * 60 * 1000) // 30分钟清理内存

  // 设置指令菜单 (仅私聊)
  const commands = [{ command: 'start', description: '开始使用' }]
    await bot.telegram.setMyCommands(commands, { scope: { type: 'all_private_chats' } })
  await bot.telegram.setMyCommands([], { scope: { type: 'all_group_chats' } }) // 群聊清除菜单

}).catch((err) => {
  console.error('❌ 机器人启动失败', err)
  process.exit(1)
})

// 优雅退出
const cleanup = () => bot.stop('SIGTERM')
process.once('SIGTERM', cleanup)
process.once('SIGINT', cleanup)
