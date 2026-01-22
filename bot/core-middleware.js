import { prisma } from '../lib/db.js'
import { ensureChat, ensureCurrentBotId } from './bot-identity.js'
import { ensureDbChat } from './database.js'
import { hasWhitelistOnlyPermission } from './helpers.js'
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

const NON_WHITELIST_ALLOWED_TEXT = /^(?:\/start|\/help|使用说明|开始记账|开始)$/i
const NON_WHITELIST_ALLOWED_CALLBACK = new Set(['help'])
const COMMAND_PREFIXES = [
    '+',
    '-',
    '下发',
    '备注',
    '显示',
    '查看',
    '保存',
    '删除',
    '设置',
    '隐藏',
    '开启',
    '关闭',
    '打开',
    '刷新',
    '撤销',
    '开始',
    '停止',
    '上课',
    '下课',
    '解除禁言',
    '开口',
    '查询',
    '单显',
    '双显',
    '人民币',
    '我的',
    '指定',
    '账单',
    '添加',
    '自定义指令',
    '查',
    'z',
    'z0',
    'lz',
    'lw',
    'lk',
    '全员广播',
    '分组',
    '群列表',
    '机器人退群',
    '管理员',
    '权限人'
]

function isLikelyBotCommand(text) {
    const t = String(text || '').trim()
    if (!t) return false
    if (t.startsWith('/') || t.startsWith('+') || t.startsWith('-')) return true
    return COMMAND_PREFIXES.some(prefix => t.startsWith(prefix))
}

export function registerCoreMiddleware(bot) {
    bot.use(async (ctx, next) => {
        // 🔥 回调查询：允许使用说明，其余需要白名单
        if (ctx.update.callback_query) {
            const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
            if (!isWhitelisted) {
                const data = String(ctx.update.callback_query.data || '')
                if (!NON_WHITELIST_ALLOWED_CALLBACK.has(data)) {
                    try { await ctx.answerCbQuery('⚠️ 仅白名单用户可用', { show_alert: true }) } catch { }
                    return
                }
            }
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

        const isCommandLike = text ? isLikelyBotCommand(text) : false
        const shouldCheckWhitelist = text && (ctx.chat.type === 'private' || isCommandLike)
        const isWhitelisted = shouldCheckWhitelist ? await hasWhitelistOnlyPermission(ctx) : true

        // 🔥 私聊：允许使用部分命令，但大部分功能需要通过内联菜单
        if (ctx.chat.type === 'private') {
            if (!isWhitelisted && !NON_WHITELIST_ALLOWED_TEXT.test(text)) {
                return
            }
        }

        if (text && !isWhitelisted && isCommandLike && !NON_WHITELIST_ALLOWED_TEXT.test(text)) {
            if (shouldWarnNow(String(ctx.chat?.id || ''))) {
                try { await ctx.reply('⚠️ 您不在白名单中，仅可使用：使用说明、开始记账') } catch { }
            }
            return
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
            try { await ctx.reply(msg) } catch { }
            return
        }
        return next()
    })
}
