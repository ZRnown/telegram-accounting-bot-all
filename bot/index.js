// Minimal Telegraf bot with Chinese commands and local proxy support
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'


import { Telegraf, Markup } from 'telegraf'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { getChat, parseAmountAndRate, summarize, safeCalculate, cleanupInactiveChats } from './state.js'
import { prisma } from '../lib/db.ts'
import { ensureDefaultFeatures } from './constants.ts'
import { LRUCache } from './lru-cache.js'
import { getOKXC2CSellers } from '../lib/okx-api.ts'

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

function getUsername(ctx) {
  // 记账时不使用 @ 符号，直接返回用户名或姓名
  const u = ctx.from?.username
  if (u) return u
  const firstName = ctx.from?.first_name || ''
  const lastName = ctx.from?.last_name || ''
  return [firstName, lastName].filter(Boolean).join(' ') || '未知用户'
}

function ensureChat(ctx) {
  const chatId = ctx.chat?.id
  if (chatId == null) return null
  if (!CURRENT_BOT_ID) return null
  return getChat(CURRENT_BOT_ID, chatId)
}

async function ensureDbChat(ctx) {
  const chatId = String(ctx.chat?.id)
  let title = ctx.chat?.title || null
  // 为私聊设置人类可读标题：@username 或 姓名
  if (!title && ctx.chat && ctx.chat.type === 'private') {
    const u = ctx.chat
    title = u.username ? `@${u.username}` : [u.first_name, u.last_name].filter(Boolean).join(' ') || null
  }
  if (!chatId) return null
  // upsert chat，首次仅登记群组信息，不绑定机器人，默认待审批
  await prisma.chat.upsert({
    where: { id: chatId },
    update: { title },
    create: { id: chatId, title, status: 'PENDING', allowed: false },
  })
  // ensure settings
  await prisma.setting.upsert({
    where: { chatId },
    update: {},
    create: { chatId },
  })
  // Sync in-memory chat state with DB settings so summaries use latest fee/rate
  // 🔥 优化：合并查询，减少数据库访问次数
  const chat = ensureChat(ctx)
  try {
    // 🔥 并行查询设置和操作人列表（如果需要）
    const [settings, needOperators] = await Promise.all([
      prisma.setting.findUnique({ 
        where: { chatId },
        select: {
          feePercent: true,
          fixedRate: true,
          realtimeRate: true,
          headerText: true,
          everyoneAllowed: true
        }
      }),
      chat ? (async () => {
        const lastSyncTime = chat._operatorsLastSync || 0
        const now = Date.now()
        return (now - lastSyncTime > 5 * 60 * 1000 || chat.operators.size === 0)
      })() : Promise.resolve(false)
    ])
    
    if (settings && chat) {
      if (typeof settings.feePercent === 'number') chat.feePercent = settings.feePercent
      if (settings.fixedRate != null) chat.fixedRate = settings.fixedRate
      if (settings.realtimeRate != null) chat.realtimeRate = settings.realtimeRate
      if (settings.headerText != null) chat.headerText = settings.headerText
      if (typeof settings.everyoneAllowed === 'boolean') chat.everyoneAllowed = settings.everyoneAllowed
      
      // 🔥 如果没有设置任何汇率，默认启用实时汇率
      if (settings.fixedRate == null && settings.realtimeRate == null) {
        const rate = await fetchRealtimeRateUSDTtoCNY()
        if (rate) {
          chat.realtimeRate = rate
          await updateSettings(chatId, { realtimeRate: rate })
          if (process.env.DEBUG_BOT === 'true') {
            console.log(`[ensureDbChat][auto-set-realtime-rate] chatId=${chatId}, rate=${rate}`)
          }
        }
      }
    }
    
    // 🔥 从数据库同步操作人列表到内存（修复操作人权限不生效的问题）
    // 🔥 优化：使用缓存，避免每次都查询数据库
    if (chat && needOperators) {
      const operators = await prisma.operator.findMany({ where: { chatId }, select: { username: true } })
      chat.operators.clear()
      for (const op of operators) {
        chat.operators.add(op.username)
      }
      chat._operatorsLastSync = Date.now()
    }
  } catch (e) {
    console.error('同步设置到内存失败', e)
  }
  return chatId
}

async function updateSettings(chatId, data) {
  await prisma.setting.update({ where: { chatId }, data })
  // 🔥 如果更新了日切时间，清除缓存
  if (data.dailyCutoffHour !== undefined) {
    clearDailyCutoffCache(chatId)
  }
}

/**
 * 获取群组的日切时间设置（带缓存优化）
 * @param {string} chatId - 群组ID
 * @returns {Promise<number>} 日切小时（0-23）
 */
// 🔥 缓存日切时间设置，减少数据库查询
const dailyCutoffCache = new Map() // Map<chatId, { value: number, timestamp: number }>
const CUTOFF_CACHE_TTL = 5 * 60 * 1000 // 5分钟缓存

async function getDailyCutoffHour(chatId) {
  try {
    // 🔥 检查缓存
    const cached = dailyCutoffCache.get(chatId)
    if (cached && (Date.now() - cached.timestamp < CUTOFF_CACHE_TTL)) {
      return cached.value
    }
    
    // 🔥 查询数据库
    const setting = await prisma.setting.findUnique({
      where: { chatId },
      select: { dailyCutoffHour: true }
    })
    const value = setting?.dailyCutoffHour ?? 0
    
    // 🔥 更新缓存
    dailyCutoffCache.set(chatId, { value, timestamp: Date.now() })
    
    // 🔥 清理过期缓存（每100次调用清理一次）
    if (dailyCutoffCache.size > 1000) {
      const now = Date.now()
      for (const [key, val] of dailyCutoffCache.entries()) {
        if (now - val.timestamp >= CUTOFF_CACHE_TTL) {
          dailyCutoffCache.delete(key)
        }
      }
    }
    
    return value
  } catch (e) {
    console.error('[getDailyCutoffHour][error]', e)
    return 0  // 默认0点
  }
}

