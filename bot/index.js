// Minimal Telegraf bot with Chinese commands and local proxy support
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'


import { Telegraf, Markup } from 'telegraf'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getChat, safeCalculate, cleanupInactiveChats } from './state.js'
import { prisma } from '../lib/db.ts'
import { ensureDefaultFeatures } from './constants.ts'
import { 
  getGlobalDailyCutoffHour, 
  formatMoney, 
  formatDuration
} from './utils.js'
// 新模块导入
import { ensureDbChat, updateSettings, syncSettingsToMemory, getOrCreateTodayBill, checkAndClearIfNewDay, performAutoDailyCutoff } from './database.js'
import { createPermissionMiddleware, isAccountingCommand, clearFeatureCache } from './middleware.js'
import { buildInlineKb, fetchRealtimeRateUSDTtoCNY, hasOperatorPermission, getUsername, isAdmin } from './helpers.js'
import { formatSummary } from './formatting.js'
import { registerAllHandlers } from './handlers/index.js'

const BOT_TOKEN = process.env.BOT_TOKEN
if (!BOT_TOKEN) {
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

const BACKEND_URL = process.env.BACKEND_URL
// Only use proxy when PROXY_URL is explicitly provided
const PROXY_URL = process.env.PROXY_URL || ''
const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined

const bot = new Telegraf(process.env.BOT_TOKEN, {
  telegram: agent ? { agent } : undefined,
})

// 🔥 地址验证功能：每个群只确认一个地址
async function handleAddressVerificationNew(ctx) {
  try {
    const chatId = String(ctx.chat.id)
    const text = ctx.message?.text || ''
    
    // 检测钱包地址格式
    const addressPatterns = [
      /\b(T[A-Za-z1-9]{33})\b/g,  // TRC20
      /\b(0x[a-fA-F0-9]{40})\b/g, // ERC20
      /\b([13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g, // BTC Legacy
      /\b(bc1[a-z0-9]{39,59})\b/g, // BTC SegWit
    ]
    
    let detectedAddress = null
    for (const pattern of addressPatterns) {
      const match = text.match(pattern)
      if (match) {
        detectedAddress = match[0]
        break
      }
    }
    
    if (!detectedAddress) return false
    
    // 检查是否启用了地址验证功能
    const setting = await prisma.setting.findUnique({
      where: { chatId },
      select: { addressVerificationEnabled: true }
    })
    
    if (!setting?.addressVerificationEnabled) return false
    
    const address = detectedAddress
    const senderId = String(ctx.from.id)
    const senderName = ctx.from.username ? `@${ctx.from.username}` : 
                       (ctx.from.first_name || ctx.from.last_name) ? 
                       `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() :
                       senderId
    
    // 查询该群的地址验证记录（每个群只有一条记录）
    let record = await prisma.addressVerification.findUnique({
      where: { chatId }
    })
    
    if (!record) {
      // 第一次发送地址
      // 🔥 获取完整Telegram名称（first_name + last_name）
      const fullName = (ctx.from.first_name || '') + (ctx.from.last_name ? ' ' + ctx.from.last_name : '') || senderName
      
      await prisma.addressVerification.create({
        data: {
          chatId,
          confirmedAddress: address,
          confirmedCount: 1,
          lastSenderId: senderId,
          lastSenderName: fullName
        }
      })
      
      const replyText = `🔐 *此地址已加入安全验证*\n\n` +
        `📍 验证地址：\`${address}\`\n` +
        `🔢 验证次数：*1*\n` +
        `👤 发送人：${fullName}`
      
      await ctx.reply(replyText, {
        parse_mode: 'Markdown',
        reply_to_message_id: ctx.message.message_id
      })
      
      if (process.env.DEBUG_BOT === 'true') {
        console.log('[address-verification-new][first-time]', { chatId, address, senderId })
      }
      return true
    }
    
    // 已有记录
    const confirmedAddr = record.confirmedAddress
    const pendingAddr = record.pendingAddress
    
    if (address === confirmedAddr) {
      // 发送的是已确认的地址
      const newCount = record.confirmedCount + 1
      // 🔥 获取用户名（优先）或完整名称
      const currentUsername = ctx.from.username ? `@${ctx.from.username}` : null
      const currentFullName = (ctx.from.first_name || '') + (ctx.from.last_name ? ' ' + ctx.from.last_name : '') || senderId
      const currentDisplay = currentUsername || currentFullName
      
      await prisma.addressVerification.update({
        where: { chatId },
        data: {
          confirmedCount: newCount,
          lastSenderId: senderId,
          lastSenderName: currentDisplay,
          updatedAt: new Date()
        }
      })
      
      const replyText = `✅ *地址验证通过*\n\n` +
        `📍 验证地址：\`${address}\`\n` +
        `🔢 验证次数：*${newCount}*\n` +
        `📤 上次发送人：${record.lastSenderName || record.lastSenderId}\n` +
        `📤 本次发送人：${currentDisplay}`
      
      await ctx.reply(replyText, {
        parse_mode: 'Markdown',
        reply_to_message_id: ctx.message.message_id
      })
      
      if (process.env.DEBUG_BOT === 'true') {
        console.log('[address-verification-new][confirmed-address]', { chatId, address, count: newCount })
      }
      return true
    }
    
    if (address === pendingAddr) {
      // 发送的是待确认的地址（第2次发送新地址）
      const newCount = record.pendingCount + 1
      
      // 🔥 获取用户名（优先）或完整名称
      const currentUsername = ctx.from.username ? `@${ctx.from.username}` : null
      const currentFullName = (ctx.from.first_name || '') + (ctx.from.last_name ? ' ' + ctx.from.last_name : '') || senderId
      const currentDisplay = currentUsername || currentFullName
      
      // 🔥 第2次发送待确认地址，将其升级为确认地址
      await prisma.addressVerification.update({
        where: { chatId },
        data: {
          confirmedAddress: address,
          confirmedCount: newCount,
          pendingAddress: null,
          pendingCount: 0,
          lastSenderId: senderId,
          lastSenderName: currentDisplay,
          updatedAt: new Date()
        }
      })
      
      const replyText = `✅ *地址验证通过*\n\n` +
        `📍 验证地址：\`${address}\`\n` +
        `🔢 验证次数：*${newCount}*\n` +
        `📤 上次发送人：${record.lastSenderName || record.lastSenderId}\n` +
        `📤 本次发送人：${currentDisplay}`
      
      await ctx.reply(replyText, {
        parse_mode: 'Markdown',
        reply_to_message_id: ctx.message.message_id
      })
      
      if (process.env.DEBUG_BOT === 'true') {
        console.log('[address-verification-new][pending-confirmed]', { chatId, address, newCount })
      }
      return true
    }
    
    // 🔥 发送的是新地址（不同于确认地址和待确认地址）
    // 发出警告，并将新地址设为待确认地址
    
    // 🔥 获取当前发送人的信息
    const currentSenderUsername = ctx.from.username ? `@${ctx.from.username}` : null
    const currentSenderFullName = (ctx.from.first_name || '') + (ctx.from.last_name ? ' ' + ctx.from.last_name : '').trim() || senderId
    const currentSenderDisplay = currentSenderUsername || currentSenderFullName || senderId
    
    // 🔥 查询之前发送人的信息
    // 如果之前记录的是用户名，直接使用；如果是ID或名称，尝试查找用户名
    let previousSenderUsername = null
    let previousSenderFullName = '未知'
    
    // 从记录中获取之前的发送人名称
    if (record.lastSenderName) {
      // 如果之前保存的是用户名格式（@开头），则直接使用
      if (record.lastSenderName.startsWith('@')) {
        previousSenderUsername = record.lastSenderName
        // 需要查询该用户的实际名称（从数据库或缓存）
        previousSenderFullName = record.lastSenderName // 暂时使用用户名
      } else {
        // 如果之前保存的是Telegram名称，使用它
        previousSenderFullName = record.lastSenderName
      }
    }
    
    // 🔥 如果之前的发送人ID存在且不同，尝试从聊天记录中查找用户名
    if (record.lastSenderId && record.lastSenderId !== senderId && !previousSenderUsername) {
      const chat = getChat(await ensureCurrentBotId(), chatId)
      if (chat && chat.userIdByUsername) {
        // 从缓存中查找该ID对应的用户名
        for (const [uname, uid] of chat.userIdByUsername.entries()) {
          if (String(uid) === record.lastSenderId) {
            previousSenderUsername = uname
            break
          }
        }
      }
    }
    
    const previousSenderDisplay = previousSenderUsername || previousSenderFullName || record.lastSenderId || '未知'
    
    // 🔥 保存当前发送人的用户名（如果有）或完整名称
    await prisma.addressVerification.update({
      where: { chatId },
      data: {
        pendingAddress: address,
        pendingCount: 1,
        lastSenderId: senderId,
        lastSenderName: currentSenderUsername || currentSenderFullName, // 优先保存用户名
        updatedAt: new Date()
      }
    })
    
    const replyText = `⚠️⚠️⚠️*温馨提示*⚠️⚠️⚠️\n\n` +
      `❗️此地址和原地址不一样请小心交易❗️\n\n` +
      `🆔还想隐藏: \`${senderId}\`\n` +
      `🚹修改前名称：${previousSenderFullName}\n` +
      `🚺修改后名称：${currentSenderFullName}\n\n` +
      `📍新地址：\`${address}\`\n` +
      `📍原地址：\`${confirmedAddr || '无'}\`\n\n` +
      `🔢验证次数：0\n` +
      `📤上次发送人：${previousSenderDisplay}\n` +
      `📤本次发送人：${currentSenderDisplay}`
    
    await ctx.reply(replyText, {
      parse_mode: 'Markdown',
      reply_to_message_id: ctx.message.message_id
    })
    
    if (process.env.DEBUG_BOT === 'true') {
      console.log('[address-verification-new][warning-new-address]', { 
        chatId, 
        oldAddress: confirmedAddr, 
        newAddress: address,
        senderId 
      })
    }
    return true
    
  } catch (error) {
    console.error('[address-verification-new][error]', error)
    return false
  }
}

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
    
    // 🔥 地址验证功能 - 优先处理（使用新版本逻辑）
    if (ctx.message?.text && chatId.startsWith('-')) {
      const handled = await handleAddressVerificationNew(ctx)
      if (handled) {
        // 地址验证已处理，不继续执行后续逻辑
        return
      }
    }
    
    // 🔥 检查群组是否存在，如果不存在或未绑定，尝试补充白名单检测
    const existingChat = await prisma.chat.findUnique({ 
      where: { id: chatId },
      select: { id: true, allowed: true, botId: true }
    })
    
    const botId = await ensureCurrentBotId()
    
    // 如果群组不存在，或者未授权且未绑定机器人，尝试检测白名单
    if (!existingChat || (!existingChat.allowed && !existingChat.botId)) {
      // 🔥 备用白名单检测：从消息发送者检查
      // 获取群成员列表，找出可能的邀请人
      try {
        const userId = String(ctx.from?.id || '')
        const username = ctx.from?.username ? `@${ctx.from.username}` : null
        
        // 检查当前消息发送者是否在白名单中
        if (userId) {
          const whitelistedUser = await prisma.whitelistedUser.findUnique({
            where: { userId }
          })
          
          if (whitelistedUser) {
            // 找到白名单用户，自动授权该群组
            console.log('[message][whitelist-detected]', { chatId, userId, username })
            
            // 🔥 如果用户名不同，更新白名单记录中的用户名
            if (username && username !== whitelistedUser.username) {
              await prisma.whitelistedUser.update({
                where: { userId },
                data: { username }
              }).catch((e) => {
                if (process.env.DEBUG_BOT === 'true') {
                  console.error('[message][username-update-error]', e)
                }
              })
              if (process.env.DEBUG_BOT === 'true') {
                console.log('[message][username-updated]', { userId, oldUsername: whitelistedUser.username, newUsername: username })
              }
            }
            
            // ⚠️ 不在这里创建邀请记录，避免与 my_chat_member 事件重复
            // 邀请记录只在 my_chat_member 事件中创建
            
            // 自动授权
            await prisma.chat.upsert({
              where: { id: chatId },
              create: { 
                id: chatId, 
                title, 
                botId,
                status: 'APPROVED', 
                allowed: true 
              },
              update: { 
                title,
                botId,
                status: 'APPROVED',
                allowed: true
              },
            })
            
            // 🔥 自动开启所有功能开关（备用白名单检测）
            await ensureDefaultFeatures(chatId, prisma)
            
            console.log('[message][auto-authorized]', { chatId, userId })
          } else {
            // 非白名单用户
            await prisma.chat.upsert({
              where: { id: chatId },
              create: { id: chatId, title, botId, status: 'PENDING', allowed: false },
              update: { title, botId },
            })
          }
        } else {
          await prisma.chat.upsert({
            where: { id: chatId },
            create: { id: chatId, title, status: 'PENDING', allowed: false },
            update: { title },
          })
        }
      } catch (e) {
        console.error('[message][whitelist-check-error]', e)
        await prisma.chat.upsert({
          where: { id: chatId },
          create: { id: chatId, title, status: 'PENDING', allowed: false },
          update: { title },
        })
      }
    } else {
      // 群组已存在，仅更新标题
      await prisma.chat.update({
        where: { id: chatId },
        data: { title }
      }).catch((e) => {
        if (process.env.DEBUG_BOT === 'true') {
          console.error('[message][title-update-error]', { chatId, error: e.message })
        }
      })
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
// 🔥 优化：使用更可靠的缓存，避免重复查询
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
    // Try find bot by token; if missing, create a minimal record
    let row = await prisma.bot.findFirst({ 
      where: { token: process.env.BOT_TOKEN },
      select: { id: true } // 🔥 只选择需要的字段
    }).catch(() => null)
    
    if (!row) {
      // try to get bot username for friendly name
      let name = 'EnvBot'
      try {
        const me = await bot.telegram.getMe()
        name = me?.username ? `@${me.username}` : (me?.first_name || 'EnvBot')
      } catch {}
      row = await prisma.bot.create({ 
        data: { name, token: process.env.BOT_TOKEN, enabled: true },
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

// 🔥 简化：使用数据库模块，自动同步设置
async function ensureDbChatWithSync(ctx) {
  const chat = ensureChat(ctx)
  const chatId = await ensureDbChat(ctx, chat)
  
  // 🔥 修复：确保实时汇率从数据库同步到内存（优先从数据库加载）
  // syncSettingsToMemory 已经会同步实时汇率，这里做兜底检查
  if (chat && !chat.fixedRate && !chat.realtimeRate) {
    try {
      // 从数据库读取实时汇率（启动时的更新任务已经更新了数据库）
      const setting = await prisma.setting.findUnique({
        where: { chatId },
        select: { fixedRate: true, realtimeRate: true }
      })
      
      if (setting?.realtimeRate && !setting?.fixedRate) {
        chat.realtimeRate = setting.realtimeRate
        if (process.env.DEBUG_BOT === 'true') {
          console.log('[ensureDbChatWithSync] 实时汇率已加载', { chatId, rate: setting.realtimeRate })
        }
      } else if (!setting?.fixedRate) {
        // 数据库也没有，主动获取并保存
        const { fetchRealtimeRateUSDTtoCNY } = await import('./helpers.js')
        const rate = await fetchRealtimeRateUSDTtoCNY()
        if (rate) {
          chat.realtimeRate = rate
          await updateSettings(chatId, { realtimeRate: rate })
          if (process.env.DEBUG_BOT === 'true') {
            console.log('[ensureDbChatWithSync] 实时汇率已获取并保存', { chatId, rate })
          }
        }
      }
    } catch (e) {
      // 静默失败
      if (process.env.DEBUG_BOT === 'true') {
        console.error('[ensureDbChatWithSync] 汇率同步失败', e)
      }
    }
  }
  
  return chatId
}

// 🔥 所有重复函数已移至对应模块：
// - getOrCreateTodayBill, getHistoricalNotDispatched, deleteLastIncome, deleteLastDispatch -> database.js
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

// /help 别名（与“使用说明”一致）
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
  try {
    const chat = ensureChat(ctx)
    if (chat && ctx.from?.id) {
      const uname = ctx.from?.username ? `@${ctx.from.username}` : null
      if (uname) chat.userIdByUsername.set(uname, ctx.from.id)
      if (uname && chat.operators.has(uname)) chat.operatorIds.add(ctx.from.id)
    }
  } catch {}
  // 🔥 私聊：允许使用部分命令，但大部分功能需要通过内联菜单
  if (ctx.chat.type === 'private') {
    // 允许的命令：/start, /myid, /我, /help, 使用说明
    const allowedInPrivate = /^(?:\/start|\/myid|\/我|\/help|使用说明)$/i.test(text)
    if (!allowedInPrivate && !text.includes('我的账单')) {
      // 对于其他命令，不回复（避免频繁提示），让用户使用内联菜单
      return
    }
    // 对于允许的命令，继续处理（不在这里 return）
  }
  const botId = await ensureCurrentBotId()
  const chatId = await ensureDbChat(ctx)
  const dbChat = await prisma.chat.findUnique({ where: { id: chatId }, select: { botId: true, allowed: true, bot: { select: { id: true, token: true } } } })
  const bypass = /^(?:\/start|\/myid|显示账单|\+0|使用说明)$/i.test(text)
  const currentToken = (process.env.BOT_TOKEN || '').trim()
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
        currentToken4: mask(currentToken),
        boundToken4: mask(boundToken),
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
    const msg = '本群尚未被后台允许使用，请联系管理员在后台将本群设置为允许后再使用。'
    try { await ctx.reply(msg) } catch {}
    return
  }
  return next()
})

// 机器人成员状态变更：加入/被移除群
bot.on('my_chat_member', async (ctx) => {
  try {
    const upd = ctx.update?.my_chat_member
    const chat = ctx.chat
    if (!upd || !chat) return
    const newStatus = upd.new_chat_member?.status
    const oldStatus = upd.old_chat_member?.status
    const chatId = String(chat.id)
    const title = chat.title || ''
    const botId = await ensureCurrentBotId()
    const inviterId = String(upd.from?.id || '')
    const inviterUsername = upd.from?.username ? `@${upd.from.username}` : null
    
    console.log('[my_chat_member]', {
      botId,
      chatId,
      title,
      inviterId,
      inviterUsername,
      from: upd.from?.username ? `@${upd.from.username}` : upd.from?.id,
      old: oldStatus,
      new: newStatus,
    })
    
    if (newStatus === 'member' || newStatus === 'administrator') {
      // 🔥 只有当旧状态不是 member/administrator 时才是新加入（邀请）
      // 避免重新设置为管理员等操作被误判为邀请
      const isNewJoin = !oldStatus || oldStatus === 'left' || oldStatus === 'kicked'
      
      if (!isNewJoin) {
        console.log('[my_chat_member][not-new-join]', { oldStatus, newStatus, chatId })
        // 仅更新群组信息，不记录邀请
        await prisma.chat.update({
          where: { id: chatId },
          data: { title, botId }
        }).catch(() => {})
        return
      }
      
      // 🔥 检查邀请人是否在白名单中
      let autoAllowed = false
      let isWhitelisted = false
      
      if (inviterId) {
        const whitelistedUser = await prisma.whitelistedUser.findUnique({
          where: { userId: inviterId }
        })
        
        if (whitelistedUser) {
          isWhitelisted = true
          autoAllowed = true
          console.log('[my_chat_member][whitelisted]', { inviterId, inviterUsername, chatId })
          
          // 🔥 如果用户名不同，更新白名单记录中的用户名
          if (inviterUsername && inviterUsername !== whitelistedUser.username) {
            await prisma.whitelistedUser.update({
              where: { userId: inviterId },
              data: { username: inviterUsername }
            }).catch(() => {})
            console.log('[my_chat_member][username-updated]', { inviterId, oldUsername: whitelistedUser.username, newUsername: inviterUsername })
          }
        } else {
          console.log('[my_chat_member][not-whitelisted]', { inviterId, inviterUsername, chatId })
        }
      }
      
      // 🔥 邀请记录功能已删除
      
      // Upsert chat，如果邀请人在白名单，自动设置 allowed=true
      const res = await prisma.chat.upsert({
        where: { id: chatId },
        create: { 
          id: chatId, 
          title, 
          botId, 
          status: autoAllowed ? 'APPROVED' : 'PENDING', 
          allowed: autoAllowed 
        },
        update: { 
          title, 
          botId,
          status: autoAllowed ? 'APPROVED' : undefined,
          allowed: autoAllowed ? true : undefined
        },
      })
      
      console.log('[my_chat_member][upsert-result]', { 
        chatId,
        res: { id: res.id, allowed: res.allowed, status: res.status, botId: res.botId },
        autoAllowed,
        isWhitelisted 
      })
      
      await prisma.setting.upsert({
        where: { chatId },
        update: {},
        create: { 
          chatId,
          addressVerificationEnabled: false  // 🔥 新建群默认不开启地址验证
        },
      })
      
      // 🔥 如果是白名单用户，自动开启所有功能开关（但不包括地址验证）
      if (autoAllowed) {
        // 🔥 使用 force=true 确保所有功能都被启用
        const featuresCreated = await ensureDefaultFeatures(chatId, prisma, true)
        console.log('[my_chat_member] 功能开关已启用', { chatId, featuresCreated })
        
        // 🔥 再次确保所有功能开关都是启用状态（双重保险）
        await prisma.chatFeatureFlag.updateMany({
          where: { chatId },
          data: { enabled: true }
        }).catch((e) => {
          console.error('[my_chat_member] 强制启用功能开关失败', { chatId, error: e.message })
        })
        
        // 🔥 验证所有功能都已启用
        const verifyFlags = await prisma.chatFeatureFlag.findMany({
          where: { chatId },
          select: { feature: true, enabled: true }
        })
        console.log('[my_chat_member] 功能开关验证', { 
          chatId, 
          total: verifyFlags.length, 
          enabled: verifyFlags.filter(f => f.enabled).length,
          disabled: verifyFlags.filter(f => !f.enabled).map(f => f.feature)
        })
        
        // 🔥 确保地址验证保持关闭（新建群默认关闭）
        await prisma.setting.update({
          where: { chatId },
          data: { addressVerificationEnabled: false }
        }).catch(() => {})
        
        // 发送欢迎消息
        try {
          await ctx.reply(
            `✅ 欢迎使用记账机器人！\n\n` +
            `您已被自动授权使用，所有功能已启用。\n` +
            `邀请人：${inviterUsername || inviterId}\n\n` +
            `发送 "开始记账" 或 "使用说明" 查看使用指南。\n\n` +
            `⚠️ 提示：如果机器人无响应，请：\n` +
            `1. 将机器人设为管理员，或\n` +
            `2. 找 @BotFather 发送 /setprivacy 选择 Disable`
          )
        } catch (e) {
          console.error('[welcome-msg][error]', e)
        }
      } else {
        // 非白名单用户，提示需要审核
        try {
          await ctx.reply(
            `👋 机器人已加入群组！\n\n` +
            `⚠️ 当前需要管理员审核才能使用。\n` +
            `邀请人：${inviterUsername || inviterId}\n\n` +
            `请联系管理员到后台批准本群使用。\n\n` +
            `💡 提示：如果您希望自动授权，请联系管理员将您的用户ID添加到白名单。\n` +
            `您的用户ID：\`${inviterId}\``,
            { parse_mode: 'Markdown' }
          )
        } catch (e) {
          console.error('[pending-msg][error]', e)
        }
      }
      
      console.log('[my_chat_member][completed]', { 
        botId, 
        chatId, 
        title, 
        inviterId,
        inviterUsername,
        autoAllowed,
        isWhitelisted,
        chatAllowed: res.allowed,
        chatStatus: res.status
      })
    } else if (newStatus === 'left' || newStatus === 'kicked') {
      // 机器人离开：解绑该机器人
      try {
        await prisma.chat.update({ where: { id: chatId }, data: { bot: { disconnect: true } } })
        console.log('[my_chat_member][unbind-ok]', { chatId })
      } catch (e) {
        console.error('[my_chat_member][unbind-fail]', e)
      }
    }
  } catch {}
})

// 🔥 注册所有命令处理器（模块化）
registerAllHandlers(bot, ensureChat)

// 🔥 使用模块化的权限检查中间件（减少代码，提升性能）
bot.use(createPermissionMiddleware())

// 设置群全体禁言/解除禁言（不影响管理员）。禁言时为操作员名单单独放行发言。
// ⚠️ 注意：此功能需要机器人拥有管理员权限（限制成员权限）
async function setChatMute(ctx, enable) {
  const chatId = ctx.chat.id
  if (enable) {
    // 全体禁言（默认权限全部关闭）
    await ctx.telegram.setChatPermissions(chatId, {
      can_send_messages: false,
      can_send_media_messages: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
      can_change_info: false,
      can_invite_users: false,
      can_pin_messages: false,
    })
    // 放行操作员（非管理员）
    const chat = ensureChat(ctx)
    if (chat && chat.operatorIds.size > 0) {
      for (const uid of chat.operatorIds) {
        try {
          await ctx.telegram.restrictChatMember(chatId, uid, {
            can_send_messages: true,
            can_send_media_messages: true,
            can_send_polls: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true,
          })
        } catch {}
      }
    }
  } else {
    // 恢复默认允许发言
    await ctx.telegram.setChatPermissions(chatId, {
      can_send_messages: true,
      can_send_media_messages: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true,
      can_invite_users: true,
    })
  }
}

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
bot.on('my_chat_member', async (ctx) => {
  try {
    const chatId = String(ctx.chat?.id || '')
    const newStatus = ctx.update?.my_chat_member?.new_chat_member?.status
    if (!chatId || !newStatus) return
    if (newStatus === 'kicked' || newStatus === 'left') {
      await prisma.operator.deleteMany({ where: { chatId } }).catch(() => {})
      await prisma.setting.deleteMany({ where: { chatId } }).catch(() => {})
      await prisma.chat.delete({ where: { id: chatId } }).catch(() => {})
    }
  } catch {}
})

// 激活（禁用群内自助开通，改为提示后台审批）
bot.hears(/^(激活机器人|激活)$/i, async (ctx) => {
  await ensureDbChat(ctx)
  return ctx.reply('启用需后台审批，请到后台将本群状态设为 APPROVED。')
})

// 激活设置汇率 X（激活并设置固定汇率）
bot.hears(/^激活设置汇率\s+(\d+(?:\.\d+)?)$/i, async (ctx) => {
  const chatId = await ensureDbChat(ctx)
  const m = ctx.message.text.match(/(\d+(?:\.\d+)?)/)
  if (!m) return
  const rate = Number(m[1])
  await updateSettings(chatId, { fixedRate: rate, realtimeRate: null })
  const chat = ensureChat(ctx)
  chat.fixedRate = rate
  chat.realtimeRate = null
  await ctx.reply(`机器人已激活并设置固定汇率为 ${rate}`)
})

// 允许本群（禁用群内白名单，统一提示后台审批）
bot.hears(/^(允许本群|加入白名单)$/i, async (ctx) => {
  await ensureDbChat(ctx)
  return ctx.reply('请到后台审批通过本群（设为 APPROVED）后再使用。')
})

// 禁止本群（提示后台禁用）
bot.hears(/^(禁止本群|移出白名单)$/i, async (ctx) => {
  const chatId = await ensureDbChat(ctx)
  if (!(await isAdmin(ctx))) return ctx.reply('只有管理员可以执行此操作')
  await prisma.chat.update({ where: { id: chatId }, data: { status: 'BLOCKED', allowed: false } })
  await ctx.reply('已将本群标记为 BLOCKED，后台可恢复为 APPROVED。')
})

bot.hears(/^开始记账$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  await ensureDbChat(ctx)
  await ctx.reply('已开始记账。本群状态已初始化，使用 +金额 / -金额 进行操作。')
})

// 上课：开始计时（若已在计时则忽略）
bot.hears(/^(上课|开始上课)$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  await ensureDbChat(ctx)
  chat.muteMode = false
  chat.workStartedAt = null
  try { await setChatMute(ctx, false) } catch {}
  await ctx.reply('已解除禁言。')
})

// 下课：停止计时并开启全体禁言（管理员不受影响；操作员放行）
bot.hears(/^下课$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  await ensureDbChat(ctx)
  if (chat.workStartedAt) {
    chat.workTotalMs += Date.now() - chat.workStartedAt.getTime()
    chat.workStartedAt = null
  }
  chat.muteMode = true
  try { await setChatMute(ctx, true) } catch {}
  await ctx.reply('下课了，已开启全体禁言（管理员与操作员除外）。')
})

