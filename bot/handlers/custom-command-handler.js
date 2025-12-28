import { prisma } from '../../lib/db.js'
import { ensureCurrentBotId } from '../bot-identity.js'
import logger from '../logger.js'

// 验证URL是否有效
function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false
    try {
        const parsed = new URL(url)
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname
    } catch {
        return false
    }
}

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
        // 获取所有属于该机器人的群组
        const chats = await prisma.chat.findMany({
            where: { botId },
            select: { id: true }
        })

        let map = {}

        // 从每个群组加载自定义指令
        for (const chat of chats) {
            const chatId = chat.id
            const indexKey = `customcmd_index:${chatId}`
            const indexRow = await prisma.globalConfig.findUnique({
                where: { key: indexKey },
                select: { value: true }
            }).catch(() => null)

            if (!indexRow?.value) continue

            let index = []
            try {
                index = JSON.parse(indexRow.value) || []
            } catch { }

            // 为每个触发词加载指令内容
            for (const trigger of index) {
                const cmdKey = `customcmd:${chatId}:${trigger}`
                const cmdRow = await prisma.globalConfig.findUnique({
                    where: { key: cmdKey },
                    select: { value: true }
                }).catch(() => null)

                if (!cmdRow?.value) continue

                try {
                    const payload = JSON.parse(cmdRow.value)
                    // 转换为统一格式，确保URL有效
                    const imageUrl = payload.imageUrl?.trim()
                    const validImageUrl = imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) ? imageUrl : null

                    map[trigger.toLowerCase()] = {
                        text: payload.content,
                        imageUrl: validImageUrl
                    }
                } catch { }
            }
        }

        CUSTOM_CMDS_CACHE.map = map
        CUSTOM_CMDS_CACHE.ts = now
        return map
    } catch (e) {
        logger.error('[loadCustomCommandsForBot] Error:', e)
        return {}
    }
}

export function registerCustomCommandHandlers(bot) {
    bot.on('text', async (ctx, next) => {
        try {
            const text = (ctx.message?.text || '').trim()
            if (!text) return next()
            const botId = await ensureCurrentBotId(bot)
            const map = await loadCustomCommandsForBot(botId)
            if (!map || typeof map !== 'object') return next()
            const key = text.toLowerCase()
            const item = map[key]
            if (!item) return next()

            const chatId = String(ctx.chat?.id || '')
            // 简洁日志（命中）
            logger.info('[customcmd][hit]', { chatId, name: key })

            if (item.imageUrl && isValidImageUrl(item.imageUrl) && item.text) {
                await ctx.replyWithPhoto(item.imageUrl, { caption: item.text })
                return
            } else if (item.imageUrl && isValidImageUrl(item.imageUrl)) {
                await ctx.replyWithPhoto(item.imageUrl)
                return
            } else if (item.text) {
                await ctx.reply(item.text)
                return
            }
            return next()
        } catch (e) {
            logger.error('[customcmd][error]', e?.message || e)
            return next()
        }
    })
}
