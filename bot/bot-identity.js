import { prisma } from '../lib/db.js'
import { getChat } from './state.js'

let CURRENT_BOT_ID = null
let BOT_ID_INITIALIZING = false

/**
 * Resolve current Bot record by token to support multi-bot state separation
 * 🔥 优化：使用更可靠的缓存，避免重复查询
 */
export async function ensureCurrentBotId(bot) {
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
                // 🔥 如果超时，记录错误但不阻止启动
                if (e.message === 'TIMEOUT') {
                    console.error('⚠️ 链接Telegram API超时（30秒），请检查服务器网络连接')
                } else {
                    console.error('[ensureCurrentBotId] 获取机器人信息失败:', e.message)
                }
            }
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

/**
 * 🔥 简化：使用模块中的函数
 */
export function ensureChat(ctx) {
    const chatId = ctx.chat?.id
    if (chatId == null) return null
    if (!CURRENT_BOT_ID) return null
    return getChat(CURRENT_BOT_ID, chatId)
}