// 解除禁言/开口：关闭全体禁言
bot.hears(/^(解除禁言|开口)$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  await ensureDbChat(ctx)
  chat.muteMode = false
  try { await setChatMute(ctx, false) } catch {}
  await ctx.reply('已解除禁言。')
})

// 查询工时：累计时长 + 进行中时长
bot.hears(/^查询工时$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  await ensureDbChat(ctx)
  let total = chat.workTotalMs
  if (chat.workStartedAt) total += (Date.now() - chat.workStartedAt.getTime())
  await ctx.reply(`累计上课时长：${formatDuration(total)}`)
})

// 纯数学表达式计算（不记账，只返回结果）
// 支持：288-38, 2277+7327, 929-7272, 292*32, 3232/3232
// 排除：纯数字（123）、=数字（=3232）
bot.hears(/^\d+[\d+\-*/.()]+$/, async (ctx) => {
  const text = ctx.message.text.trim()
  
  // 🔥 排除纯数字
  if (/^\d+$/.test(text)) {
    return // 静默忽略纯数字
  }
  
  // 🔥 排除 =数字 格式
  if (/^=\d+/.test(text)) {
    return // 静默忽略 =数字
  }
  
  // 🔥 必须包含至少一个运算符（+、-、*、/）
  if (!/[\+\-\*/]/.test(text)) {
    return // 静默忽略不包含运算符的
  }
  
  // 计算表达式
  const result = safeCalculate(text)
  
  // 🔥 无效表达式静默失败，不提醒
  if (result === null) {
    return // 静默忽略无效表达式
  }
  
  // 使用 reply 回复用户的消息：表达式=结果
  await ctx.reply(`${text}=${result}`, {
    reply_to_message_id: ctx.message.message_id
  })
})

