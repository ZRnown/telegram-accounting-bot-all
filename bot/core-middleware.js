import { prisma } from '../lib/db.js'
import { ensureChat, ensureCurrentBotId } from './bot-identity.js'
import { ensureDbChat } from './database.js'
import logger from './logger.js'

// 简易告警节流：每个群 60s 内只提醒一次
const LAST_WARN_AT = new Map() // chatId -> ts
function shouldWarnNow(chatId) {
    const now = Date.now()
    const prev = LAST_WARN_AT.get(chatId) || 0
    if (now - prev < 60_000) return false
    LAST_WARN_AT.set(chatId, now)
    return true
}

export function registerCoreMiddleware(bot) {
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
        } catch { }

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

        const botId = await ensureCurrentBotId(bot)
        const chatId = await ensureDbChat(ctx, chatState)
        const dbChat = await prisma.chat.findUnique({ where: { id: chatId }, select: { botId: true, allowed: true, bot: { select: { id: true, token: true } } } })

        const currentToken = (process.env.BOT_TOKEN || '').trim()
        const boundToken = (dbChat?.bot?.token || '').trim()

        // 🔥 调试日志
        logger.debug('[bind-check]', {
            chatId,
            botId,
            dbBotId: dbChat?.botId || null,
            allowed: !!dbChat?.allowed,
            currentToken4: currentToken ? `${currentToken.slice(0, 4)}...` : '',
            boundToken4: boundToken ? `${boundToken.slice(0, 4)}...` : '',
        })

        const notBound = !dbChat?.botId || dbChat?.botId !== botId

        // 仅对文本消息给出提醒，且加频率限制，避免 429
        if (notBound) {
            if (!text) return // 非文本（如转发/图片等）不提醒
            if (!shouldWarnNow(chatId)) return
            const msg = '本群尚未在后台绑定当前机器人，请联系管理员到后台绑定后再使用。'
            try { await ctx.reply(msg) } catch { }
            return
        }
        if (!dbChat?.allowed) {
            if (!text) return
            if (!shouldWarnNow(chatId)) return
            const msg = '本群尚未被后台允许使用，请联系管理员在后台将本群设置为允许后再使用。'
            try { await ctx.reply(msg) } catch { }
            return
        }
        return next()
    })
}