/**
 * 🔥 清除日切时间缓存（当设置更新时调用）
 */
function clearDailyCutoffCache(chatId) {
  dailyCutoffCache.delete(chatId)
}

/**
 * 🔥 获取或创建当天的OPEN账单（优化重复代码）
 * @param {string} chatId - 群组ID
 * @returns {Promise<{bill: any, gte: Date, lt: Date}>}
 */
async function getOrCreateTodayBill(chatId) {
  const cutoffHour = await getDailyCutoffHour(chatId)
  const now = new Date()
  const gte = startOfDay(now, cutoffHour)
  const lt = endOfDay(now, cutoffHour)
  
  let bill = await prisma.bill.findFirst({ 
    where: { chatId, status: 'OPEN', openedAt: { gte, lt } }, 
    orderBy: { openedAt: 'asc' } 
  })
  
  if (!bill) {
    // 🔥 创建新账单时，使用当天的起始时间（gte）作为 openedAt，确保查询时能匹配到
    bill = await prisma.bill.create({ 
      data: { 
        chatId, 
        status: 'OPEN', 
        openedAt: new Date(gte), // 🔥 使用当天的起始时间，而不是当前时间
        savedAt: new Date() 
      } 
    })
    if (process.env.DEBUG_BOT === 'true') {
      console.log('[记账][创建新账单]', { chatId, billId: bill.id, openedAt: gte, cutoffHour })
    }
  }
  
  return { bill, gte, lt }
}

/**
 * 日切时间函数 - 支持自定义小时
 * @param {Date} d - 基准日期
 * @param {number} cutoffHour - 日切小时（0-23），默认0点
 * @returns {Date} 当天日切时间点
 */
function startOfDay(d = new Date(), cutoffHour = 0) {
  const x = new Date(d)
  x.setHours(cutoffHour, 0, 0, 0)
  
  // 如果当前时间在日切点之前，需要退到前一天的日切点
  if (d.getHours() < cutoffHour) {
    x.setDate(x.getDate() - 1)
  }
  
  return x
}

function endOfDay(d = new Date(), cutoffHour = 0) {
  const x = new Date(d)
  x.setDate(x.getDate() + 1)
  x.setHours(cutoffHour, 0, 0, 0)
  
  // 如果当前时间在日切点之前，endOfDay 也要相应调整
  if (d.getHours() < cutoffHour) {
    x.setDate(x.getDate() - 1)
  }
  
  return x
}

/**
 * 计算历史未下发金额（用于累计模式）
 * 读取今天之前所有账单（包括未关闭的），计算累计未下发
 */
async function getHistoricalNotDispatched(chatId, settings) {
  try {
    // 只在累计模式下才计算历史
    if (settings?.accountingMode !== 'CARRY_OVER') {
      return { notDispatched: 0, notDispatchedUSDT: 0 }
    }

    const cutoffHour = await getDailyCutoffHour(chatId)
    const today = startOfDay(new Date(), cutoffHour)
    // 🔥 查找今天之前所有账单（包括OPEN和CLOSED状态）
    // 优化：只选择必要的字段，减少内存占用
    const historicalBills = await prisma.bill.findMany({
      where: { 
        chatId, 
        openedAt: { lt: today }  // 使用 openedAt 而不是 closedAt
      },
      include: { 
        items: {
          select: {
            type: true,
            amount: true,
            rate: true
          }
        }
      },
      orderBy: { openedAt: 'asc' }
    })

    const feePercent = settings?.feePercent ?? 0
    const fixedRate = settings?.fixedRate ?? null
    const realtimeRate = settings?.realtimeRate ?? null

    let totalHistoricalIncome = 0
    let totalHistoricalDispatch = 0
    let totalHistoricalIncomeUSDT = 0
    let totalHistoricalDispatchUSDT = 0

    for (const bill of historicalBills) {
      const incomes = bill.items.filter(i => i.type === 'INCOME')
      const dispatches = bill.items.filter(i => i.type === 'DISPATCH')

      const billIncome = incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0)
      const billDispatch = dispatches.reduce((s, d) => s + (Number(d.amount) || 0), 0)

      // 计算汇率
      let rate = fixedRate ?? realtimeRate ?? 0
      if (!rate) {
        const lastIncWithRate = [...incomes].reverse().find(i => i.rate && i.rate > 0)
        if (lastIncWithRate?.rate) rate = Number(lastIncWithRate.rate)
      }

      // 扣除费用后的应下发（允许负数）
      const fee = (billIncome * feePercent) / 100
      const shouldDispatch = billIncome - fee  // 移除 Math.max，允许负数
      const shouldDispatchUSDT = rate ? Number((shouldDispatch / rate).toFixed(2)) : 0

      totalHistoricalIncome += shouldDispatch
      totalHistoricalDispatch += billDispatch
      totalHistoricalIncomeUSDT += shouldDispatchUSDT
      totalHistoricalDispatchUSDT += rate ? Number((billDispatch / rate).toFixed(2)) : 0
    }

    // 允许负数：当历史下发超过收入时显示负数
    const notDispatched = totalHistoricalIncome - totalHistoricalDispatch
    const notDispatchedUSDT = totalHistoricalIncomeUSDT - totalHistoricalDispatchUSDT

    return { notDispatched, notDispatchedUSDT }
  } catch (e) {
    console.error('计算历史未下发金额失败', e)
    return { notDispatched: 0, notDispatchedUSDT: 0 }
  }
}

