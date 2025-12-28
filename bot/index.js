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

// 🔥 注册成员变动处理器（统一管理机器人进出群）
import { registerMemberHandlers } from './handlers/member-handler.js'
registerMemberHandlers(bot)

// 🔥 注册所有命令处理器（模块化）
registerAllHandlers(bot, ensureChat)

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

    // 更新数据库中所有使用实时汇率的群组
    try {
      await prisma.setting.updateMany({
        where: { fixedRate: null },
        data: { realtimeRate: okxRate }
      })
    } catch (error) {
      console.error('[定时任务] 汇率更新数据库写入失败:', error.message)

      // 如果是只读数据库错误，尝试逐个更新
      if (error.message.includes('readonly database') || error.message.includes('read-only')) {
        console.log('[定时任务] 检测到只读数据库，尝试修复权限...')

        // 获取需要更新的设置
        const settings = await prisma.setting.findMany({
          where: { fixedRate: null },
          select: { chatId: true }
        })

        // 逐个更新，避免updateMany的问题
        for (const setting of settings) {
          try {
            await prisma.setting.update({
              where: { chatId: setting.chatId },
              data: { realtimeRate: okxRate }
            })
          } catch (updateError) {
            console.error(`[定时任务] 更新群组 ${setting.chatId} 汇率失败:`, updateError.message)
          }
        }

        console.log(`[定时任务] 逐个更新完成，共处理 ${settings.length} 个群组`)
      } else {
        throw error // 重新抛出非只读错误
      }
    }

    if (process.env.DEBUG_BOT === 'true') {
        logger.debug(`[定时任务] 汇率更新: ${okxRate}`)
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

