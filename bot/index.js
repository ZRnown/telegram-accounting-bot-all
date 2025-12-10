// Minimal Telegraf bot with Chinese commands and local proxy support
import 'dotenv/config'
// 默认使用中国时区（如未由环境变量指定）
if (!process.env.TZ) {
  process.env.TZ = 'Asia/Shanghai'
}
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { createPermissionMiddleware, isAccountingCommand, clearFeatureCache } from './middleware.js'
import { buildInlineKb, fetchRealtimeRateUSDTtoCNY, getUsername, isAdmin, hasPermissionWithWhitelist } from './helpers.js'
import { formatSummary } from './formatting.js'
import { registerAllHandlers } from './handlers/index.js'
import { createAliasMiddleware } from './alias-middleware.js'
import logger from './logger.js'

logger.initLogger({ dir: 'logs', level: process.env.DEBUG_BOT === 'true' ? 'debug' : 'info', stdout: true })
logger.hijackConsole()

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
  console.error('   当前 token 长度：', BOT_TOKEN.length)
  console.error('   当前 token 前缀：', BOT_TOKEN.substring(0, 20) + '...')
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
            
            // 自动授权：先确保 Chat 存在，再创建 Setting，避免外键错误
            // 🔥 修复：先创建 Chat，确保成功后再创建 Setting
            const chatResult = await prisma.chat.upsert({
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
            }).catch((e) => {
              console.error('[message][chat-upsert-error]', e)
              return null
            })
            
            // 只有 Chat 创建成功后才创建 Setting
            if (chatResult) {
              await prisma.setting.upsert({
                where: { chatId },
                create: { chatId, accountingEnabled: true }, // 🔥 默认开启记账
                update: {},
              }).catch((e) => {
                console.error('[message][setting-upsert-error]', e)
              })
            }
            // 仅对群聊创建默认功能开关（chatId 以 '-' 开头），避免私聊外键冲突
            if (String(chatId).startsWith('-')) {
              await ensureDefaultFeatures(chatId, prisma)
            }
            
            console.log('[message][auto-authorized]', { chatId, userId })
          } else {
          // 非白名单用户：先创建 Chat，再创建 Setting
          const chatResult = await prisma.chat.upsert({
                where: { id: chatId },
                create: { id: chatId, title, botId, status: 'PENDING', allowed: false },
                update: { title, botId },
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
          }
          }
        } else {
          // 先创建 Chat，再创建 Setting
          const chatResult = await prisma.chat.upsert({
              where: { id: chatId },
              create: { id: chatId, title, status: 'PENDING', allowed: false },
              update: { title },
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
          }
        }
      } catch (e) {
        console.error('[message][whitelist-check-error]', e)
        // 先创建 Chat，再创建 Setting
        const chatResult = await prisma.chat.upsert({
            where: { id: chatId },
            create: { id: chatId, title, status: 'PENDING', allowed: false },
            update: { title },
        }).catch((e2) => {
          console.error('[message][chat-upsert-error]', e2)
          return null
        })
        
        if (chatResult) {
          await prisma.setting.upsert({
            where: { chatId },
            create: { chatId, accountingEnabled: true }, // 🔥 默认开启记账
            update: {},
          }).catch((e2) => {
            console.error('[message][setting-upsert-error]', e2)
          })
        }
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
      where: { token: BOT_TOKEN },
      select: { id: true } // 🔥 只选择需要的字段
    }).catch(() => null)
    
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
          console.error('   当前 token 前缀：', BOT_TOKEN.substring(0, 20) + '...')
          throw new Error('Bot token 无效，无法启动机器人')
        }
        // 🔥 如果超时，记录错误但不阻止启动
        if (e.message === 'TIMEOUT') {
          console.error('⚠️ 链接Telegram API超时（30秒），请检查服务器网络连接')
        } else {
          console.error('[ensureCurrentBotId] 获取机器人信息失败:', e.message)
        }
      }
      row = await prisma.bot.create({ 
        data: { name, token: BOT_TOKEN, enabled: true },
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
    // 允许的命令：/start, /myid, /我, /help, 使用说明
    const allowedInPrivate = /^(?:\/start|\/myid|\/我|\/help|使用说明)$/i.test(text)
    if (!allowedInPrivate && !text.includes('我的账单')) {
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
    
    // 🔥 修复：从 ctx.myChatMember.from 获取邀请人信息
    const from = ctx.myChatMember?.from || upd.from
    const inviterId = String(from?.id || '')
    const inviterUsername = from?.username ? `@${from.username}` : null
    
    // 🔥 调试日志：输出原始数据
    if (process.env.DEBUG_BOT === 'true') {
      console.log('[my_chat_member][raw-data]', {
        from: from,
        inviterId,
        inviterUsername,
        firstName: from?.first_name,
        lastName: from?.last_name
      })
    }
    
    console.log('[my_chat_member]', {
      botId,
      chatId,
      title,
      inviterId,
      inviterUsername,
      inviterName: from ? `${from.first_name || ''} ${from.last_name || ''}`.trim() : '',
      from: from?.username ? `@${from.username}` : from?.id,
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
      // 🔥 修复：在新加入时总是保存邀请人信息
      const res = await prisma.chat.upsert({
        where: { id: chatId },
        create: { 
          id: chatId, 
          title, 
          botId, 
          status: autoAllowed ? 'APPROVED' : 'PENDING', 
          allowed: autoAllowed,
          invitedBy: inviterId || null, // 🔥 保存邀请人ID
          invitedByUsername: inviterUsername || null // 🔥 保存邀请人用户名
        },
        update: { 
          title, 
          botId,
          status: autoAllowed ? 'APPROVED' : undefined,
          allowed: autoAllowed ? true : undefined,
          // 🔥 新加入时总是更新邀请人信息（允许仅有ID时也更新）
          invitedBy: inviterId || null,
          invitedByUsername: inviterUsername || null
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
        
        // 🔥 确保地址验证保持关闭（新建群默认关闭），记账功能默认开启
        await prisma.setting.upsert({
          where: { chatId },
          update: {
            addressVerificationEnabled: false,
            accountingEnabled: true // 🔥 机器人进群后默认开启记账
          },
          create: {
            chatId,
            addressVerificationEnabled: false,
            accountingEnabled: true // 🔥 机器人进群后默认开启记账
          }
        }).catch(() => {})
        
        // 发送欢迎消息
        try {
          await ctx.reply(
            `✅ 欢迎使用记账机器人！\n\n` +
            `您已被自动授权使用，所有功能已启用。\n` +
            `邀请人：${inviterUsername || inviterId}\n\n` +
            `机器人已默认开启记账功能，可直接使用 +金额 开始记账。\n` +
            `发送 "使用说明" 查看详细指南。\n\n` +
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

// 🔥 注册别名中间件（需在注册 handlers 之前）
bot.use(createAliasMiddleware())

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
      // 🔥 获取当前机器人的 botId
      const currentBotId = await ensureCurrentBotId().catch(() => null)
      
      // 🔥 检查该群聊中是否还有其他该用户的机器人
      // 查询该群聊绑定的其他机器人（不包括当前机器人）
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        select: { botId: true }
      }).catch(() => null)
      
      // 🔥 如果该群聊绑定的机器人就是当前机器人，或者没有绑定机器人
      // 需要检查是否还有其他机器人也在该群中
      let hasOtherBots = false
      let otherBotId = null // 🔥 记录其他机器人的 botId
      if (currentBotId) {
        // 查询所有启用的机器人（排除当前机器人）
        const otherBots = await prisma.bot.findMany({
          where: { 
            enabled: true,
            id: { not: currentBotId }
          },
          select: { id: true, token: true }
        }).catch(() => [])
        
        // 🔥 检查这些机器人是否在该群中
        for (const bot of otherBots) {
          if (!bot.token) continue
          try {
            const url = `https://api.telegram.org/bot${encodeURIComponent(bot.token)}/getChat?chat_id=${encodeURIComponent(chatId)}`
            const resp = await fetch(url, { 
              method: 'GET',
              signal: AbortSignal.timeout(2000) // 2秒超时
            })
            if (resp.ok) {
              const json = await resp.json().catch(() => null)
              if (json?.ok) {
                hasOtherBots = true
                otherBotId = bot.id // 🔥 记录第一个找到的其他机器人的 botId
                break
              }
            }
          } catch {
            // 忽略错误，继续检查下一个
          }
        }
      }
      
      // 🔥 只有当该群中没有其他机器人时，才删除群聊记录
      if (!hasOtherBots) {
        await prisma.operator.deleteMany({ where: { chatId } }).catch(() => {})
        await prisma.setting.deleteMany({ where: { chatId } }).catch(() => {})
        await prisma.chat.delete({ where: { id: chatId } }).catch(() => {})
        console.log('[机器人退群] 已删除群聊记录', { chatId, currentBotId })
      } else {
        // 🔥 如果还有其他机器人，更新 Chat 记录的 botId 为其他机器人的 botId
        // 这样其他机器人就可以继续使用这条记录
        if (otherBotId) {
          await prisma.chat.update({
            where: { id: chatId },
            data: { botId: otherBotId }
          }).catch(() => {})
          console.log('[机器人退群] 群中还有其他机器人，更新 botId 并保留群聊记录', { 
            chatId, 
            currentBotId, 
            newBotId: otherBotId 
          })
        } else {
          console.log('[机器人退群] 群中还有其他机器人，保留群聊记录', { chatId, currentBotId })
        }
      }
    }
  } catch (e) {
    console.error('[my_chat_member] 处理失败', e)
  }
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

// 🔥 "开始记账"命令已移至 handlers/accounting.js，删除此处的冗余代码

// 上课：开始计时（若已在计时则忽略）
bot.hears(/^(上课|开始上课)$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  await ensureDbChat(ctx)
  chat.muteMode = false
  chat.workStartedAt = null
  try { await setChatMute(ctx, false) } catch {}
  await ctx.reply('本群已开始营业')
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
  await ctx.reply('本群今日已下课\n\n如需交易，请在该群恢复营业后在群内交易！ 切勿私下交易！')
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
  
  // 🔥 检查是否是简单数字（如 +1000、-1000），不是计算表达式
  const isSimpleNumber = /^[+\-]?\s*\d+(?:\.\d+)?$/i.test(text.replace(/\s+/g, ''))
  if (isSimpleNumber) {
    return // 简单数字不是计算表达式，让记账处理器处理
  }
  
  // 🔥 检查计算器是否启用
  const chatId = await ensureDbChat(ctx)
  if (chatId) {
    // 🔥 性能优化：一次性查询所有需要的设置
    const setting = await prisma.setting.findUnique({ 
      where: { chatId }, 
      select: { calculatorEnabled: true, featureWarningMode: true } 
    })
    const calculatorEnabled = setting?.calculatorEnabled !== false // 默认开启
    
    if (!calculatorEnabled) {
      // 🔥 使用功能提示逻辑
      const warningMode = setting?.featureWarningMode || 'always'
      let shouldWarn = false
      
      if (warningMode === 'always') {
        shouldWarn = true
        await prisma.featureWarningLog.deleteMany({
          where: { chatId, feature: 'calculator_disabled' }
        }).catch(() => {})
      } else if (warningMode === 'once') {
        const existingLog = await prisma.featureWarningLog.findUnique({
          where: { chatId_feature: { chatId, feature: 'calculator_disabled' } }
        })
        if (!existingLog) {
          shouldWarn = true
          await prisma.featureWarningLog.upsert({
            where: { chatId_feature: { chatId, feature: 'calculator_disabled' } },
            create: { chatId, feature: 'calculator_disabled' },
            update: { warnedAt: new Date() }
          }).catch(() => {})
        }
      } else if (warningMode === 'daily') {
        const existingLog = await prisma.featureWarningLog.findUnique({
          where: { chatId_feature: { chatId, feature: 'calculator_disabled' } }
        })
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        if (!existingLog || existingLog.warnedAt < today) {
          shouldWarn = true
          await prisma.featureWarningLog.upsert({
            where: { chatId_feature: { chatId, feature: 'calculator_disabled' } },
            create: { chatId, feature: 'calculator_disabled' },
            update: { warnedAt: now }
          }).catch(() => {})
        }
      }
      
      if (shouldWarn) {
        return ctx.reply('⚠️ 计算器功能已关闭，不支持数学计算。请使用简单数字格式。')
      }
      return // 不提醒，直接返回
    }
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

// 🔥 所有记账、下发、账单、设置相关命令已移至 handlers 模块，通过 registerAllHandlers 统一注册
// 这里只保留一些特殊的或全局的处理器

// 🔥 OKX C2C价格查询已移至 handlers/okx.js

// 🔥 添加操作员方式三：添加操作员 @所有人（群内所有人都可以记账）- 需要先匹配，避免被方式一捕获
bot.hears(/^添加操作员\s+@所有人$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 🔥 优化：使用统一的权限检查函数
  if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
  }
  
  const chatId = await ensureDbChat(ctx)
  chat.everyoneAllowed = true
  await updateSettings(chatId, { everyoneAllowed: true })
  await ctx.reply('✅ 已开启：所有人可操作（群内所有人都可以记账）')
})

// 🔥 添加操作员方式一：添加操作员 @AAA @BBB（支持多个用户名）
bot.hears(/^添加操作员\s+/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 🔥 优化：使用统一的权限检查函数
  if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
  }
  
  const text = ctx.message.text || ''
  // 🔥 排除 @所有人 的情况（已在上面处理）
  if (/@所有人/.test(text)) {
    return // 已由上面的处理器处理
  }
  
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
  
  // 🔥 优化：使用统一的权限检查函数
  if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
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

// 🔥 删除操作员方式一：删除操作员 @AAA @BBB（支持多个用户名）
bot.hears(/^删除操作员\s+/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 🔥 优化：使用统一的权限检查函数
  if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
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
  
  // 🔥 优化：使用统一的权限检查函数
  if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
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

// 模式相关已迁移至 handlers/modes.js

// 🔥 撤销入款：撤销最近一条入款记录（已迁移至 handlers/bill.js，此处保留作为备用）
// 注意：如果 handlers/bill.js 中的 registerUndoIncome 已注册，这里的代码可能不会执行
bot.hears(/^撤销入款$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 🔥 优化：使用统一的权限检查函数
  if (!(await hasPermissionWithWhitelist(ctx, chat))) {
    return ctx.reply('⚠️ 您没有撤销权限。只有管理员或已添加的操作人可以操作。')
  }
  
  const chatId = await ensureDbChat(ctx)
  
  // 🔥 检查是否有回复消息
  const replyToMessage = ctx.message.reply_to_message
  let deleted = null
  
  if (replyToMessage && replyToMessage.message_id) {
    // 如果有回复，通过 messageId 删除对应的记录
    deleted = await deleteIncomeByMessageId(chatId, replyToMessage.message_id)
    if (!deleted) {
      return ctx.reply('❌ 未找到对应的入款记录（可能该消息不是入款记录）')
    }
  } else {
    // 如果没有回复，删除最后一条
    deleted = await deleteLastIncome(chatId)
    if (!deleted) {
      return ctx.reply('❌ 未找到可撤销的入款记录')
    }
  }
  
    // 更新内存 current
    const idx = [...chat.current.incomes].reverse().findIndex(r => Math.abs(r.amount - deleted.amount) < 1e-9)
    if (idx >= 0) chat.current.incomes.splice(chat.current.incomes.length - 1 - idx, 1)
  
  const message = replyToMessage 
    ? `✅ 已撤销指定的入款记录：${deleted.amount}`
    : `✅ 已撤销最近一条入款记录：${deleted.amount}`
  await ctx.reply(message)
})

// 🔥 撤销下发：撤销最近一条下发记录（已迁移至 handlers/bill.js，此处保留作为备用）
// 注意：如果 handlers/bill.js 中的 registerUndoDispatch 已注册，这里的代码可能不会执行
bot.hears(/^撤销下发$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 🔥 优化：使用统一的权限检查函数
  if (!(await hasPermissionWithWhitelist(ctx, chat))) {
    return ctx.reply('⚠️ 您没有撤销权限。只有管理员或已添加的操作人可以操作。')
  }
  
  const chatId = await ensureDbChat(ctx)
  
  // 🔥 检查是否有回复消息
  const replyToMessage = ctx.message.reply_to_message
  let deleted = null
  
  if (replyToMessage && replyToMessage.message_id) {
    // 如果有回复，通过 messageId 删除对应的记录
    deleted = await deleteDispatchByMessageId(chatId, replyToMessage.message_id)
    if (!deleted) {
      return ctx.reply('❌ 未找到对应的下发记录（可能该消息不是下发记录）')
    }
  } else {
    // 如果没有回复，删除最后一条
    deleted = await deleteLastDispatch(chatId)
    if (!deleted) {
      return ctx.reply('❌ 未找到可撤销的下发记录')
    }
  }
  
    // 更新内存 current
    const idx = [...chat.current.dispatches].reverse().findIndex(r => Math.abs(r.amount - deleted.amount) < 1e-9)
    if (idx >= 0) chat.current.dispatches.splice(chat.current.dispatches.length - 1 - idx, 1)
  
  const message = replyToMessage 
    ? `✅ 已撤销指定的下发记录：${deleted.usdt}U`
    : `✅ 已撤销最近一条下发记录：${deleted.usdt}U`
  await ctx.reply(message)
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
        const remark = item.remark // 🔥 获取备注
        
        if (isIncome) {
          totalIncome += amount
          let line = ''
          if (item.rate) {
            line = `💰 +${amount} / ${item.rate}=${usdt.toFixed(1)}U`
          } else {
            line = `💰 +${amount}${usdt > 0 ? ` (${usdt.toFixed(1)}U)` : ''}`
          }
          // 🔥 如果有备注，在账单后面显示备注
          if (remark) {
            line += ` [${remark}]`
          }
          lines.push(line)
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
    // 🔥 优化：使用统一的权限检查函数
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
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
    take: 50 // 🔥 扩大查询范围，提高匹配准确性
  })
  
  if (!items.length) {
    return ctx.reply('❌ 未找到对应的记录')
  }
  
  // 🔥 尝试匹配最近几条记录
  // 优先匹配：1. 精确金额 2. 备注内容 3. 时间戳附近
  let matchedItem = null
  
  // 方法1: 尝试从回复文本中提取金额和备注
  const amountMatch = replyText.match(/(\d+(?:\.\d+)?)/)
  const remarkMatch = replyText.match(/\[([^\]]+)\]/) // 匹配 [备注] 格式
  
  for (const item of items) {
    const itemAmount = Math.abs(Number(item.amount) || 0)
    let matchScore = 0
    
    // 检查金额是否匹配
    if (amountMatch) {
      const replyAmount = Math.abs(Number(amountMatch[1]))
      if (Math.abs(itemAmount - replyAmount) < 0.01) {
        matchScore += 10 // 金额匹配权重高
      }
    } else {
      // 如果没有明确金额，检查文本中是否包含金额
    if (replyText.includes(String(Math.round(itemAmount))) || 
        replyText.includes(String(itemAmount.toFixed(2)))) {
        matchScore += 5
      }
    }
    
    // 检查备注是否匹配
    if (remarkMatch && item.remark) {
      const replyRemark = remarkMatch[1].trim()
      if (item.remark.includes(replyRemark) || replyRemark.includes(item.remark)) {
        matchScore += 5
      }
    }
    
    // 如果匹配分数足够高，选择这个记录
    if (matchScore >= 10 || (!matchedItem && matchScore > 0)) {
      matchedItem = item
      if (matchScore >= 10) break // 如果金额精确匹配，直接使用
    }
  }
  
  // 如果还是没匹配到，删除最近一条记录
  if (!matchedItem && items.length > 0) {
    matchedItem = items[0]
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

// 单显/双显模式已迁移至 handlers/modes.js

// 记账/佣金模式已迁移至 handlers/modes.js

// 在"回复某个用户的消息"时，用 +N/-N 调整佣金
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
  
  // 🔥 优化：使用统一的权限检查函数
  if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
  }
  
  const chatId = await ensureDbChat(ctx)
  
  // 🔥 开启所有功能开关
  const featuresCreated = await ensureDefaultFeatures(chatId, prisma, true)
  
  // 🔥 确保所有功能都是启用状态
  await prisma.chatFeatureFlag.updateMany({
    where: { chatId },
    data: { enabled: true }
  })
  
  // 🔥 开启计算器功能
  await prisma.setting.upsert({
    where: { chatId },
    update: { calculatorEnabled: true },
    create: { chatId, calculatorEnabled: true }
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
  
  // 🔥 优化：使用统一的权限检查函数
  if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
  }
  
  const chatId = await ensureDbChat(ctx)
  
  // 🔥 关闭所有功能开关（确保即使记录不存在也创建 enabled: false 的记录）
  const { DEFAULT_FEATURES } = await import('./constants.ts')
  for (const feature of DEFAULT_FEATURES) {
    await prisma.chatFeatureFlag.upsert({
      where: {
        chatId_feature: {
          chatId,
          feature
        }
      },
      update: { enabled: false },
      create: {
        chatId,
        feature,
        enabled: false
      }
    })
  }
  
  // 🔥 关闭计算器功能
  await prisma.setting.upsert({
    where: { chatId },
    update: { calculatorEnabled: false },
    create: { chatId, calculatorEnabled: false }
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
  
  // 🔥 优化：使用统一的权限检查函数
  if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
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
  
  // 🔥 优化：使用统一的权限检查函数
  if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
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

// 🔥 查询汇率、设置额度、管理员信息已移至 handlers/admin.js

// 🔥 action 处理器已移至 handlers/core.js

// 🔥 每10分钟自动更新实时汇率的定时任务（使用 OKX C2C 第一个汇率，与 z0 命令保持一致）
async function updateAllRealtimeRates() {
  try {
    const botId = await ensureCurrentBotId()
    // 获取所有群组设置
    const allSettings = await prisma.setting.findMany({
      select: { chatId: true, fixedRate: true }
    })
    if (!allSettings || allSettings.length === 0) return

    // 🔥 从 OKX C2C 获取第一个汇率（所有支付方式，与 z0 命令保持一致）
    const { getOKXC2CSellers } = await import('../lib/okx-api.js')
    const sellers = await getOKXC2CSellers('all')
    
    if (!sellers || sellers.length === 0) {
      console.error('[定时任务] 获取OKX汇率失败，跳过本次更新')
      return
    }

    // 使用第一个汇率（最低价格，与 z0 命令显示的第一个一致）
    const okxRate = sellers[0].price

    // 🔥 批量更新所有使用实时汇率的群组
    let updated = 0
    for (const s of allSettings) {
      if (s.fixedRate) continue // 跳过使用固定汇率的群组
      
      // 更新数据库和内存
      await prisma.setting.update({ 
        where: { chatId: s.chatId }, 
        data: { realtimeRate: okxRate } 
      })
      const chat = getChat(botId, s.chatId)
      if (chat) {
        chat.realtimeRate = okxRate
      }
      updated++
    }

    if (process.env.DEBUG_BOT === 'true') {
      console.log(`[定时任务] OKX汇率更新完成，更新 ${updated} 个群组，汇率：${okxRate}`)
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

bot.launch().catch((error) => {
  console.error('❌ 机器人启动失败！')
  if (error.response?.error_code === 401 || error.message?.includes('401') || error.message?.includes('Unauthorized')) {
    console.error('   错误：401 Unauthorized - Bot Token 无效或已过期')
    console.error('   请检查：')
    console.error('   1. 数据库中的 bot token 是否正确')
    console.error('   2. 环境变量 BOT_TOKEN 是否正确设置')
    console.error('   3. 是否在 @BotFather 处重新生成了 token')
    console.error('   4. Token 格式是否正确（不应包含多余空格或换行符）')
    console.error('   当前 token 前缀：', BOT_TOKEN.substring(0, 20) + '...')
  } else {
    console.error('   错误详情：', error.message)
    console.error('   完整错误：', error)
  }
  process.exit(1)
}).then(async () => {
  console.log('✅ Telegram 机器人已启动')
  
  // 启动后立即执行一次汇率更新
  await updateAllRealtimeRates()
  
  // 🔥 定时任务 - 每10分钟更新汇率（使用 OKX C2C 第一个汇率，与 z0 命令保持一致）
  intervals.push(setInterval(updateAllRealtimeRates, 10 * 60 * 1000))
  console.log('[定时任务] 实时汇率自动更新已启动，每10分钟更新一次（使用 OKX C2C 第一个汇率）')
  
  // 🔥 新增：自动日切定时任务 - 每10分钟检查一次，确保日切时自动切换
  const autoDailyCutoffTask = async () => {
    try {
      // 直接导入getChat函数，避免动态导入的性能问题
      const { getChat } = await import('./state.js')
      await performAutoDailyCutoff((botId, chatId) => {
        return getChat(botId || BOT_TOKEN, chatId)
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
  // 1. 🔥 内存优化：每30分钟清理不活跃的聊天（从1小时改为30分钟）
  intervals.push(setInterval(() => {
    try {
      cleanupInactiveChats()
    } catch (e) {
      console.error('[定时任务] 清理不活跃聊天失败:', e)
    }
  }, 30 * 60 * 1000)) // 🔥 内存优化：30分钟
  
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
        '• 基础记账：+金额、下发金额、显示账单、备注支持\n' +
        '• 数学计算：支持288-32、288*2、288/2、288+21等（需打开计算器）\n' +
          '• 实时汇率：自动获取USDT到CNY汇率、OKX C2C价格查询\n' +
          '• 查询汇率：查看点位汇率映射关系，支持自定义查询\n' +
          '• 超押提醒：设置额度后自动提醒入款超限\n' +
          '• 记账模式：支持每日清零、累计模式、单笔订单三种模式\n' +
          '• 日切时间：可设置每日结算起始时间（累计模式不支持）\n' +
        '• 地址验证：检测钱包地址变更并提醒\n' +
          '• 权限管理：显示管理员、权限人、操作员信息（群主优先显示）\n' +
          '• 机器人退群：一键退群并清除所有数据\n' +
          '• 功能开关：开启所有功能/关闭所有功能、计算器开关\n\n' +
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