async function deleteLastIncome(chatId) {
  const { bill } = await getOrCreateTodayBill(chatId)
  
  // 🔥 从 BillItem 表查询（新的存储方式）
  if (!bill) return false
  
  // 查找账单中的最后一个入款记录
  const lastItem = await prisma.billItem.findFirst({
    where: { billId: bill.id, type: 'INCOME' },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!lastItem) return false
  
  await prisma.billItem.delete({ where: { id: lastItem.id } })
  return { amount: Number(lastItem.amount), rate: lastItem.rate ? Number(lastItem.rate) : undefined }
}

async function deleteLastDispatch(chatId) {
  const { bill } = await getOrCreateTodayBill(chatId)
  
  // 🔥 从 BillItem 表查询（新的存储方式）
  if (!bill) return false
  
  // 查找账单中的最后一个下发记录
  const lastItem = await prisma.billItem.findFirst({
    where: { billId: bill.id, type: 'DISPATCH' },
    orderBy: { createdAt: 'desc' }
  })
  
  if (!lastItem) return false
  
  await prisma.billItem.delete({ where: { id: lastItem.id } })
  return { amount: Number(lastItem.amount), usdt: lastItem.usdt ? Number(lastItem.usdt) : 0 }
}

async function isAdmin(ctx) {
  try {
    const admins = await ctx.getChatAdministrators()
    const uid = ctx.from?.id
    return !!admins.find(a => a.user?.id === uid)
  } catch {
    return false
  }
}

/**
 * 检查用户是否有操作权限（记账权限）
 * 规则：
 * 1. 管理员默认有权限
 * 2. 操作人列表中的用户有权限
 * 3. 如果启用了"所有人可操作"，则所有人都有权限
 */
async function hasOperatorPermission(ctx) {
  const chat = ensureChat(ctx)
  if (!chat) return false
  
  // 如果启用了"所有人可操作"，直接通过
  if (chat.everyoneAllowed) return true
  
  // 检查是否是管理员
  if (await isAdmin(ctx)) return true
  
  // 检查是否在操作人列表中
  const username = ctx.from?.username ? `@${ctx.from.username}` : null
  if (username && chat.operators.has(username)) return true
  
  return false
}

function formatMoney(n) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const parts = []
  if (h) parts.push(`${h}小时`)
  if (m) parts.push(`${m}分`)
  if (s || parts.length === 0) parts.push(`${s}秒`)
  return parts.join('')
}

// 🔥 优化：使用 LRU 缓存替代无限增长的 Map
const featureCache = new LRUCache(500) // 最多缓存 500 个群组的功能开关
const FEATURE_TTL_MS = 60 * 60 * 1000 // 1小时过期，释放内存

async function isFeatureEnabled(ctx, feature) {
  try {
    const chatId = await ensureDbChat(ctx)
    if (!chatId) return false
    
    const now = Date.now()
    const cached = featureCache.get(chatId)
    if (cached && cached.expires > now) {
      return cached.set.has(feature)
    }
    
    // 🔥 从群组级别的功能开关读取（ChatFeatureFlag）
    // 优化：只选择必要的字段，减少内存占用
    const flags = await prisma.chatFeatureFlag.findMany({ 
      where: { chatId }, 
      select: { feature: true, enabled: true } 
    })
    const set = new Set(flags.filter(f => f.enabled).map(f => f.feature))
    featureCache.set(chatId, { expires: now + FEATURE_TTL_MS, set })
    return set.has(feature)
  } catch {
    return false
  }
}

async function ensureFeature(ctx, feature) {
  const ok = await isFeatureEnabled(ctx, feature)
  if (!ok) {
    // 🔥 根据群组设置决定是否发送提示
    try {
      const chatId = await ensureDbChat(ctx)
      const setting = await prisma.setting.findUnique({ 
        where: { chatId },
        select: { featureWarningMode: true }
      })
      
      const warningMode = setting?.featureWarningMode || 'always'
      let shouldWarn = false
      
      if (warningMode === 'always') {
        // 每次都提示
        shouldWarn = true
      } else if (warningMode === 'once') {
        // 只提示一次（检查是否已经提示过）
        const existingLog = await prisma.featureWarningLog.findUnique({
          where: { chatId_feature: { chatId, feature } }
        })
        if (!existingLog) {
          shouldWarn = true
          // 记录已提示
          await prisma.featureWarningLog.upsert({
            where: { chatId_feature: { chatId, feature } },
            create: { chatId, feature },
            update: { warnedAt: new Date() }
          }).catch(() => {})
        }
      } else if (warningMode === 'daily') {
        // 每天提示一次
        const existingLog = await prisma.featureWarningLog.findUnique({
          where: { chatId_feature: { chatId, feature } }
        })
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        
        if (!existingLog || existingLog.warnedAt < today) {
          shouldWarn = true
          // 更新最后提示时间
          await prisma.featureWarningLog.upsert({
            where: { chatId_feature: { chatId, feature } },
            create: { chatId, feature },
            update: { warnedAt: now }
          }).catch(() => {})
        }
      }
      // warningMode === 'silent' 时不提示
      
      if (shouldWarn) {
        await ctx.reply('未开通该功能')
      }
    } catch (e) {
      console.error('[ensureFeature][warning-error]', e)
    }
  }
  return ok
}

function isPublicUrl(u) {
  try {
    const url = new URL(u)
    const host = url.hostname
    if (!/^https?:$/.test(url.protocol)) return false
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false
    return true
  } catch {
    return false
  }
}

async function fetchCoinGeckoRateUSDTtoCNY() {
  try {
    const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=cny', { method: 'GET' })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const rate = Number(data?.tether?.cny)
    if (!rate || !Number.isFinite(rate)) throw new Error('Invalid CoinGecko rate')
    return rate
  } catch (e) {
    if (process.env.DEBUG_BOT === 'true') {
      console.error('CoinGecko 汇率获取失败', e)
    }
    return null
  }
}

