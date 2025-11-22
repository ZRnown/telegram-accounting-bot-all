import { prisma } from '../../lib/db.js'
import { ensureCurrentBotId } from '../bot-identity.js'
import logger from '../logger.js'

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
            try { map = JSON.parse(String(row.value) || '{}') } catch { }
        }
        CUSTOM_CMDS_CACHE.map = map
        CUSTOM_CMDS_CACHE.ts = now
        return map
    } catch {
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
            logger.error('[customcmd][error]', e?.message || e)
            return next()
        }
    })
}