// +金额 或 +金额/汇率 或 +金额u（USDT）；-金额 表示撤销/负向入款
// 支持数学表达式：+100-50, +100*2, +80/21+30
bot.hears(/^[+\-]\s*[\d+\-*/.()]+(?:u|U)?(?:\s*\/\s*\d+(?:\.\d+)?)?$/i, async (ctx) => {
  console.log('[记账命令] 开始处理', { text: ctx.message.text, chatId: ctx.chat?.id })
  
  const chat = ensureChat(ctx)
  if (!chat) {
    console.log('[记账命令] ensureChat失败')
    return
  }
  
  // 权限检查：默认只有管理员可以记账，其他人需要添加到操作人列表
  const hasPermission = await hasOperatorPermission(ctx)
  console.log('[记账命令] 操作权限检查', { hasPermission, chatId: ctx.chat?.id })
  if (!hasPermission) {
    return ctx.reply('⚠️ 您没有记账权限。只有管理员或已添加的操作人可以记账。\n请联系管理员使用"设置操作人 @你的用户名"添加权限。')
  }
  
  const chatId = await ensureDbChat(ctx)
  
  // 🔥 检查是否跨日，如果是每日清零模式则清空内存数据
  await checkAndClearIfNewDay(chat, chatId)
  
  const text = ctx.message.text.trim()
  console.log('[记账命令] 开始解析', { text, chatId })
  
  // 🔥 保存用户ID映射（用于显示时链接到用户主页）
  if (ctx.from?.id && ctx.from?.username) {
    const uname = `@${ctx.from.username}`
    chat.userIdByUsername.set(uname, ctx.from.id)
    chat.userIdByUsername.set(ctx.from.username, ctx.from.id) // 同时保存不带@的版本
  }
  
  // 解析金额格式：+100 (人民币) 或 +100u (USDT) 或 +100/7.2
  // 支持表达式：+100-50, +100*2, +80/21
  const isUSDT = /[uU]/.test(text)
  const cleanText = text.replace(/[uU]/g, '').replace(/\s+/g, '')
  const parsed = parseAmountAndRate(cleanText)
  if (!parsed) {
    return ctx.reply('❌ 无效的金额格式。\n支持格式：\n• +100（简单数字）\n• +100-50（加减）\n• +100*2（乘法）\n• +80/21（除法）\n• +100-50u（USDT）\n• +100*2/7.2（带汇率）')
  }

  // If amount is zero, treat as a request to show the summary rather than recording
  if (!Number(parsed.amount)) {
    const summary = await formatSummary(ctx, chat, { title: '当前账单' })
    return ctx.reply(summary, { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' })
  }

  const rate = parsed.rate ?? chat.fixedRate ?? chat.realtimeRate
  
  // 根据输入格式计算金额和USDT
  let amountRMB, usdt
  if (isUSDT) {
    // 输入的是USDT，需要转换成人民币
    usdt = Math.abs(parsed.amount)
    amountRMB = rate ? Number((usdt * rate).toFixed(2)) : 0
    // 保持符号
    if (parsed.amount < 0) {
      amountRMB = -amountRMB
    }
  } else {
    // 输入的是人民币
    amountRMB = parsed.amount
    usdt = rate ? Number((Math.abs(amountRMB) / rate).toFixed(1)) : undefined
  }
  
  // 🔥 获取操作人用户名（带@），用于保存到数据库
  const operatorUsername = ctx.from?.username ? `@${ctx.from.username}` : null
  const replierUsername = getUsername(ctx) // 不带@，用于显示
  
  chat.current.incomes.push({
    amount: amountRMB,
    rate: parsed.rate || undefined,
    createdAt: new Date(),
    replier: replierUsername,
    operator: operatorUsername || replierUsername, // 🔥 优先使用带@的用户名
  })
  
  // 将入款写入当天 OPEN 账单的 BillItem
  try {
    const { bill } = await getOrCreateTodayBill(chatId)
    const billItem = await prisma.billItem.create({ data: {
      billId: bill.id,
      type: 'INCOME',
      amount: Number(amountRMB), // 🔥 Float 类型，使用 Number
      rate: rate ? Number(rate) : null,
      usdt: usdt ? Number(usdt) : null,
      replier: replierUsername || null,
      operator: operatorUsername || replierUsername || null, // 🔥 优先保存带@的用户名，用于操作人分类统计
      createdAt: new Date(),
    } })
    
    console.log('[记账][入款已保存]', { 
      chatId, 
      billId: bill.id, 
      billItemId: billItem.id,
      amount: amountRMB, 
      usdt,
      operator: operatorUsername || replierUsername,
      openedAt: bill.openedAt
    })
  } catch (e) {
    console.error('写入 BillItem(INCOME) 失败', e)
    console.error('[错误详情]', { chatId, error: e.message, stack: e.stack })
    // 🔥 即使保存失败，也继续执行（避免影响用户体验）
  }
  
  // 🔥 超押提醒检查（仅在入款时检查，且金额为正数）
  if (amountRMB > 0) {
    try {
      const setting = await prisma.setting.findUnique({
        where: { chatId },
        select: { overDepositLimit: true, lastOverDepositWarning: true }
      })
      
      if (setting?.overDepositLimit && setting.overDepositLimit > 0) {
        // 计算当前总入款（包括本次）
        const { bill } = await getOrCreateTodayBill(chatId)
        const totalIncome = await prisma.billItem.aggregate({
          where: {
            billId: bill.id,
            type: 'INCOME'
          },
          _sum: {
            amount: true
          }
        })
        
        const currentTotal = (totalIncome._sum.amount || 0)
        const limit = setting.overDepositLimit
        
        // 检查是否需要提醒（超过或即将超过额度）
        const shouldWarn = currentTotal >= limit || (currentTotal >= limit * 0.9 && currentTotal < limit)
        
        // 避免频繁提醒：如果已经提醒过，且距离上次提醒不超过1小时，则不重复提醒
        const lastWarning = setting.lastOverDepositWarning
        const shouldSendWarning = shouldWarn && (!lastWarning || Date.now() - lastWarning.getTime() > 60 * 60 * 1000)
        
        if (shouldSendWarning) {
          let warningText = ''
          if (currentTotal >= limit) {
            warningText = `⚠️ *超押提醒*\n\n` +
              `当前入款总额：${formatMoney(currentTotal)} 元\n` +
              `设置额度：${formatMoney(limit)} 元\n` +
              `已超过额度：${formatMoney(currentTotal - limit)} 元`
          } else {
            warningText = `⚠️ *超押提醒*\n\n` +
              `当前入款总额：${formatMoney(currentTotal)} 元\n` +
              `设置额度：${formatMoney(limit)} 元\n` +
              `即将超过额度，还差：${formatMoney(limit - currentTotal)} 元`
          }
          
          await ctx.reply(warningText, { parse_mode: 'Markdown' })
          
          // 更新最后提醒时间
          await prisma.setting.update({
            where: { chatId },
            data: { lastOverDepositWarning: new Date() }
          })
        }
      }
    } catch (e) {
      console.error('[超押提醒]', e)
      // 不影响正常流程
    }
  }
  
  // 发送完整账单（不发送确认消息）
  try {
    console.log('[记账命令] 开始生成账单摘要', { chatId: ctx.chat?.id })
  const summary = await formatSummary(ctx, chat, { title: '当前账单' })
    console.log('[记账命令] 账单摘要生成完成', { summaryLength: summary?.length, chatId: ctx.chat?.id })
    
    const inlineKb = await buildInlineKb(ctx)
    console.log('[记账命令] 内联键盘生成完成', { chatId: ctx.chat?.id })
    
    await ctx.reply(summary, { ...inlineKb, parse_mode: 'Markdown' })
    console.log('[记账命令] 回复消息已发送', { chatId: ctx.chat?.id })
  } catch (e) {
    console.error('[记账命令] 发送回复失败', { error: e.message, stack: e.stack, chatId: ctx.chat?.id })
    // 即使发送失败，也尝试发送一个简单回复
    try {
      await ctx.reply('✅ 记账已保存（账单显示失败，请稍后查看）')
    } catch (e2) {
      console.error('[记账命令] 发送备用回复也失败', { error: e2.message })
    }
  }
})

// 下发xxxx 或 下发10u（USDT）或 下发-xxxx （支持负数）
bot.hears(/^下发\s*[+\-]?\s*\d+(?:\.\d+)?(?:u|U)?$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查
  if (!(await hasOperatorPermission(ctx))) {
    return ctx.reply('⚠️ 您没有记账权限。只有管理员或已添加的操作人可以记账。')
  }
  
  const chatId = await ensureDbChat(ctx)
  
  // 🔥 检查是否跨日，如果是每日清零模式则清空内存数据
  await checkAndClearIfNewDay(chat, chatId)
  const text = ctx.message.text.trim()
  
  // 检查是否带u后缀（表示USDT）
  const isUSDT = /[uU]/.test(text)
  const m = text.match(/^下发\s*([+\-]?\s*\d+(?:\.\d+)?)/i)
  if (!m) return
  
  const inputValue = Number(m[1].replace(/\s+/g, ''))
  if (!Number.isFinite(inputValue)) return
  
  const rate = chat.fixedRate ?? chat.realtimeRate
  let amountRMB, usdtValue
  
  if (isUSDT) {
    // 输入的是USDT（下发500u），直接保存为USDT，人民币根据汇率计算
    usdtValue = inputValue
    amountRMB = rate ? Number((Math.abs(usdtValue) * rate).toFixed(2)) : 0
    // 保持符号
    if (usdtValue < 0) {
      amountRMB = -amountRMB
    }
  } else {
    // 输入的是人民币（下发500），直接保存为人民币，USDT根据汇率计算
    amountRMB = inputValue
    usdtValue = rate ? Number((Math.abs(amountRMB) / rate).toFixed(1)) : 0
    // 保持符号
    if (amountRMB < 0) {
      usdtValue = -usdtValue
    }
  }
  
  // 🔥 获取操作人用户名（带@），用于保存到数据库
  const operatorUsername = ctx.from?.username ? `@${ctx.from.username}` : null
  const replierUsername = getUsername(ctx) // 不带@，用于显示
  
  chat.current.dispatches.push({ 
    amount: amountRMB, 
    usdt: usdtValue, 
    createdAt: new Date(), 
    replier: replierUsername,
    operator: operatorUsername || replierUsername, // 🔥 优先使用带@的用户名
  })
  
  // 将下发写入当天 OPEN 账单的 BillItem
  try {
    const { bill } = await getOrCreateTodayBill(chatId)
    const billItem = await prisma.billItem.create({ data: {
      billId: bill.id,
      type: 'DISPATCH',
      amount: Number(amountRMB), // 🔥 Float 类型，使用 Number
      rate: rate ? Number(rate) : null,
      usdt: Number(usdtValue), // 🔥 Float 类型，使用 Number
      replier: replierUsername || null,
      operator: operatorUsername || replierUsername || null, // 🔥 优先保存带@的用户名，用于操作人分类统计
      createdAt: new Date(),
    } })
    
    console.log('[记账][下发已保存]', { 
      chatId, 
      billId: bill.id, 
      billItemId: billItem.id,
      amount: amountRMB, 
      usdt: usdtValue,
      operator: operatorUsername || replierUsername,
      openedAt: bill.openedAt
    })
  } catch (e) {
    console.error('写入 BillItem(DISPATCH) 失败', e)
    console.error('[错误详情]', { chatId, error: e.message, stack: e.stack })
    // 🔥 即使保存失败，也继续执行（避免影响用户体验）
  }
  try {
    console.log('[下发命令] 开始生成账单摘要', { chatId: ctx.chat?.id })
  const summary = await formatSummary(ctx, chat, { title: '下发已记录' })
    console.log('[下发命令] 账单摘要生成完成', { summaryLength: summary?.length, chatId: ctx.chat?.id })
    
    const inlineKb = await buildInlineKb(ctx)
    console.log('[下发命令] 内联键盘生成完成', { chatId: ctx.chat?.id })
    
    await ctx.reply(summary, { ...inlineKb, parse_mode: 'Markdown' })
    console.log('[下发命令] 回复消息已发送', { chatId: ctx.chat?.id })
  } catch (e) {
    console.error('[下发命令] 发送回复失败', { error: e.message, stack: e.stack, chatId: ctx.chat?.id })
    // 即使发送失败，也尝试发送一个简单回复
    try {
      await ctx.reply('✅ 下发已记录（账单显示失败，请稍后查看）')
    } catch (e2) {
      console.error('[下发命令] 发送备用回复也失败', { error: e2.message })
    }
  }
})

// 保存账单：把 current 推入 history，并清空 current
bot.hears(/^保存账单$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查
  if (!(await hasOperatorPermission(ctx))) {
    return ctx.reply('⚠️ 您没有权限保存账单。只有管理员或已添加的操作人可以操作。')
  }
  
  const chatId = await ensureDbChat(ctx)
  // 关闭当天 OPEN 账单
  try {
    const { bill } = await getOrCreateTodayBill(chatId)
    if (bill && bill.status === 'OPEN') {
      await prisma.bill.update({ where: { id: bill.id }, data: { status: 'CLOSED', closedAt: new Date(), savedAt: new Date() } })
    }
  } catch (e) {
    console.error('关闭 OPEN 账单失败', e)
  }
  // 本地内存历史（保留原行为用于消息展示）
  chat.history.push({ savedAt: new Date(), data: JSON.parse(JSON.stringify(chat.current)) })
  // 清空当前账单
  chat.current = { incomes: [], dispatches: [] }
  await ctx.reply('当前账单已保存并清空。')
})