async function fetchExchangeRateHostUSDToCNY() {
  try {
    const resp = await fetch('https://api.exchangerate.host/latest?base=USD&symbols=CNY', { method: 'GET' })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const rate = Number(data?.rates?.CNY)
    if (!rate || !Number.isFinite(rate)) throw new Error('Invalid exchangerate.host rate')
    return rate
  } catch (e) {
    if (process.env.DEBUG_BOT === 'true') {
      console.error('exchangerate.host 汇率获取失败', e)
    }
    return null
  }
}

async function fetchRealtimeRateUSDTtoCNY() {
  const secondary = await fetchCoinGeckoRateUSDTtoCNY()
  if (secondary) return Number(secondary.toFixed(2)) // 🔥 保留2位小数
  const tertiary = await fetchExchangeRateHostUSDToCNY()
  return tertiary ? Number(tertiary.toFixed(2)) : null // 🔥 保留2位小数
}

async function buildInlineKb(ctx, options = {}) {
  const rows = []
  const chatId = String(ctx?.chat?.id || '')
  
  // 🔥 如果指定了 hideHelpAndOrder，不显示使用说明和查看完整订单（用于 z0 命令）
  if (options.hideHelpAndOrder) {
    return Markup.inlineKeyboard(rows) // 返回空菜单
  }
  
  // 🔥 私聊时显示特殊菜单
  if (ctx.chat?.type === 'private') {
    rows.push([
      Markup.button.callback('使用说明', 'help'),
      Markup.button.callback('开始记账', 'start_accounting')
    ])
    return Markup.inlineKeyboard(rows)
  }
  
  // 🔥 群聊时：根据设置决定是否显示"使用说明"按钮，"查看完整订单"始终显示
  try {
    const setting = await prisma.setting.findUnique({
      where: { chatId },
      select: { hideHelpButton: true }
    })
    
    if (!setting?.hideHelpButton) {
      rows.push([Markup.button.callback('使用说明', 'help')])
    }
  } catch (e) {
    // 如果查询失败，默认显示"使用说明"
    rows.push([Markup.button.callback('使用说明', 'help')])
  }
  
  // 🔥 "查看完整订单"按钮始终显示（不受 hideHelpButton 影响）
  if (isPublicUrl(BACKEND_URL)) {
    try {
      const u = new URL(BACKEND_URL)
      u.searchParams.set('chatId', chatId)
      rows.push([Markup.button.url('查看完整订单', u.toString())])
    } catch {
      rows.push([Markup.button.url('查看完整订单', BACKEND_URL)])
    }
  } else if (BACKEND_URL) {
    rows.push([Markup.button.callback('查看完整订单', 'open_dashboard')])
  }
  return Markup.inlineKeyboard(rows)
}

