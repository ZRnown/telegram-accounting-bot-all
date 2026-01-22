import { prisma } from '../../lib/db.js'
import { ensureCurrentBotId } from '../bot-identity.js'
import { hasWhitelistOnlyPermission } from '../helpers.js'
import logger from '../logger.js'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'

/**
 * 将相对URL转换为绝对URL
 */
function resolveImageUrl(url) {
    if (!url) return url

    // 如果已经是绝对URL，直接返回
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url
    }

    // 如果是相对路径，拼接后端URL
    if (url.startsWith('/')) {
        if (BACKEND_URL) {
            try {
                const baseUrl = new URL(BACKEND_URL)
                return `${baseUrl.protocol}//${baseUrl.host}${url}`
            } catch (e) {
                logger.warn('[resolveImageUrl] Invalid BACKEND_URL:', BACKEND_URL)
                return url
            }
        }
    }

    return url
}

// 验证URL是否有效
function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false

    // 清理URL（移除可能的空白字符）
    const cleanUrl = url.trim()
    if (!cleanUrl) return false

    try {
        const parsed = new URL(cleanUrl)
        // 检查协议和主机名
        if (!parsed.protocol || !parsed.hostname) return false
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
        if (!parsed.hostname || parsed.hostname.length === 0) return false

        // 检查是否为私有/本地地址（Telegram API不允许）
        const hostname = parsed.hostname.toLowerCase()
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return false
        if (hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.')) return false

        return true
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
    // 🔥 修复：减少缓存时间到1分钟，让修改更快生效
    const now = Date.now()
    if (CUSTOM_CMDS_CACHE.map && now - CUSTOM_CMDS_CACHE.ts < 1 * 60 * 1000) return CUSTOM_CMDS_CACHE.map

    try {
        let map = {}

        // 1. 加载后台管理设置的自定义指令（按机器人维度）
        const adminCmdsKey = `customcmds:bot:${botId}`
        const adminCmdsRow = await prisma.globalConfig.findUnique({
            where: { key: adminCmdsKey },
                select: { value: true }
            }).catch(() => null)

        if (adminCmdsRow?.value) {
            try {
                const adminCmds = JSON.parse(adminCmdsRow.value) || {}
                for (const [trigger, payload] of Object.entries(adminCmds)) {
                    if (payload && typeof payload === 'object') {
                        const cmd = payload
                    // 转换为统一格式，确保URL有效
                        const imageUrl = cmd.imageUrl?.trim()
                        const resolvedImageUrl = imageUrl ? resolveImageUrl(imageUrl) : null
                        const validImageUrl = resolvedImageUrl && isValidImageUrl(resolvedImageUrl) ? resolvedImageUrl : null

                    map[trigger.toLowerCase()] = {
                            text: cmd.text || '',
                        imageUrl: validImageUrl
                        }
                    }
                }
            } catch (e) {
                logger.warn('[loadCustomCommandsForBot] Failed to parse admin commands:', e)
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
            let text = (ctx.message?.text || '').trim();
            if (!text) return next();

            const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
            if (!isWhitelisted) return next()

            // 🔥 修复：支持 / 开头的指令触发，例如输入 "/小八" 也能触发 "小八"
            const triggerText = text.startsWith('/') ? text.substring(1) : text;

            const botId = await ensureCurrentBotId(bot);
            const map = await loadCustomCommandsForBot(botId);

            if (!map || typeof map !== 'object') return next();

            // 匹配指令（忽略大小写）
            const key = triggerText.toLowerCase();
            const item = map[key];

            if (!item) return next();

            const chatId = String(ctx.chat?.id || '');
            logger.info('[customcmd][hit]', { chatId, name: key });

            // 发送逻辑
            if (item.imageUrl && isValidImageUrl(item.imageUrl) && item.text) {
                await ctx.replyWithPhoto(item.imageUrl, { caption: item.text });
            } else if (item.imageUrl && isValidImageUrl(item.imageUrl)) {
                await ctx.replyWithPhoto(item.imageUrl);
            } else if (item.text) {
                await ctx.reply(item.text);
            }

            return; // 命中指令后停止向下传递
        } catch (e) {
            logger.error('[customcmd][error]', e?.message || e);
            return next();
        }
    });
}

/**
 * 清理自定义指令缓存
 */
export function clearCustomCommandCache() {
  CUSTOM_CMDS_CACHE.map = null
  CUSTOM_CMDS_CACHE.ts = 0
}