// 删除账单：清空当前记录
bot.hears(/^删除账单$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查
  if (!(await hasOperatorPermission(ctx))) {
    return ctx.reply('⚠️ 您没有权限删除账单。只有管理员或已添加的操作人可以操作。')
  }
  
  const chatId = await ensureDbChat(ctx)
  
  // 获取当前记账模式（在 try 块外部，用于回复消息）
  let isCarryOver = false
  try {
    const settings = await prisma.setting.findUnique({
      where: { chatId },
      select: { accountingMode: true }
    })
    isCarryOver = settings?.accountingMode === 'CARRY_OVER'
  } catch (e) {
    console.error('获取记账模式失败', e)
  }
  
  // 🔥 不仅清空内存，还要删除数据库中当天的记录
  try {
    const { bill, gte } = await getOrCreateTodayBill(chatId)
    
    if (bill) {
      // 删除该账单的所有明细
      await prisma.billItem.deleteMany({ where: { billId: bill.id } })
      // 删除账单本身
      await prisma.bill.delete({ where: { id: bill.id } })
    }
    
    // 🔥 累计模式下，删除所有历史账单（累计是单次账单的累计）
    if (isCarryOver) {
      // 删除今天之前的所有账单（包括CLOSED状态）
      const historicalBills = await prisma.bill.findMany({
        where: { 
          chatId, 
          openedAt: { lt: gte }  // 今天之前的所有账单
        },
        select: { id: true }
      })
      
      if (historicalBills.length > 0) {
        const billIds = historicalBills.map(b => b.id)
        // 删除所有历史账单的明细
        await prisma.billItem.deleteMany({ where: { billId: { in: billIds } } })
        // 删除所有历史账单
        await prisma.bill.deleteMany({ where: { id: { in: billIds } } })
        if (process.env.DEBUG_BOT === 'true') {
          console.log('[删除账单][累计模式] 已删除历史账单', { chatId, count: historicalBills.length })
        }
      }
    }
  } catch (e) {
    console.error('删除数据库账单失败', e)
  }
  
  chat.current = { incomes: [], dispatches: [] }
  await ctx.reply('当前账单已清空（包括内存和数据库）。' + (isCarryOver ? '\n累计模式：历史未下发数据已清零。' : ''))
})

// 🔥 删除全部账单：清除全部账单（请谨慎使用）
bot.hears(/^(删除全部账单|清除全部账单)$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查
  if (!(await hasOperatorPermission(ctx))) {
    return ctx.reply('⚠️ 您没有权限删除全部账单。只有管理员或已添加的操作人可以操作。')
  }
  
  const chatId = await ensureDbChat(ctx)
  
  try {
    // 🔥 删除该群组的所有账单和明细
    const allBills = await prisma.bill.findMany({
      where: { chatId },
      select: { id: true }
    })
    
    if (allBills.length === 0) {
      return ctx.reply('❌ 没有找到任何账单记录')
    }
    
    const billIds = allBills.map(b => b.id)
    
    // 删除所有账单的明细
    await prisma.billItem.deleteMany({ where: { billId: { in: billIds } } })
    
    // 删除所有账单
    await prisma.bill.deleteMany({ where: { id: { in: billIds } } })
    
    // 清空内存
    chat.current = { incomes: [], dispatches: [] }
    chat.history = []
    
    await ctx.reply(`⚠️ 已删除全部账单（共 ${allBills.length} 条账单记录）\n\n请谨慎使用此功能！`)
  } catch (e) {
    console.error('删除全部账单失败', e)
    await ctx.reply('❌ 删除全部账单失败，请稍后重试')
  }
})