async function formatSummary(ctx, chat, options = {}) {
  const chatId = String(ctx?.chat?.id || '')
  
  // 🔥 优化：合并数据库查询，减少查询次数
  let previousNotDispatched = 0
  let previousNotDispatchedUSDT = 0
  let accountingMode = 'DAILY_RESET'
  
  // 🔥 从数据库同步当天的记录到内存（解决重启后数据丢失问题）
  // 🔥 优化：只在内存记录为空或明显不一致时才同步，避免频繁查询
  const lastSyncTime = chat._billLastSync || 0
  const now = Date.now()
  const needsSync = !chat._billLastSync || 
                    (chat.current.incomes.length === 0 && chat.current.dispatches.length === 0) ||
                    (now - lastSyncTime > 30 * 60 * 1000) // 30分钟同步一次
  
  try {
    // 🔥 并行获取设置和账单数据（如果需要同步）
    const [settings, billData] = await Promise.all([
      prisma.setting.findUnique({ 
        where: { chatId },
        select: {
          accountingMode: true,
          feePercent: true,
          fixedRate: true,
          realtimeRate: true
        }
      }),
      needsSync ? (async () => {
        try {
          const cutoffHour = await getDailyCutoffHour(chatId)
          const gte = startOfDay(new Date(), cutoffHour)
          const lt = endOfDay(new Date(), cutoffHour)
          return await prisma.bill.findFirst({ 
            where: { chatId, status: 'OPEN', openedAt: { gte, lt } },
            include: { 
              items: {
                select: {
                  type: true,
                  amount: true,
                  rate: true,
                  usdt: true,
                  replier: true,
                  operator: true,
                  createdAt: true
                }
              }
            },
            orderBy: { openedAt: 'asc' }
          })
        } catch (e) {
          if (process.env.DEBUG_BOT === 'true') {
            console.error('查询账单失败', e)
          }
          return null
        }
      })() : Promise.resolve(null)
    ])
    
    accountingMode = settings?.accountingMode || 'DAILY_RESET'
    
    // 处理历史未下发金额
    if (accountingMode === 'CARRY_OVER') {
      const historical = await getHistoricalNotDispatched(chatId, settings)
      previousNotDispatched = historical.notDispatched
      previousNotDispatchedUSDT = historical.notDispatchedUSDT
      // 🔥 调试日志：仅在 DEBUG_BOT=true 时输出
      if (process.env.DEBUG_BOT === 'true') {
        console.log('[formatSummary][累计模式] 历史未下发', { chatId, previousNotDispatched, previousNotDispatchedUSDT })
      }
    }
    
    // 同步账单数据到内存
    if (needsSync && billData?.items) {
      // 同步收入记录
      const dbIncomes = billData.items.filter(i => i.type === 'INCOME').map(i => ({
        amount: Number(i.amount),
        rate: i.rate ? Number(i.rate) : undefined,
        createdAt: new Date(i.createdAt),
        replier: i.replier || '',
        operator: i.operator || '',
      }))
      
      // 同步下发记录
      const dbDispatches = billData.items.filter(i => i.type === 'DISPATCH').map(i => ({
        amount: Number(i.amount),
        usdt: Number(i.usdt),
        createdAt: new Date(i.createdAt),
        replier: i.replier || '',
        operator: i.operator || '',
      }))
      
      // 更新内存状态（如果数据库有更多记录，则使用数据库的）
      if (dbIncomes.length >= chat.current.incomes.length) {
        chat.current.incomes = dbIncomes
      }
      if (dbDispatches.length >= chat.current.dispatches.length) {
        chat.current.dispatches = dbDispatches
      }
      chat._billLastSync = now
    } else if (needsSync) {
      // 数据库中没有账单，但标记已同步
      chat._billLastSync = now
    }
  } catch (e) {
    console.error('获取设置或同步数据失败', e)
  }

  const s = summarize(chat, { previousNotDispatched, previousNotDispatchedUSDT })
  const rateVal = s.effectiveRate || 0

  const incCount = chat.current.incomes.length
  const disCount = chat.current.dispatches.length

  // apply display mode
  let showIncomes = chat.current.incomes
  let showDispatches = chat.current.dispatches
  if (chat.displayMode === 1) {
    showIncomes = showIncomes.slice(-3)
    showDispatches = showDispatches.slice(-3)
  } else if (chat.displayMode === 2) {
    showIncomes = showIncomes.slice(-5)
    showDispatches = showDispatches.slice(-5)
  } else if (chat.displayMode === 3) {
    showIncomes = []
    showDispatches = []
  } else if (chat.displayMode === 4) {
    showIncomes = showIncomes.slice(-10)
    showDispatches = showDispatches.slice(-10)
  } else if (chat.displayMode === 5) {
    showIncomes = showIncomes.slice(-20)
    showDispatches = showDispatches.slice(-20)
  } else if (chat.displayMode === 6) {
    // 显示全部
  }

  const incPart = incCount > 0 && showIncomes.length > 0
    ? showIncomes.map((i) => {
        const t = i.createdAt.toTimeString().slice(0, 8)
        const rate = i.rate ?? rateVal
        const usdt = rate ? Number((Math.abs(i.amount) / rate).toFixed(1)) : 0
        const amount = Math.abs(i.amount)
        const who = (i.operator || i.replier || '')
        
        // 构建格式：时间 金额 / 汇率=USDTU 用户名
        // 金额和用户名都使用蓝色链接
        let line = `${t} [${formatMoney(amount)}](tg://user?id=0)`
        if (rate) {
          line += ` / ${rate}=${usdt}U`
        }
        if (who) {
          // 尝试从内存映射中获取用户ID（尝试带@和不带@两种格式）
          const whoWithAt = who.startsWith('@') ? who : `@${who}`
          const userId = chat.userIdByUsername.get(whoWithAt) || chat.userIdByUsername.get(who)
          if (userId) {
            // 使用真实用户ID创建链接
            line += ` [${who}](tg://user?id=${userId})`
          } else {
            // 如果找不到用户ID，使用粗体
            line += ` *${who}*`
          }
        }
        return line
      }).join('\n')
    : (incCount > 0 && chat.displayMode === 3 ? '（详情省略，显示模式3）' : ' 暂无入款')

  const disPart = disCount > 0 && showDispatches.length > 0
    ? showDispatches.map((d) => {
        const t = d.createdAt.toTimeString().slice(0, 8)
        const amount = Math.abs(d.amount)
        const usdt = Math.abs(d.usdt)
        // 下发金额使用蓝色链接
        return `${t} [${formatMoney(amount)}](tg://user?id=0) (${formatMoney(usdt)}U)`
      }).join('\n')
    : (disCount > 0 && chat.displayMode === 3 ? '（详情省略，显示模式3）' : ' 暂无下发')

  const header = chat.headerText ? `${chat.headerText}\n` : ''
  const modeTag = accountingMode === 'CARRY_OVER' ? '【累计模式】' : ''

  // 在累计模式下显示详细的历史和今日数据分解
  let historicalInfo = ''
  if (accountingMode === 'CARRY_OVER' && (previousNotDispatched !== 0 || previousNotDispatchedUSDT !== 0)) {
    historicalInfo = `\n账单拆解：\n今日入款：${formatMoney(s.totalIncome)}\n历史未下发：${formatMoney(previousNotDispatched)} | ${formatMoney(previousNotDispatchedUSDT)}U`
  }

  return [
    header + `${modeTag}${options.title || '账单状态'}`,
    `已入款（${incCount}笔）：`,
    incPart,
    `\n已下发（${disCount}笔）：`,
    disPart,
    `\n总入款金额：${formatMoney(s.totalIncome)}`,
    `费率：${s.feePercent}%`,
    `实时汇率：${rateVal || '未设置'}`,
    historicalInfo,
    ...(chat.rmbMode
      ? [
          `应下发：${formatMoney(s.shouldDispatch)}`,
          `已下发：${formatMoney(s.dispatched)}`,
          `未下发：${formatMoney(s.notDispatched)}`,
        ]
      : [
          `应下发：${formatMoney(s.shouldDispatch)} | ${formatMoney(s.shouldDispatchUSDT)}U`,
          `已下发：${formatMoney(s.dispatched)} | ${formatMoney(s.dispatchedUSDT)}U`,
          `未下发：${formatMoney(s.notDispatched)} | ${formatMoney(s.notDispatchedUSDT)}U`,
        ]
    ),
  ].join('\n')
}

// Helpers to extract @username from text
function extractMention(text) {
  const m = text?.match(/@([A-Za-z0-9_]{5,})/) // Telegram username rules (len>=5)
  return m ? `@${m[1]}` : null
}