// 显示账单 或 +0
bot.hears(/^(显示账单|\+0)$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const summary = await formatSummary(ctx, chat, { title: '当前账单' })
  await ctx.reply(summary, { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' })
})

// 显示历史账单（简要）
bot.hears(/^显示历史账单$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  if (chat.history.length === 0) return ctx.reply('暂无历史账单')
  const lines = chat.history.slice(-5).map((h, i) => {
    const incomes = h.data.incomes.length
    const dispatches = h.data.dispatches.length
    return `#${chat.history.length - (chat.history.length - i - 1)} 保存时间: ${new Date(h.savedAt).toLocaleString()} 入款:${incomes} 下发:${dispatches}`
  })
  await ctx.reply(['最近历史账单（最多5条）：', ...lines].join('\n'))
})

// 🔥 我的账单：查看当前用户在群内的所有记账记录
bot.hears(/^(我的账单|\/我)$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  const chatId = await ensureDbChat(ctx)
  const userId = String(ctx.from?.id || '')
  const username = ctx.from?.username ? `@${ctx.from.username}` : null
  
  // 🔥 查询当前用户在群内的所有记录
  try {
    const { bill } = await getOrCreateTodayBill(chatId)
    
    if (!bill) {
      return ctx.reply('❌ 您在本群暂无记账记录')
    }
    
    // 查询该用户在账单中的记录
    const items = await prisma.billItem.findMany({
      where: {
        billId: bill.id,
        OR: [
          username ? { operator: username } : undefined,
          username ? { replier: username.replace('@', '') } : undefined,
          { operator: { contains: userId } },
          { replier: { contains: userId } }
        ].filter(Boolean)
      },
      orderBy: { createdAt: 'desc' }
    })
    
    if (items.length === 0) {
      return ctx.reply('❌ 您在本群暂无记账记录')
    }
    
    // 🔥 格式化显示
    const lines = []
    lines.push(`📋 您的账单记录（共 ${items.length} 条）：\n`)
    
    let totalIncome = 0
    let totalDispatch = 0
    let totalUSDT = 0
    
    items.forEach(item => {
      const amount = Number(item.amount || 0)
      const usdt = Number(item.usdt || 0)
      const isIncome = item.type === 'INCOME'
      
      if (isIncome) {
        totalIncome += amount
        if (item.rate) {
          lines.push(`💰 +${amount} / ${item.rate}=${usdt.toFixed(1)}U`)
        } else {
          lines.push(`💰 +${amount}${usdt > 0 ? ` (${usdt.toFixed(1)}U)` : ''}`)
        }
      } else {
        totalDispatch += amount
        totalUSDT += usdt
        lines.push(`📤 下发 ${usdt.toFixed(1)}U (${amount})`)
      }
    })
    
    lines.push(`\n📊 汇总：`)
    lines.push(`入款：${totalIncome.toFixed(2)}`)
    if (totalDispatch > 0 || totalUSDT > 0) {
      lines.push(`下发：${totalDispatch.toFixed(2)} (${totalUSDT.toFixed(1)}U)`)
    }
    
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' })
  } catch (e) {
    console.error('查询我的账单失败', e)
    await ctx.reply('❌ 查询账单失败，请稍后重试')
  }
})


// 删除群组：按钮点击 -> 二次确认 -> 执行删除/取消

// 设置费率xx
// 设置费率：支持百分比（如 5）或小数（-1 到 1 之间，如 0.05 表示 5%）
bot.hears(/^设置费率\s*(-?\d+(?:\.\d+)?)%?$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const chatId = await ensureDbChat(ctx)
  const m = ctx.message.text.match(/(-?\d+(?:\.\d+)?)/)
  if (!m) return
  let v = Number(m[1])
  if (Math.abs(v) <= 1) {
    // interpret as fraction
    v = v * 100
  }
  chat.feePercent = Math.max(-100, Math.min(100, v))
  await updateSettings(chatId, { feePercent: chat.feePercent })
  await ctx.reply(`费率已设置为 ${chat.feePercent}%`)
})

// 设置汇率（可带数值，也可不带数值查看当前，支持不加空格：设置汇率7.2）
bot.hears(/^设置汇率\s*(\d+(?:\.\d+)?)?$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const chatId = await ensureDbChat(ctx)
  const m = ctx.message.text.match(/^设置汇率\s*(\d+(?:\.\d+)?)?$/i)
  const val = m && m[1] ? Number(m[1]) : null
  if (val == null) {
    const settings = await prisma.setting.findUnique({ where: { chatId } })
    const current = settings?.fixedRate ?? settings?.realtimeRate ?? null
    return ctx.reply(`当前汇率：${current ?? '未设置'}\n用法：设置汇率7.2 或 设置汇率 7.2`)
  }
  chat.fixedRate = val
  chat.realtimeRate = null
  await updateSettings(chatId, { fixedRate: val, realtimeRate: null })
  await ctx.reply(`已设置固定汇率为 ${val}，并关闭实时汇率。`)
})

bot.hears(/^设置实时汇率$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const chatId = await ensureDbChat(ctx)
  const rate = await fetchRealtimeRateUSDTtoCNY()
  if (rate) {
    chat.realtimeRate = rate
    chat.fixedRate = null
    await updateSettings(chatId, { realtimeRate: rate, fixedRate: null })
    await ctx.reply(`已启用实时汇率，当前实时汇率为 ${rate.toFixed(2)}`)
  } else {
    await ctx.reply('获取实时汇率失败，请稍后重试。')
  }
})

// 刷新实时汇率
bot.hears(/^刷新实时汇率$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const chatId = await ensureDbChat(ctx)
  const rate = await fetchRealtimeRateUSDTtoCNY()
  if (rate) {
    chat.realtimeRate = rate
    chat.fixedRate = null
    await updateSettings(chatId, { realtimeRate: rate, fixedRate: null })
    await ctx.reply(`实时汇率已刷新为 ${rate.toFixed(2)}`)
  } else {
    await ctx.reply('获取实时汇率失败，请稍后重试。')
  }
})

bot.hears(/^显示实时汇率$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const rate = chat.realtimeRate ?? chat.fixedRate
  await ctx.reply(`当前汇率：${rate ?? '未设置'}`)
})

// 🔥 OKX C2C价格查询（z0命令）
bot.hears(/^(z0|Z0)$/i, async (ctx) => {
  try {
    // 默认获取所有支付方式的数据
    const sellers = await getOKXC2CSellers('all')
    
    if (sellers.length === 0) {
      return ctx.reply('❌ 无法获取OKX实时U价数据，请稍后重试。')
    }
    
    // 格式化价格排行榜
    const topSellers = sellers.slice(0, 10)
    const now = new Date()
    const timeStr = now.toLocaleString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    })
    
    let priceText = ' 💰 OKX实时U价 TOP 10 \n\n'
    
    topSellers.forEach((seller, index) => {
      const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][index] || '•'
      priceText += `${emoji}    ${seller.price.toFixed(2)}    ${seller.nickName}\n`
    })
    
    priceText += `\n获取时间：${timeStr}`
    
    // 创建内联菜单按钮（所有、银行卡、支付宝、微信）
    const inlineKb = Markup.inlineKeyboard([
      [
        Markup.button.callback('所有', 'okx_c2c_all'),
        Markup.button.callback('银行卡', 'okx_c2c_bank')
      ],
      [
        Markup.button.callback('支付宝', 'okx_c2c_alipay'),
        Markup.button.callback('微信', 'okx_c2c_wxpay')
      ]
    ])
    
    await ctx.reply(priceText, { ...inlineKb })
  } catch (e) {
    console.error('[OKX C2C价格查询失败]', e)
    await ctx.reply('❌ 查询OKX实时U价失败，请稍后重试。')
  }
})

// 🔥 处理OKX C2C内联菜单按钮回调
bot.action(/^okx_c2c_(all|bank|alipay|wxpay)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery()
    
    const paymentMethod = ctx.match[1]
    
    // 映射支付方式
    const methodMap = {
      'all': 'all',
      'bank': 'bank',
      'alipay': 'alipay',
      'wxpay': 'wxPay'
    }
    
    const okxMethod = methodMap[paymentMethod] || 'all'
    const sellers = await getOKXC2CSellers(okxMethod)
    
    if (sellers.length === 0) {
      return ctx.reply('❌ 无法获取该支付方式的数据，请稍后重试。')
    }
    
    // 格式化价格排行榜
    const topSellers = sellers.slice(0, 10)
    const now = new Date()
    const timeStr = now.toLocaleString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    })
    
    const methodName = {
      'all': '所有',
      'bank': '银行卡',
      'alipay': '支付宝',
      'wxpay': '微信'
    }[paymentMethod]
    
    let priceText = ` 💰 OKX实时U价 ${methodName} TOP 10 \n\n`
    
    topSellers.forEach((seller, index) => {
      const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][index] || '•'
      priceText += `${emoji}    ${seller.price.toFixed(2)}    ${seller.nickName}\n`
    })
    
    priceText += `\n获取时间：${timeStr}`
    
    // 创建内联菜单按钮
    const inlineKb = Markup.inlineKeyboard([
      [
        Markup.button.callback('所有', 'okx_c2c_all'),
        Markup.button.callback('银行卡', 'okx_c2c_bank')
      ],
      [
        Markup.button.callback('支付宝', 'okx_c2c_alipay'),
        Markup.button.callback('微信', 'okx_c2c_wxpay')
      ]
    ])
    
    await ctx.editMessageText(priceText, { ...inlineKb })
  } catch (e) {
    console.error('[OKX C2C内联菜单处理失败]', e)
    await ctx.answerCbQuery('❌ 获取数据失败，请稍后重试。', { show_alert: true })
  }
})

// 🔥 添加操作员方式一：添加操作员 @AAA @BBB（支持多个用户名）
bot.hears(/^添加操作员\s+/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查：管理员或白名单用户
  if (!(await hasOperatorPermission(ctx))) {
    const userId = String(ctx.from?.id || '')
    const whitelistedUser = await prisma.whitelistedUser.findUnique({ where: { userId } })
    if (!whitelistedUser) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
  }
  
  const text = ctx.message.text || ''
  // 提取所有@用户名
  const mentions = text.match(/@([A-Za-z0-9_]{5,})/g) || []
  
  if (mentions.length === 0) {
    return ctx.reply('❌ 未检测到 @用户名，请使用：添加操作员 @用户名1 @用户名2')
  }
  
  const chatId = await ensureDbChat(ctx)
  const added = []
  
  for (const mention of mentions) {
    chat.operators.add(mention)
    try {
      await prisma.operator.upsert({
        where: { chatId_username: { chatId, username: mention } },
        update: {},
        create: { chatId, username: mention },
      })
      added.push(mention)
    } catch (e) {
      console.error('保存操作人失败', e)
    }
  }
  
  await ctx.reply(`✅ 已添加操作人：${added.join(' ')}`)
})

// 🔥 添加操作员方式二：回复指定人消息：添加操作员（对方无用户名的情况）
bot.on('text', async (ctx, next) => {
  const chat = ensureChat(ctx)
  if (!chat) return next()
  
  const text = ctx.message.text?.trim()
  if (!text || !/^添加操作员$/i.test(text)) return next()
  
  // 必须回复消息
  const replyTo = ctx.message.reply_to_message
  if (!replyTo || !replyTo.from) return next()
  
  // 权限检查
  if (!(await hasOperatorPermission(ctx))) {
    const userId = String(ctx.from?.id || '')
    const whitelistedUser = await prisma.whitelistedUser.findUnique({ where: { userId } })
    if (!whitelistedUser) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
  }
  
  // 🔥 获取被回复人的信息（优先使用用户名，没有则使用ID）
  const targetUser = replyTo.from.username 
    ? `@${replyTo.from.username}` 
    : `@user_${replyTo.from.id}` // 无用户名时使用临时标识
  
  const chatId = await ensureDbChat(ctx)
  chat.operators.add(targetUser)
  
  try {
    await prisma.operator.upsert({
      where: { chatId_username: { chatId, username: targetUser } },
      update: {},
      create: { chatId, username: targetUser },
    })
    await ctx.reply(`✅ 已添加操作人：${targetUser}`)
  } catch (e) {
    console.error('保存操作人失败', e)
    await ctx.reply('❌ 添加操作人失败')
  }
})