// Core commands
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

// 开始记账（群聊快捷命令）
bot.hears(/^开始记账$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const userId = ctx.from?.id
  const username = ctx.from?.username ? `@${ctx.from.username}` : '无'
  
  await ctx.reply(
    `开始记账，使用 +金额 / -金额 记录入款，使用 "下发金额" 记录下发。输入 "显示账单" 查看汇总。\n\n` +
    `👤 您的ID：\`${userId}\` 用户名：${username}`,
    { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' }
  )
})

// 获取我的ID
bot.command('myid', async (ctx) => {
  const userId = ctx.from?.id
  const username = ctx.from?.username ? `@${ctx.from.username}` : '无'
  
  await ctx.reply(
    `👤 您的用户信息：\n` +
    `🆔 ID：\`${userId}\`\n` +
    `👤 用户名：${username}\n\n` +
    `💡 私聊机器人发送 /start 查看详细信息`,
    { parse_mode: 'Markdown' }
  )
})

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
      
      // 🔥 记录邀请信息（仅新加入时）
      // 使用 upsert 确保即使重复也能记录（可能因为网络问题导致重复）
      try {
        // 🔥 使用 findFirst 查找最近的记录（同一群组同一邀请人）
        const existing = await prisma.inviteRecord.findFirst({
          where: {
            chatId,
            inviterId
          },
          orderBy: { createdAt: 'desc' }
        })
        
        if (!existing) {
          // 不存在记录，创建新记录
          const newRecord = await prisma.inviteRecord.create({
            data: {
              chatId,
              chatTitle: title,
              inviterId,
              inviterUsername,
              botId,
              autoAllowed
            }
          })
          console.log('[invite-record] ✅ 创建成功', { 
            id: newRecord.id,
            chatId, 
            inviterId, 
            inviterUsername, 
            autoAllowed,
            title
          })
        } else {
          // 已存在记录，更新信息（可能用户名或状态有变化）
          await prisma.inviteRecord.update({
            where: { id: existing.id },
            data: {
              chatTitle: title,
              inviterUsername,
              botId,
              autoAllowed
            }
          })
          console.log('[invite-record] ✅ 更新成功', { 
            id: existing.id,
            chatId, 
            inviterId, 
            inviterUsername, 
            autoAllowed,
            title
          })
        }
      } catch (e) {
        // 🔥 记录详细错误信息，帮助排查问题
        console.error('[invite-record] ❌ 创建/更新失败', { 
          chatId, 
          inviterId,
          inviterUsername,
          title,
          botId,
          autoAllowed,
          error: e.message,
          code: e.code,
          stack: e.stack
        })
      }
      
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

// 🔥 简化权限系统：只对基础记账相关命令进行权限检查
// 其他功能（z0、汇率、显示模式、下课禁言等）无需权限检查，直接可用
function isAccountingCommand(text) {
  if (!text) return false
  const t = text.trim()
  // 只检查基础记账相关命令
  if (/^开始记账$/i.test(t)) return true
  if (/^[+\-]\s*[\d+\-*/.()]/i.test(t)) return true
  if (/^(下发)\b/.test(t)) return true
  if (/^(显示账单|\+0)$/i.test(t)) return true
  if (/^显示历史账单$/i.test(t)) return true
  if (/^(保存账单|删除账单|删除全部账单|清除全部账单)$/i.test(t)) return true
  if (/^(我的账单|\/我)$/i.test(t)) return true
  return false
}