// 🔥 添加操作员方式三：添加操作员 @所有人（群内所有人都可以记账）
bot.hears(/^添加操作员\s+@所有人$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查
  if (!(await hasOperatorPermission(ctx))) {
    const userId = String(ctx.from?.id || '')
    const whitelistedUser = await prisma.whitelistedUser.findUnique({ where: { userId } })
    if (!whitelistedUser) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
  }
  
  const chatId = await ensureDbChat(ctx)
  chat.everyoneAllowed = true
  await updateSettings(chatId, { everyoneAllowed: true })
  await ctx.reply('✅ 已开启：所有人可操作（群内所有人都可以记账）')
})

// 🔥 删除操作员方式一：删除操作员 @AAA @BBB（支持多个用户名）
bot.hears(/^删除操作员\s+/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查
  if (!(await hasOperatorPermission(ctx))) {
    const userId = String(ctx.from?.id || '')
    const whitelistedUser = await prisma.whitelistedUser.findUnique({ where: { userId } })
    if (!whitelistedUser) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
  }
  
  const text = ctx.message.text || ''
  // 提取所有@用户名
  const mentions = text.match(/@([A-Za-z0-9_]{5,})/g) || []
  
  if (mentions.length === 0) {
    return ctx.reply('❌ 未检测到 @用户名，请使用：删除操作员 @用户名1 @用户名2')
  }
  
  const chatId = await ensureDbChat(ctx)
  const deleted = []
  
  for (const mention of mentions) {
    chat.operators.delete(mention)
    try {
      await prisma.operator.delete({ where: { chatId_username: { chatId, username: mention } } })
      deleted.push(mention)
    } catch (e) {
      // ignore if not exist
    }
  }
  
  if (deleted.length > 0) {
    await ctx.reply(`✅ 已删除操作人：${deleted.join(' ')}`)
  } else {
    await ctx.reply('❌ 未找到要删除的操作人')
  }
})

// 🔥 删除操作员方式二：回复指定人消息：删除操作员（对方无用户名的情况）
bot.on('text', async (ctx, next) => {
  const chat = ensureChat(ctx)
  if (!chat) return next()
  
  const text = ctx.message.text?.trim()
  if (!text || !/^删除操作员$/i.test(text)) return next()
  
  // 必须回复消息
  const replyTo = ctx.message.reply_to_message
  if (!replyTo || !replyTo.from) return next()
  
  // 权限检查
  if (!(await hasOperatorPermission(ctx))) {
    const userId = String(ctx.from?.id || '')
    const whitelistedUser = await prisma.whitelistedUser.findUnique({ where: { userId } })
    if (!whitelistedUser) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
  }
  
  // 🔥 获取被回复人的信息（优先使用用户名，没有则使用ID）
  const targetUser = replyTo.from.username 
    ? `@${replyTo.from.username}` 
    : `@user_${replyTo.from.id}` // 无用户名时使用临时标识
  
  const chatId = await ensureDbChat(ctx)
  chat.operators.delete(targetUser)
  
  try {
    await prisma.operator.delete({ where: { chatId_username: { chatId, username: targetUser } } })
    await ctx.reply(`✅ 已删除操作人：${targetUser}`)
  } catch (e) {
    // ignore if not exist
    await ctx.reply('❌ 未找到该操作人')
  }
})

// 🔥 保留旧的设置操作人命令（兼容性）
bot.hears(/^设置操作人\s+@/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const mention = extractMention(ctx.message.text)
  if (!mention) return ctx.reply('未检测到 @用户名')
  chat.operators.add(mention)
  const chatId = await ensureDbChat(ctx)
  try {
    await prisma.operator.upsert({
      where: { chatId_username: { chatId, username: mention } },
      update: {},
      create: { chatId, username: mention },
    })
  } catch (e) {
    console.error('保存操作人失败', e)
  }
  await ctx.reply(`已设置操作人：${mention}`)
})

bot.hears(/^设置所有人$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  chat.everyoneAllowed = true
  const chatId = await ensureDbChat(ctx)
  await updateSettings(chatId, { everyoneAllowed: true })
  await ctx.reply('已开启：所有人可操作。')
})

bot.hears(/^显示操作人$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const chatId = await ensureDbChat(ctx)
  const rows = await prisma.operator.findMany({ where: { chatId }, orderBy: { username: 'asc' } })
  const list = rows.map(r => r.username)
  if (list.length === 0) return ctx.reply('暂无操作人')
  await ctx.reply('操作人列表：\n' + list.join('\n'))
})

// 模式相关（显示模式、人民币模式、佣金模式）
bot.hears(/^显示模式[123456]$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
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

// 🔥 撤销入款：撤销最近一条入款记录
bot.hears(/^撤销入款$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查
  if (!(await hasOperatorPermission(ctx))) {
    return ctx.reply('⚠️ 您没有撤销权限。只有管理员或已添加的操作人可以操作。')
  }
  
  const chatId = await ensureDbChat(ctx)
  const deleted = await deleteLastIncome(chatId)
  
  if (deleted) {
    // 更新内存 current
    const idx = [...chat.current.incomes].reverse().findIndex(r => Math.abs(r.amount - deleted.amount) < 1e-9)
    if (idx >= 0) chat.current.incomes.splice(chat.current.incomes.length - 1 - idx, 1)
    await ctx.reply(`✅ 已撤销最近一条入款记录：${deleted.amount}`)
  } else {
    await ctx.reply('❌ 未找到可撤销的入款记录')
  }
})

// 🔥 撤销下发：撤销最近一条下发记录
bot.hears(/^撤销下发$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查
  if (!(await hasOperatorPermission(ctx))) {
    return ctx.reply('⚠️ 您没有撤销权限。只有管理员或已添加的操作人可以操作。')
  }
  
  const chatId = await ensureDbChat(ctx)
  const deleted = await deleteLastDispatch(chatId)
  
  if (deleted) {
    // 更新内存 current
    const idx = [...chat.current.dispatches].reverse().findIndex(r => Math.abs(r.amount - deleted.amount) < 1e-9)
    if (idx >= 0) chat.current.dispatches.splice(chat.current.dispatches.length - 1 - idx, 1)
    await ctx.reply(`✅ 已撤销最近一条下发记录：${deleted.amount}`)
  } else {
    await ctx.reply('❌ 未找到可撤销的下发记录')
  }
})

// 🔥 指定删除和指定账单：回复指定记录消息，输入"删除"或"账单"（需要在其他text监听器之前）
bot.use(async (ctx, next) => {
  // 只处理文本消息
  if (!ctx.message?.text) return next()
  
  const text = ctx.message.text?.trim()
  const isDelete = /^删除$/i.test(text)
  const isBill = /^账单$/i.test(text)
  
  if (!isDelete && !isBill) return next()
  
  const chat = ensureChat(ctx)
  if (!chat) return next()
  
  // 必须回复消息
  const replyTo = ctx.message.reply_to_message
  if (!replyTo) return next()
  
  // 如果回复的是操作员相关消息，且是删除操作，不处理（让删除操作员命令处理）
  const replyText = replyTo.text || ''
  if (isDelete && /操作人|操作员/.test(replyText)) return next()
  
  // 🔥 处理"账单"命令（查看指定用户账单）
  if (isBill && replyTo.from) {
    const chatId = await ensureDbChat(ctx)
    const targetUserId = String(replyTo.from.id || '')
    const targetUsername = replyTo.from.username ? `@${replyTo.from.username}` : null
    
    try {
      const { bill } = await getOrCreateTodayBill(chatId)
      
      if (!bill) {
        const targetName = targetUsername || replyTo.from.first_name || '该用户'
        return ctx.reply(`❌ ${targetName} 在本群暂无记账记录`)
      }
      
      // 查询该用户在账单中的记录
      const items = await prisma.billItem.findMany({
        where: {
          billId: bill.id,
          OR: [
            targetUsername ? { operator: targetUsername } : undefined,
            targetUsername ? { replier: targetUsername.replace('@', '') } : undefined,
            { operator: { contains: targetUserId } },
            { replier: { contains: targetUserId } }
          ].filter(Boolean)
        },
        orderBy: { createdAt: 'desc' }
      })
      
      if (items.length === 0) {
        const targetName = targetUsername || replyTo.from.first_name || '该用户'
        return ctx.reply(`❌ ${targetName} 在本群暂无记账记录`)
      }
      
      // 🔥 格式化显示
      const targetName = targetUsername || `${replyTo.from.first_name || ''} ${replyTo.from.last_name || ''}`.trim() || '该用户'
      const lines = []
      lines.push(`📋 ${targetName} 的账单记录（共 ${items.length} 条）：\n`)
      
      let totalIncome = 0
      let totalDispatch = 0
      let totalUSDT = 0
      
      items.forEach(item => {
        const amount = Number(item.amount || 0)
        const usdt = Number(item.usdt || 0)
        const isIncome = item.type === 'INCOME'
        
        if (isIncome) {
          totalIncome += amount
          if (item.rate) {
            lines.push(`💰 +${amount} / ${item.rate}=${usdt.toFixed(1)}U`)
          } else {
            lines.push(`💰 +${amount}${usdt > 0 ? ` (${usdt.toFixed(1)}U)` : ''}`)
          }
        } else {
          totalDispatch += amount
          totalUSDT += usdt
          lines.push(`📤 下发 ${usdt.toFixed(1)}U (${amount})`)
        }
      })
      
      lines.push(`\n📊 汇总：`)
      lines.push(`入款：${totalIncome.toFixed(2)}`)
      if (totalDispatch > 0 || totalUSDT > 0) {
        lines.push(`下发：${totalDispatch.toFixed(2)} (${totalUSDT.toFixed(1)}U)`)
      }
      
      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' })
      return // 已处理，不再继续
    } catch (e) {
      console.error('查询指定账单失败', e)
      await ctx.reply('❌ 查询账单失败，请稍后重试')
      return
    }
  }
  
  // 🔥 处理"删除"命令（删除指定记录）
  if (isDelete) {
    // 权限检查
    if (!(await hasOperatorPermission(ctx))) {
      return ctx.reply('⚠️ 您没有删除权限。只有管理员或已添加的操作人可以操作。')
    }
  
  const chatId = await ensureDbChat(ctx)
  
  // 🔥 尝试从回复的消息中提取记录信息
  // 格式可能是：时间 金额 / 汇率=USDTU 用户名 或 时间 金额 (USDT)U
  const { bill } = await getOrCreateTodayBill(chatId)
  
  if (!bill) {
    return ctx.reply('❌ 未找到对应的记录')
  }
  
  // 查询账单中的所有记录
  const items = await prisma.billItem.findMany({
    where: { billId: bill.id },
    orderBy: { createdAt: 'desc' },
    take: 10
  })
  
  if (!items.length) {
    return ctx.reply('❌ 未找到对应的记录')
  }
  
  // 🔥 尝试匹配最近几条记录（最多匹配10条）
  let matchedItem = null
  for (const item of items) {
    const itemAmount = Math.abs(Number(item.amount) || 0)
    // 检查回复文本中是否包含该金额（允许小数点误差）
    if (replyText.includes(String(Math.round(itemAmount))) || 
        replyText.includes(String(itemAmount.toFixed(2)))) {
      matchedItem = item
      break
    }
  }
  
  if (!matchedItem) {
    // 如果没匹配到，删除最近一条记录
    matchedItem = bill.items[0]
  }
  
  // 删除记录
  try {
    await prisma.billItem.delete({ where: { id: matchedItem.id } })
    
    // 更新内存
    const isIncome = matchedItem.type === 'INCOME'
    if (isIncome) {
      const deletedAmount = Number(matchedItem.amount)
      const idx = chat.current.incomes.findIndex(r => Math.abs(r.amount - deletedAmount) < 1e-9)
      if (idx >= 0) chat.current.incomes.splice(idx, 1)
    } else {
      const deletedAmount = Number(matchedItem.amount)
      const idx = chat.current.dispatches.findIndex(r => Math.abs(r.amount - deletedAmount) < 1e-9)
      if (idx >= 0) chat.current.dispatches.splice(idx, 1)
    }
    
    await ctx.reply(`✅ 已删除${isIncome ? '入款' : '下发'}记录：${matchedItem.amount}`)
    return // 已处理，不再继续
  } catch (e) {
    console.error('删除记录失败', e)
    await ctx.reply('❌ 删除记录失败')
    return
  }
  }
  
  // 如果没有匹配的命令，继续下一个中间件
  return next()
})

bot.hears(/^人民币模式$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  chat.rmbMode = true
  await ctx.reply('已切换为人民币模式（仅显示 RMB）')
})

bot.hears(/^(双显模式|显示两列)$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  chat.rmbMode = false
  await ctx.reply('已切换为双显模式（RMB | USDT）')
})

// 记账模式切换
bot.hears(/^(累计模式|结转模式)$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const chatId = await ensureDbChat(ctx)
  await updateSettings(chatId, { accountingMode: 'CARRY_OVER' })
  await ctx.reply('已切换为【累计模式】\n未下发金额将累计到次日，持续统计直到完全下发。')
})

bot.hears(/^(清零模式|按日清零)$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const chatId = await ensureDbChat(ctx)
  await updateSettings(chatId, { accountingMode: 'DAILY_RESET' })
  await ctx.reply('已切换为【清零模式】\n每日账单独立计算，不结转历史未下发金额。')
})

bot.hears(/^查看记账模式$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const chatId = await ensureDbChat(ctx)
  const settings = await prisma.setting.findUnique({ where: { chatId } })
  const mode = settings?.accountingMode || 'DAILY_RESET'
  const modeName = mode === 'CARRY_OVER' ? '累计模式（结转未下发）' : '清零模式（按日清零）'
  const desc = mode === 'CARRY_OVER' 
    ? '当前模式：未下发金额会累计到次日继续统计'
    : '当前模式：每日账单独立计算，不结转历史'
  await ctx.reply(`${modeName}\n${desc}`)
})

bot.hears(/^佣金\s*模式$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  chat.commissionMode = true
  await ensureDbChat(ctx)
  await ctx.reply('已开启佣金模式（在回复某人消息时输入 +N 或 -N 调整佣金）')
})

// 在“回复某个用户的消息”时，用 +N/-N 调整佣金
bot.on('text', async (ctx, next) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const text = ctx.message.text?.trim()
  if (!text) return next()
  if (!chat.commissionMode) return next()

  // 仅在回复消息时生效
  const replyTo = ctx.message.reply_to_message
  if (!replyTo) return next()
  const targetUser = replyTo.from?.username ? `@${replyTo.from.username}` : null
  if (!targetUser) return next()

  const m = text.match(/^([+\-])\s*(\d{1,4})$/)
  if (!m) return next()
  const delta = (m[1] === '-' ? -1 : 1) * Number(m[2])
  const chatId = await ensureDbChat(ctx)
  // read old
  const existing = await prisma.commission.findUnique({ where: { chatId_username: { chatId, username: targetUser } } })
  const old = existing?.value || 0
  const now = old + delta
  await prisma.commission.upsert({
    where: { chatId_username: { chatId, username: targetUser } },
    update: { value: now },
    create: { chatId, username: targetUser, value: now },
  })
  await ctx.reply(`佣金已调整：${targetUser} => ${now}`)
})

bot.hears(/^查询佣金$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const chatId = await ensureDbChat(ctx)
  const rows = await prisma.commission.findMany({ where: { chatId }, orderBy: { username: 'asc' } })
  if (!rows.length) return ctx.reply('暂无佣金数据')
  const lines = rows.map(r => `${r.username}: ${r.value}`)
  await ctx.reply(['佣金列表：', ...lines].join('\n'))
})

bot.hears(/^佣金清零$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const chatId = await ensureDbChat(ctx)
  await prisma.commission.deleteMany({ where: { chatId } })
  await ctx.reply('佣金已清零')
})

// 设置标题（页眉）
bot.hears(/^设置标题\s+(.+)/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const m = ctx.message.text.match(/^设置标题\s+(.+)/i)
  if (!m) return
  chat.headerText = m[1].trim()
  const chatId = await ensureDbChat(ctx)
  await updateSettings(chatId, { headerText: chat.headerText })
  await ctx.reply(`标题已设置为：${chat.headerText}`, { ...(await buildInlineKb(ctx)) })
})

// 🔥 开启所有功能（管理员/白名单用户）
bot.hears(/^开启所有功能$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查：管理员或白名单用户
  if (!(await hasOperatorPermission(ctx))) {
    // 检查是否是白名单用户
    const userId = String(ctx.from?.id || '')
    const whitelistedUser = await prisma.whitelistedUser.findUnique({
      where: { userId }
    })
    
    if (!whitelistedUser) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
  }
  
  const chatId = await ensureDbChat(ctx)
  
  // 🔥 开启所有功能开关
  const featuresCreated = await ensureDefaultFeatures(chatId, prisma, true)
  
  // 🔥 确保所有功能都是启用状态
  await prisma.chatFeatureFlag.updateMany({
    where: { chatId },
    data: { enabled: true }
  })
  
  // 🔥 清除功能开关缓存，确保立即生效
  clearFeatureCache(chatId)
  
  await ctx.reply('✅ 已开启所有功能开关！', { ...(await buildInlineKb(ctx)) })
  if (process.env.DEBUG_BOT === 'true') {
    console.log('[开启所有功能]', { chatId, featuresCreated })
  }
})

// 🔥 关闭所有功能（管理员/白名单用户）
bot.hears(/^关闭所有功能$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查：管理员或白名单用户
  if (!(await hasOperatorPermission(ctx))) {
    // 检查是否是白名单用户
    const userId = String(ctx.from?.id || '')
    const whitelistedUser = await prisma.whitelistedUser.findUnique({
      where: { userId }
    })
    
    if (!whitelistedUser) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
  }
  
  const chatId = await ensureDbChat(ctx)
  
  // 🔥 关闭所有功能开关
  await prisma.chatFeatureFlag.updateMany({
    where: { chatId },
    data: { enabled: false }
  })
  
  // 🔥 清除功能开关缓存，确保立即生效
  clearFeatureCache(chatId)
  
  await ctx.reply('⭕ 已关闭所有功能开关！', { ...(await buildInlineKb(ctx)) })
  if (process.env.DEBUG_BOT === 'true') {
    console.log('[关闭所有功能]', { chatId })
  }
})

// 🔥 开启地址验证（管理员/白名单用户）
bot.hears(/^开启地址验证$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查：管理员或白名单用户
  if (!(await hasOperatorPermission(ctx))) {
    // 检查是否是白名单用户
    const userId = String(ctx.from?.id || '')
    const whitelistedUser = await prisma.whitelistedUser.findUnique({
      where: { userId }
    })
    
    if (!whitelistedUser) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
  }
  
  const chatId = await ensureDbChat(ctx)
  
  // 更新地址验证开关
  await prisma.setting.upsert({
    where: { chatId },
    update: { addressVerificationEnabled: true },
    create: { chatId, addressVerificationEnabled: true }
  })
  
  await ctx.reply('✅ 已开启地址验证功能！', { ...(await buildInlineKb(ctx)) })
  console.log('[开启地址验证]', { chatId })
})

// 🔥 关闭地址验证（管理员/白名单用户）
bot.hears(/^关闭地址验证$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查：管理员或白名单用户
  if (!(await hasOperatorPermission(ctx))) {
    // 检查是否是白名单用户
    const userId = String(ctx.from?.id || '')
    const whitelistedUser = await prisma.whitelistedUser.findUnique({
      where: { userId }
    })
    
    if (!whitelistedUser) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
  }
  
  const chatId = await ensureDbChat(ctx)
  
  // 更新地址验证开关
  await prisma.setting.upsert({
    where: { chatId },
    update: { addressVerificationEnabled: false },
    create: { chatId, addressVerificationEnabled: false }
  })
  
  await ctx.reply('⭕ 已关闭地址验证功能！', { ...(await buildInlineKb(ctx)) })
  console.log('[关闭地址验证]', { chatId })
})

// 🔥 全局配置日切时间（仅管理员/白名单用户）
bot.hears(/^全局日切时间\s+(\d+)$/i, async (ctx) => {
  const hour = parseInt(ctx.match[1], 10)
  
  if (hour < 0 || hour > 23) {
    return ctx.reply('❌ 日切时间必须在 0-23 之间')
  }
  
  // 权限检查：管理员或白名单用户
  const isAdminUser = await isAdmin(ctx)
  if (!isAdminUser) {
    const userId = String(ctx.from?.id || '')
    const whitelistedUser = await prisma.whitelistedUser.findUnique({
      where: { userId }
    })
    
    if (!whitelistedUser) {
      return ctx.reply('⚠️ 您没有权限。只有管理员或白名单用户可以设置全局配置。')
    }
  }
  
  try {
    const userId = String(ctx.from?.id || '')
    await setGlobalDailyCutoffHour(hour, userId)
    await ctx.reply(`✅ 已设置全局日切时间为 ${hour}:00\n所有群组都将应用此配置。`)
  } catch (e) {
    console.error('[全局日切时间]', e)
    await ctx.reply('❌ 设置失败，请稍后重试')
  }
})
  
// 🔥 机器人退群（在群内发送后机器人自动退群，并删除所有权限）
bot.hears(/^机器人退群$/i, async (ctx) => {
  if (ctx.chat?.type === 'private') {
    return ctx.reply('此命令仅在群组中使用')
  }
  
  // 权限检查：管理员或白名单用户
  const isAdminUser = await isAdmin(ctx)
  if (!isAdminUser) {
    const userId = String(ctx.from?.id || '')
    const whitelistedUser = await prisma.whitelistedUser.findUnique({
      where: { userId }
    })
    
    if (!whitelistedUser) {
      return ctx.reply('⚠️ 您没有权限。只有管理员或白名单用户可以执行此操作。')
    }
  }
  
  const chatId = String(ctx.chat?.id || '')
  
  try {
    // 删除所有相关数据
    await prisma.chatFeatureFlag.deleteMany({ where: { chatId } })
    await prisma.setting.deleteMany({ where: { chatId } })
    await prisma.operator.deleteMany({ where: { chatId } })
    await prisma.addressVerification.deleteMany({ where: { chatId } })
    await prisma.featureWarningLog.deleteMany({ where: { chatId } })
    await prisma.chat.delete({ where: { id: chatId } }).catch(() => {})
    
    // 机器人退群
    await ctx.leaveChat()
    console.log('[机器人退群]', { chatId })
  } catch (e) {
    console.error('[机器人退群]', e)
    // 即使出错也尝试退群
    try {
      await ctx.leaveChat()
    } catch (e2) {
      console.error('[机器人退群] 二次尝试失败', e2)
    }
  }
})