bot.use(async (ctx, next) => {
  try {
    const text = ctx.message?.text
    // 🔥 只对基础记账命令进行权限检查
    if (isAccountingCommand(text)) {
      const ok = await isFeatureEnabled(ctx, 'accounting_basic')
      if (!ok) {
        // 检查是否启用了基础记账功能
        try {
          const chatId = await ensureDbChat(ctx)
          const setting = await prisma.setting.findUnique({ 
            where: { chatId },
            select: { featureWarningMode: true }
          })
          
          const warningMode = setting?.featureWarningMode || 'always'
          let shouldWarn = false
          
          if (warningMode === 'always') {
            shouldWarn = true
          } else if (warningMode === 'once') {
            const existingLog = await prisma.featureWarningLog.findUnique({
              where: { chatId_feature: { chatId, feature: 'accounting_basic' } }
            })
            if (!existingLog) {
              shouldWarn = true
              await prisma.featureWarningLog.upsert({
                where: { chatId_feature: { chatId, feature: 'accounting_basic' } },
                create: { chatId, feature: 'accounting_basic' },
                update: { warnedAt: new Date() }
              }).catch(() => {})
            }
          } else if (warningMode === 'daily') {
            const existingLog = await prisma.featureWarningLog.findUnique({
              where: { chatId_feature: { chatId, feature: 'accounting_basic' } }
            })
            const now = new Date()
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            
            if (!existingLog || existingLog.warnedAt < today) {
              shouldWarn = true
              await prisma.featureWarningLog.upsert({
                where: { chatId_feature: { chatId, feature: 'accounting_basic' } },
                create: { chatId, feature: 'accounting_basic' },
                update: { warnedAt: now }
              }).catch(() => {})
            }
          }
          
          if (shouldWarn) {
            await ctx.reply('未开通基础记账功能')
          }
        } catch (e) {
          console.error('[权限检查][错误]', e)
        }
        return
      }
    }
    return next()
  } catch {
    return next()
  }
})

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
  const chat = ensureChat(ctx)
  if (!chat) return
  
  // 权限检查：默认只有管理员可以记账，其他人需要添加到操作人列表
  if (!(await hasOperatorPermission(ctx))) {
    return ctx.reply('⚠️ 您没有记账权限。只有管理员或已添加的操作人可以记账。\n请联系管理员使用"设置操作人 @你的用户名"添加权限。')
  }
  
  const chatId = await ensureDbChat(ctx)
  const text = ctx.message.text.trim()
  
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
  
  // 发送完整账单（不发送确认消息）
  const summary = await formatSummary(ctx, chat, { title: '当前账单' })
  await ctx.reply(summary, { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' })
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
  const summary = await formatSummary(ctx, chat, { title: '下发已记录' })
  await ctx.reply(summary, { ...(await buildInlineKb(ctx)), parse_mode: 'Markdown' })
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

// 设置汇率（可带数值，也可不带数值查看当前）
bot.hears(/^设置汇率(?:(?:\s+)(\d+(?:\.\d+)?))?$/i, async (ctx) => {
  const chat = ensureChat(ctx)
  if (!chat) return
  const chatId = await ensureDbChat(ctx)
  const m = ctx.message.text.match(/^设置汇率(?:(?:\s+)(\d+(?:\.\d+)?))?$/i)
  const val = m && m[1] ? Number(m[1]) : null
  if (val == null) {
    const settings = await prisma.setting.findUnique({ where: { chatId } })
    const current = settings?.fixedRate ?? settings?.realtimeRate ?? null
    return ctx.reply(`当前汇率：${current ?? '未设置'}\n用法：设置汇率 7.5`)
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
    
    let priceText = '━━━ 💰 OKX实时U价 TOP 10 ━━━\n\n'
    
    topSellers.forEach((seller, index) => {
      const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][index] || '•'
      priceText += `${emoji}    ${seller.price.toFixed(3)}    ${seller.nickName}\n`
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
    
    let priceText = `━━━ 💰 OKX实时U价 ${methodName} TOP 10 ━━━\n\n`
    
    topSellers.forEach((seller, index) => {
      const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][index] || '•'
      priceText += `${emoji}    ${seller.price.toFixed(3)}    ${seller.nickName}\n`
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
  featureCache.delete(chatId)
  
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
  featureCache.delete(chatId)
  
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

// 使用说明（内联菜单）
bot.action('help', async (ctx) => {
  try { 
    await ctx.answerCbQuery() 
  } catch (e) {
    console.error('[help-action][answerCbQuery-error]', e)
  }
  
  // 🔥 私聊时显示简化的使用说明
  if (ctx.chat?.type === 'private') {
    const helpText = [
      '━━━ 📖 机器人使用说明 ━━━',
      '',
      '本机器人仅支持在群组中使用记账功能。',
      '',
      '【📋 使用步骤】',
      '1. 将机器人添加到群组',
      '2. 联系管理员将您的ID添加到白名单',
      '3. 在群组中使用记账功能',
      '',
      '【💰 基础记账】',
      '• +720 - 记录人民币收入',
      '• +100u - 记录USDT收入',
      '• 下发10 - 下发10人民币',
      '• 下发10u - 下发10USDT',
      '• 显示账单 - 查看当前账单',
      '',
      '💡 更多功能请查看完整使用说明：',
      'https://t.me/your_bot_username'
    ].join('\n')
    
    return ctx.reply(helpText, { parse_mode: 'Markdown' })
  }
  
  const help = [
    '━━━ 📖 机器人使用说明 ━━━',
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
    '• 显示操作人 - 查看列表',
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
    '💡 适用于机器人只发送通告的群，与其他机器人互不打扰',
    '',
    '【⚙️ 群组独立设置】',
    '• 每个群组独立的功能开关',
    '• 每个群组独立的记账模式设置',
    '• 每个群组独立的操作人员名单',
    '• 每个群组独立的汇率和费率设置',
    '💡 在后台管理面板可设置每个群组的功能',
    '💡 不同群组的设置互不影响',
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

// 本地开发：发送文本链接
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

// 🔥 私聊时"开始记账"按钮回调
bot.action('start_accounting', async (ctx) => {
  try { await ctx.answerCbQuery() } catch {}
  
  // 只在私聊中处理
  if (ctx.chat?.type !== 'private') {
    return ctx.reply('此功能仅在私聊中使用')
  }
  
  const userId = String(ctx.from?.id || '')
  const username = ctx.from?.username ? `@${ctx.from.username}` : '无'
  const firstName = ctx.from?.first_name || ''
  const lastName = ctx.from?.last_name || ''
  const fullName = `${firstName} ${lastName}`.trim()
  
  // 🔥 检查是否在白名单
  const whitelistedUser = await prisma.whitelistedUser.findUnique({
    where: { userId }
  })
  
  if (whitelistedUser) {
    // 🔥 白名单用户：提供邀请机器人进群的链接
    // 获取机器人的用户名（从 BOT_TOKEN 或从数据库）
    let botUsername = process.env.BOT_USERNAME || ''
    if (!botUsername) {
      try {
        const bot = await prisma.bot.findFirst({
          where: { enabled: true },
          select: { token: true }
        })
        if (bot?.token) {
          // 尝试从 Telegram API 获取机器人信息
          const resp = await fetch(`https://api.telegram.org/bot${bot.token}/getMe`)
          const data = await resp.json()
          if (data.ok && data.result?.username) {
            botUsername = data.result.username
          }
        }
      } catch (e) {
        console.error('获取机器人用户名失败', e)
      }
    }
    
    if (botUsername) {
      const inviteLink = `https://t.me/${botUsername.replace('@', '')}`
      await ctx.reply(
        `✅ 您已在白名单中！\n\n` +
        `📋 邀请机器人进群：\n` +
        `1. 点击下方链接添加机器人\n` +
        `2. 选择要添加的群组\n` +
        `3. 机器人将自动启用所有功能\n\n` +
        `🔗 ${inviteLink}\n\n` +
        `💡 提示：您可以将机器人添加到群组后，所有功能将自动启用。`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                Markup.button.url('➕ 添加机器人到群组', inviteLink)
              ]
            ]
          }
        }
      )
    } else {
      await ctx.reply(
        `✅ 您已在白名单中！\n\n` +
        `💡 请将机器人添加到群组，所有功能将自动启用。\n\n` +
        `添加方式：\n` +
        `1. 在群组中点击"添加成员"\n` +
        `2. 搜索机器人的用户名\n` +
        `3. 添加机器人到群组`
      )
    }
  } else {
    // 🔥 非白名单用户：显示提示信息
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
      `3. 邀请机器人进群后将自动启用所有功能`,
      { parse_mode: 'Markdown' }
    )
  }
})

// 🔥 每小时自动更新实时汇率的定时任务
async function updateAllRealtimeRates() {
  try {
    // 🔥 优化：提前获取 botId，避免在循环中重复查询
    const botId = await ensureCurrentBotId()
    
    // 获取所有启用实时汇率的设置
    const settings = await prisma.setting.findMany({
      where: { realtimeRate: { not: null } },
      select: { chatId: true }
    })
    
    if (settings.length === 0) {
      return // 🔥 移除不必要的日志输出
    }
    
    // 获取最新实时汇率
    const rate = await fetchRealtimeRateUSDTtoCNY()
    if (!rate) {
      return // 🔥 移除不必要的日志输出
    }
    
    // 🔥 批量更新所有群组的汇率（使用 updateMany 优化）
    const chatIds = settings.map(s => s.chatId)
    await prisma.setting.updateMany({
      where: { 
        chatId: { in: chatIds },
        realtimeRate: { not: null }
      },
      data: { realtimeRate: rate }
    })
    
    // 🔥 批量更新内存中的汇率
    for (const setting of settings) {
      const chat = getChat(botId, setting.chatId)
      if (chat) {
        chat.realtimeRate = rate
      }
    }
    
    if (process.env.DEBUG_BOT === 'true') {
      console.log(`[定时任务] 汇率更新完成，新汇率: ${rate}，更新了 ${settings.length} 个群组`)
    }
  } catch (e) {
    console.error('[定时任务] 更新汇率失败:', e)
  }
}

// 安全停止
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

bot.launch().then(async () => {
  console.log('Telegram 机器人已启动')
  
  // 启动后立即执行一次汇率更新
  await updateAllRealtimeRates()
  
  // 🔥 优化：定时任务 - 每小时更新汇率
  setInterval(updateAllRealtimeRates, 3600000)
  console.log('[定时任务] 实时汇率自动更新已启动，每小时更新一次')
  
  // 🔥 新增：内存优化定时任务
  // 1. 每小时清理不活跃的聊天
  setInterval(() => {
    try {
      cleanupInactiveChats()
    } catch (e) {
      console.error('[定时任务] 清理不活跃聊天失败:', e)
    }
  }, 3600000) // 1小时
  
  // 2. 每6小时清理过期的功能开关缓存
  setInterval(() => {
    try {
      const now = Date.now()
      let cleaned = 0
      for (const [chatId, cache] of featureCache.cache.entries()) {
        if (cache.expires && cache.expires < now) {
          featureCache.delete(chatId)
          cleaned++
        }
      }
      if (cleaned > 0) {
        console.log(`[内存清理] 清理了 ${cleaned} 个过期的功能开关缓存`)
      }
    } catch (e) {
      console.error('[定时任务] 清理功能开关缓存失败:', e)
    }
  }, 6 * 3600000) // 6小时
  
  // 3. 每12小时打印内存使用情况（仅在DEBUG模式下）
  if (process.env.DEBUG_BOT === 'true') {
    const logMemoryUsage = () => {
      const used = process.memoryUsage()
      console.log('[内存监控]', {
        rss: `${Math.round(used.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(used.external / 1024 / 1024)}MB`,
        featureCacheSize: featureCache.size
      })
    }
    logMemoryUsage() // 启动时打印一次
    setInterval(logMemoryUsage, 12 * 3600000) // 12小时
  }
  
  console.log('[内存优化] 定期清理任务已启动')
  
  const commands = [
    { command: 'help', description: '使用说明（命令列表）' },
    { command: 'show', description: '显示账单' },
    { command: 'history', description: '显示历史账单（最近5条）' },
    { command: 'setfee', description: '设置费率，如 /setfee 5 或 /setfee 0.05' },
    { command: 'setrate', description: '设置固定汇率，如 /setrate 7.5' },
    { command: 'realtime', description: '启用实时汇率（示例值）' },
    { command: 'activate', description: '激活机器人（本群）' },
    { command: 'allowgroup', description: '管理员：将本群加入白名单' },
  ]
  try {
    await bot.telegram.setMyCommands(commands)
    await bot.telegram.setMyCommands(commands, { scope: { type: 'all_private_chats' } })
    await bot.telegram.setMyCommands(commands, { scope: { type: 'all_group_chats' } })
    
    // 🔥 更新机器人描述
    try {
      await bot.telegram.setMyDescription(
        '智能记账机器人 - 支持USDT/RMB记账、实时汇率、地址验证、多群组独立设置。\n\n' +
        '主要功能：\n' +
        '• 基础记账：+金额、下发金额、显示账单\n' +
        '• 数学计算：支持+100-50、+100*2等表达式\n' +
        '• 实时汇率：自动获取USDT到CNY汇率\n' +
        '• 地址验证：检测钱包地址变更并提醒\n' +
        '• 功能开关：开启所有功能/关闭所有功能\n' +
        '• 多群组独立配置：每个群组独立设置\n\n' +
        '发送 /help 查看完整使用说明。'
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