// 🔥 查询汇率/映射表（显示点位汇率映射关系）
bot.hears(/^(查询汇率|查询映射表)(?:\s+(.+))?$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  const query = ctx.match[2]?.trim() || ''
  const chatId = await ensureDbChat(ctx)
  
  try {
    const setting = await prisma.setting.findUnique({
      where: { chatId },
      select: {
        fixedRate: true,
        realtimeRate: true,
        feePercent: true
      }
    })
    
    let rateText = ''
    if (query) {
      // 自定义查询：支持查询固定汇率或实时汇率
      const rate = parseFloat(query)
      if (!isNaN(rate) && rate > 0) {
        rateText = `查询汇率 ${rate} 的映射关系：\n` +
          `• 1 USDT = ${rate} CNY\n` +
          `• 1 CNY = ${(1 / rate).toFixed(6)} USDT\n` +
          `• 100 CNY = ${(100 / rate).toFixed(2)} USDT\n` +
          `• 100 USDT = ${(100 * rate).toFixed(2)} CNY`
      } else {
        rateText = `❌ 无效的汇率值：${query}`
      }
    } else {
      // 显示当前群组的汇率映射
      const fixedRate = setting?.fixedRate
      const realtimeRate = setting?.realtimeRate
      const feePercent = setting?.feePercent || 0
      
      rateText = ' 💱 汇率映射表 \n\n'
      
      if (fixedRate) {
        rateText += `【固定汇率】\n` +
          `• 1 USDT = ${fixedRate} CNY\n` +
          `• 1 CNY = ${(1 / fixedRate).toFixed(6)} USDT\n` +
          `• 100 CNY = ${(100 / fixedRate).toFixed(2)} USDT\n` +
          `• 100 USDT = ${(100 * fixedRate).toFixed(2)} CNY\n\n`
      } else if (realtimeRate) {
        rateText += `【实时汇率】\n` +
          `• 1 USDT = ${realtimeRate} CNY\n` +
          `• 1 CNY = ${(1 / realtimeRate).toFixed(6)} USDT\n` +
          `• 100 CNY = ${(100 / realtimeRate).toFixed(2)} USDT\n` +
          `• 100 USDT = ${(100 * realtimeRate).toFixed(2)} CNY\n\n`
      } else {
        rateText += `⚠️ 未设置汇率\n\n`
      }
      
      if (feePercent > 0) {
        rateText += `【费率】${feePercent}%\n`
      }
      
      rateText += `\n💡 提示：使用"查询汇率 7.2"可以查询指定汇率的映射关系`
    }
    
    await ctx.reply(rateText, { ...(await buildInlineKb(ctx)) })
  } catch (e) {
    console.error('[查询汇率]', e)
    await ctx.reply('❌ 查询失败，请稍后重试')
  }
})

// 🔥 设置超押提醒额度
bot.hears(/^设置额度\s+(\d+(?:\.\d+)?)$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查：管理员或白名单用户
  if (!(await hasOperatorPermission(ctx))) {
    const userId = String(ctx.from?.id || '')
  const whitelistedUser = await prisma.whitelistedUser.findUnique({
    where: { userId }
  })
  
    if (!whitelistedUser) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
  }
  
  const limit = parseFloat(ctx.match[1])
  const chatId = await ensureDbChat(ctx)
  
  try {
    await prisma.setting.upsert({
      where: { chatId },
      update: { overDepositLimit: limit },
      create: { chatId, overDepositLimit: limit }
    })
    
    if (limit === 0) {
      await ctx.reply('✅ 已关闭超押提醒', { ...(await buildInlineKb(ctx)) })
    } else {
      await ctx.reply(`✅ 已设置超押提醒额度为 ${formatMoney(limit)} 元`, { ...(await buildInlineKb(ctx)) })
        }
      } catch (e) {
    console.error('[设置额度]', e)
    await ctx.reply('❌ 设置失败，请稍后重试')
  }
})

// 🔥 群内管理员：显示管理员、权限人、操作员信息
bot.hears(/^(管理员|权限人|显示操作员)$/i, async (ctx) => {
  if (ctx.chat?.type === 'private') {
    return ctx.reply('此命令仅在群组中使用')
  }
  
  const chatId = await ensureDbChat(ctx)
  
  try {
    // 获取管理员列表
    const admins = await ctx.getChatAdministrators()
    const adminList = admins
      .filter(a => !a.user.is_bot)
      .map(a => {
        const name = a.user.username 
          ? `@${a.user.username}` 
          : `${a.user.first_name || ''} ${a.user.last_name || ''}`.trim() || `用户${a.user.id}`
        const status = a.status === 'creator' ? '👑 群主' : '👤 管理员'
        return `• ${name} (${status})`
      })
    
    // 获取操作员列表
    const operators = await prisma.operator.findMany({
      where: { chatId },
      select: { username: true }
    })
    
    // 获取设置
    const setting = await prisma.setting.findUnique({
      where: { chatId },
      select: { everyoneAllowed: true }
    })
    
    let text = ' 👥 群组权限信息 \n\n'
    
    if (adminList.length > 0) {
      text += `【👑 群主/管理员】\n${adminList.join('\n')}\n\n`
    }
    
    if (setting?.everyoneAllowed) {
      text += `【✅ 权限设置】\n• 所有人可操作\n\n`
    } else if (operators.length > 0) {
      text += `【👤 操作员】\n${operators.map(op => `• ${op.username}`).join('\n')}\n\n`
    } else {
      text += `【👤 操作员】\n• 仅管理员可操作\n\n`
    }
    
    await ctx.reply(text, { ...(await buildInlineKb(ctx)) })
  } catch (e) {
    console.error('[群内管理员]', e)
    await ctx.reply('❌ 获取信息失败，请稍后重试')
  }
})

// 🔥 action 处理器已移至 handlers/core.js

// 🔥 每小时自动更新实时汇率的定时任务
async function updateAllRealtimeRates() {
  try {
    // 🔥 优化：提前获取 botId，避免在循环中重复查询
    const botId = await ensureCurrentBotId()
    
    // 获取最新实时汇率
    const rate = await fetchRealtimeRateUSDTtoCNY()
    if (!rate) {
      return
    }
    
    // 🔥 获取所有群组（包括没有设置实时汇率的）
    const allSettings = await prisma.setting.findMany({
      select: { chatId: true, fixedRate: true, realtimeRate: true }
    })
    
    // 🔥 更新所有使用实时汇率的群组（fixedRate为null的）
    const chatIdsToUpdate = allSettings
      .filter(s => !s.fixedRate) // 只有没有固定汇率的才更新
      .map(s => s.chatId)
    
    if (chatIdsToUpdate.length > 0) {
      await prisma.setting.updateMany({
        where: { 
          chatId: { in: chatIdsToUpdate }
        },
        data: { realtimeRate: rate }
      })
      
      // 🔥 批量更新内存中的汇率（包括未创建的chat对象）
      // 注意：这里只能更新已经存在的chat对象，未创建的会在首次使用时通过syncSettingsToMemory加载
      for (const setting of allSettings) {
        if (!setting.fixedRate) {
          const chat = getChat(botId, setting.chatId)
          if (chat) {
            chat.realtimeRate = rate
          }
        }
      }
      
      if (process.env.DEBUG_BOT === 'true') {
        console.log(`[updateAllRealtimeRates] 已更新 ${chatIdsToUpdate.length} 个群组的实时汇率: ${rate}`)
      }
    }
    
    if (process.env.DEBUG_BOT === 'true') {
      console.log(`[定时任务] 汇率更新完成，新汇率: ${rate}，更新了 ${chatIdsToUpdate.length} 个群组`)
    }
  } catch (e) {
    console.error('[定时任务] 更新汇率失败:', e)
  }
}

// 🔥 保存定时器引用，以便在进程退出时清理，防止内存泄露
const intervals = []

// 🔥 进程退出时清理所有定时器，防止内存泄露
const cleanup = () => {
  console.log('[清理] 正在清理定时器...')
  intervals.forEach(interval => clearInterval(interval))
  intervals.length = 0
  bot.stop('SIGTERM')
}

process.once('SIGTERM', cleanup)
process.once('SIGINT', cleanup)
process.once('SIGHUP', cleanup)

bot.launch().then(async () => {
  console.log('Telegram 机器人已启动')
  
  // 启动后立即执行一次汇率更新
  await updateAllRealtimeRates()
  
  // 🔥 优化：定时任务 - 每小时更新汇率（保存引用）
  intervals.push(setInterval(updateAllRealtimeRates, 3600000))
  console.log('[定时任务] 实时汇率自动更新已启动，每小时更新一次')
  
  // 🔥 新增：自动日切定时任务 - 每10分钟检查一次，确保日切时自动切换
  const autoDailyCutoffTask = async () => {
    try {
      // 直接导入getChat函数，避免动态导入的性能问题
      const { getChat } = await import('./state.js')
      await performAutoDailyCutoff((botId, chatId) => {
        return getChat(botId || process.env.BOT_TOKEN, chatId)
      })
    } catch (e) {
      console.error('[定时任务] 自动日切检查失败:', e)
    }
  }
  
  // 立即执行一次
  await autoDailyCutoffTask()
  
  // 每10分钟检查一次（确保能及时检测到日切）
  intervals.push(setInterval(autoDailyCutoffTask, 10 * 60 * 1000))
  console.log('[定时任务] 自动日切检查已启动，每10分钟检查一次')
  
  // 🔥 新增：内存优化定时任务
  // 1. 每小时清理不活跃的聊天（保存引用）
  intervals.push(setInterval(() => {
    try {
      cleanupInactiveChats()
    } catch (e) {
      console.error('[定时任务] 清理不活跃聊天失败:', e)
    }
  }, 3600000)) // 1小时
  
  // 2. 每6小时清理过期的功能开关缓存（由 middleware.js 内部 LRU 缓存自动处理）
  
  // 3. 每12小时打印内存使用情况（仅在DEBUG模式下，保存引用）
  if (process.env.DEBUG_BOT === 'true') {
    const logMemoryUsage = () => {
      const used = process.memoryUsage()
      console.log('[内存监控]', {
        rss: `${Math.round(used.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(used.external / 1024 / 1024)}MB`
      })
    }
    logMemoryUsage() // 启动时打印一次
    intervals.push(setInterval(logMemoryUsage, 12 * 3600000)) // 12小时
  }
  
  console.log('[内存优化] 定期清理任务已启动')
  
  // 🔥 只保留 /start 命令，其他命令已删除（只使用中文指令）
  const commands = [{ command: 'start', description: '开始使用机器人' }]
  try {
    // 只为私聊设置命令菜单
    await bot.telegram.setMyCommands(commands, { scope: { type: 'all_private_chats' } })
    // 群聊不设置命令菜单（使用中文指令）
    await bot.telegram.setMyCommands([], { scope: { type: 'all_group_chats' } })
    
    // 🔥 更新机器人描述
    try {
      await bot.telegram.setMyDescription(
          '智能记账机器人 - 支持USDT/RMB记账、实时汇率、地址验证。\n\n' +
        '主要功能：\n' +
        '• 基础记账：+金额、下发金额、显示账单\n' +
        '• 数学计算：支持+100-50、+100*2等表达式\n' +
          '• 实时汇率：自动获取USDT到CNY汇率、OKX C2C价格查询\n' +
          '• 查询汇率：查看点位汇率映射关系，支持自定义查询\n' +
          '• 超押提醒：设置额度后自动提醒入款超限\n' +
          '• 全局配置：全局日切时间设置，所有群组统一应用\n' +
        '• 地址验证：检测钱包地址变更并提醒\n' +
          '• 权限管理：显示管理员、权限人、操作员信息\n' +
          '• 机器人退群：一键退群并清除所有数据\n' +
          '• 功能开关：开启所有功能/关闭所有功能\n\n' +
          '私聊机器人发送 /start 开始使用。'
      )
      console.log('已更新机器人描述')
    } catch (e) {
      console.error('设置机器人描述失败（可能需要通过BotFather手动设置）：', e)
    }
    
    console.log('已设置 Telegram 菜单命令：', commands.map(c => c.command).join(', '))
  } catch (e) {
    console.error('设置 Telegram 菜单命令失败：', e)
  }
})
