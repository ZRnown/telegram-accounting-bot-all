import { prisma } from '../../lib/db.js'
import { ensureCurrentBotId } from '../bot-identity.js'
import { ensureDefaultFeatures } from '../constants.js'
import logger from '../logger.js'

// 获取后台配置的欢迎语
async function getWelcomeMessage(botId) {
    const bot = await prisma.bot.findUnique({
        where: { id: botId },
        select: { welcomeMessage: true }
    })
    return bot?.welcomeMessage
}

/**
 * 彻底清理群组数据
 */
async function cleanupGroupData(chatId) {
    try {
        logger.info('[cleanup] 开始清理群组数据', { chatId })
        // 使用事务或并行删除，确保清理干净，先删子表，最后删主表
        await Promise.all([
            prisma.billItem.deleteMany({ where: { bill: { chatId } } }),
            prisma.bill.deleteMany({ where: { chatId } }),
            prisma.operator.deleteMany({ where: { chatId } }),
            prisma.setting.deleteMany({ where: { chatId } }),
            prisma.chatFeatureFlag.deleteMany({ where: { chatId } }),
            prisma.addressVerification.deleteMany({ where: { chatId } }),
            prisma.featureWarningLog.deleteMany({ where: { chatId } }),
            prisma.income.deleteMany({ where: { chatId } }), // 兼容旧表
            prisma.dispatch.deleteMany({ where: { chatId } }), // 兼容旧表
            prisma.commission.deleteMany({ where: { chatId } }) // 兼容旧表
        ])

        // 最后删除 Chat 记录
        await prisma.chat.delete({ where: { id: chatId } })

        logger.info('[cleanup] 群组数据清理完成', { chatId })
        return true
    } catch (e) {
        // 忽略"记录不存在"的错误
        if (e.code !== 'P2025') {
            logger.error('[cleanup] 清理数据失败', { chatId, error: e.message })
        }
        return false
    }
}

export function registerMemberHandlers(bot) {
    // 处理普通成员加入/离开群组
    bot.on('chat_member', async (ctx) => {
        logger.debug('[chat_member][event-triggered]', {
            updateType: ctx.updateType,
            hasChat: !!ctx.chat,
            chatId: ctx.chat?.id
        })

        try {
            const upd = ctx.update?.chat_member
            if (!upd) {
                logger.debug('[chat_member][no-update-data]')
                return
            }

            const chat = ctx.chat
            if (!chat || !chat.id) {
                logger.debug('[chat_member][no-chat-data]')
                return
            }

            const newStatus = upd.new_chat_member?.status
            const oldStatus = upd.old_chat_member?.status
            const chatId = String(chat.id)
            const userId = String(upd.new_chat_member?.user?.id || '')
            const username = upd.new_chat_member?.user?.username
            const firstName = upd.new_chat_member?.user?.first_name || ''
            const lastName = upd.new_chat_member?.user?.last_name || ''

            // 只处理成员加入的情况
            if (newStatus === 'member' && (!oldStatus || oldStatus === 'left' || oldStatus === 'kicked')) {
                logger.info('[chat_member][user-joined]', {
                    chatId,
                    userId,
                    username,
                    name: `${firstName} ${lastName}`.trim(),
                    oldStatus,
                    newStatus
                })

                // 检查群组是否已授权使用机器人
                const chatSettings = await prisma.chat.findUnique({
                    where: { id: chatId },
                    select: {
                        allowed: true,
                        status: true,
                        invitedBy: true,
                        invitedByUsername: true
                    }
                })

                // 如果群组已被批准且允许使用机器人，则发送欢迎语
                if (chatSettings?.allowed && chatSettings?.status === 'APPROVED') {
                    logger.info('[chat_member][sending-welcome]', {
                        chatId,
                        userId,
                        allowed: chatSettings.allowed,
                        status: chatSettings.status
                    })
                    try {
                        // 获取群组级别的标语设置
                        const settings = await prisma.setting.findUnique({
                            where: { chatId },
                            select: {
                                welcomeMessage: true
                            }
                        })

                        logger.debug('[chat_member][settings-check]', {
                            chatId,
                            hasSettings: !!settings,
                            welcomeMessage: settings?.welcomeMessage?.substring(0, 50) + '...'
                        })

                        // 如果没有设置欢迎消息，则使用默认消息
                        if (!settings?.welcomeMessage) {
                            logger.info('[chat_member][using-default-welcome]', { chatId, userId })
                        }

                        let welcomeText = settings?.welcomeMessage || '欢迎加入群组！您现在可以使用机器人功能了。'

                        logger.debug('[chat_member][preparing-welcome]', {
                            chatId,
                            userId,
                            welcomeTextLength: welcomeText.length
                        })

                        // 延迟2秒发送，避免消息发送过快
                        setTimeout(async () => {
                            try {
                                const finalWelcomeText = welcomeText
                                    .replace('{name}', firstName || '新成员')
                                    .replace('{username}', username ? `@${username}` : '新成员')
                                    .replace('{chat}', chat.title || '群组')

                                await bot.telegram.sendMessage(chatId, finalWelcomeText, {
                                    parse_mode: 'Markdown',
                                    disable_web_page_preview: true,
                                    reply_to_message_id: ctx.message?.message_id
                                })

                                logger.info('[chat_member][welcome-sent]', {
                                    chatId,
                                    userId,
                                    username,
                                    name: `${firstName} ${lastName}`.trim()
                                })
                            } catch (e) {
                                logger.error('[chat_member][welcome-send-failed]', { chatId, userId, error: e.message })
                            }
                        }, 2000)
                    } catch (e) {
                        logger.error('[chat_member][welcome-check-failed]', { chatId, userId, error: e.message })
                    }
                }
            }
        } catch (e) {
            logger.error('[chat_member][error]', e)
        }
    })

    // 监听机器人自身进出群状态变更 (核心逻辑)
    bot.on('my_chat_member', async (ctx) => {
        try {
            const upd = ctx.update?.my_chat_member
            const chat = ctx.chat
            if (!upd || !chat) return

            const newStatus = upd.new_chat_member?.status
            const oldStatus = upd.old_chat_member?.status
            const chatId = String(chat.id)
            const title = chat.title || ''

            // 获取当前机器人ID
            const botId = await ensureCurrentBotId(bot)

            // 获取触发动作的人（邀请人/踢人者）
            // 优先使用 ctx.myChatMember.from，这是API提供的触发者
            const from = ctx.myChatMember?.from || ctx.from
            const actionUserId = String(from?.id || '')
            const actionUsername = from?.username ? `@${from.username}` : null
            const actionFullName = `${from?.first_name || ''} ${from?.last_name || ''}`.trim()

            logger.info('[my_chat_member]', {
                chatId,
                title,
                action: newStatus,
                inviter: actionUserId
            })

            // === 场景 A: 机器人被邀请入群 (或被提升为管理员) ===
            if (newStatus === 'member' || newStatus === 'administrator') {
                // 只有当之前不在群里 (left/kicked/null) 时才视为新加入
                const isNewJoin = !oldStatus || oldStatus === 'left' || oldStatus === 'kicked'

                if (!isNewJoin) {
                    // 仅更新标题和绑定关系
                    await prisma.chat.update({
                        where: { id: chatId },
                        data: { title, botId }
                    }).catch(() => {})
                    return
                }

                logger.info('[my_chat_member] 机器人新加入群组，开始权限检查', { chatId })

                // 1. 检查邀请人是否在白名单
                let autoAllowed = false

                if (actionUserId) {
                    const whitelistedUser = await prisma.whitelistedUser.findUnique({
                        where: { userId: actionUserId }
                    })

                    if (whitelistedUser) {
                        autoAllowed = true
                        logger.info('[my_chat_member] ✅ 邀请人是白名单用户，自动授权', { inviter: actionUserId })

                        // 顺便更新白名单用户的用户名
                        if (actionUsername && actionUsername !== whitelistedUser.username) {
                            await prisma.whitelistedUser.update({
                                where: { userId: actionUserId },
                                data: { username: actionUsername }
                            }).catch(() => {})
                        }
                    }
                }

                // 2. 更新或创建群组记录
                // 🔥 关键点：如果是白名单，直接 create 为 APPROVED，而不是 PENDING
                await prisma.chat.upsert({
                    where: { id: chatId },
                    create: {
                        id: chatId,
                        title,
                        botId,
                        status: autoAllowed ? 'APPROVED' : 'PENDING',
                        allowed: autoAllowed,
                        invitedBy: actionUserId || null,
                        invitedByUsername: actionUsername || null
                    },
                    update: {
                        title,
                        botId,
                        // 如果是自动授权，则更新状态；否则保持原样，不覆盖可能已有的设置
                        ...(autoAllowed ? { status: 'APPROVED', allowed: true } : {}),
                        // 总是更新邀请人信息
                        invitedBy: actionUserId || null,
                        invitedByUsername: actionUsername || null
                    }
                })

                // 3. 确保设置记录存在 (默认开启记账)
                await prisma.setting.upsert({
                    where: { chatId },
                    create: {
                    chatId,
                        accountingEnabled: true,
                        addressVerificationEnabled: false
                    },
                    update: {
                        accountingEnabled: true // 机器人进群默认开启记账
                    }
                })

                // 4. 处理后续动作
                if (autoAllowed) {
                    // A. 初始化功能开关
                    if (String(chatId).startsWith('-')) {
                        await ensureDefaultFeatures(chatId, prisma, true) // force=true 确保开启

                        // 双重保险：确保功能状态为 enabled
                        await prisma.chatFeatureFlag.updateMany({
                            where: { chatId },
                            data: { enabled: true }
                        }).catch(() => {})
                    }

                    // B. 发送欢迎语
                    const welcomeMsg = await getWelcomeMessage(botId)
                    // 获取自定义的白名单欢迎消息
                    const settings = await prisma.setting.findUnique({
                        where: { chatId },
                        select: { welcomeMessage: true }
                    })

                    const customWelcomeMsg = settings?.welcomeMessage?.trim()
                    const msgToSend = customWelcomeMsg || welcomeMsg || (
                        `✅ *机器人已激活*\n\n` +
                        `感谢白名单用户 ${actionUsername || actionFullName} 的邀请。\n` +
                        `本群已自动授权，功能已全部开启，您可以直接开始记账。\n\n` +
                        `发送 "使用说明" 查看指令。`
                    )

                    try {
                        await ctx.reply(msgToSend, { parse_mode: 'Markdown' })
                        logger.info('[my_chat_member] ✅ 白名单欢迎消息发送成功', { chatId, msgLength: msgToSend.length })
                    } catch (e) {
                        logger.warn('[my_chat_member] ⚠️ Markdown发送失败，尝试纯文本', { chatId, error: e.message })
                        try {
                            await ctx.reply(msgToSend)
                            logger.info('[my_chat_member] ✅ 白名单欢迎消息(纯文本)发送成功', { chatId, msgLength: msgToSend.length })
                        } catch (e2) {
                            logger.error('[my_chat_member] ❌ 白名单欢迎消息发送失败', { chatId, error: e2.message })
                        }
                    }

                } else {
                    // 非白名单用户邀请，发送自定义欢迎消息或默认提示
                    const settings = await prisma.setting.findUnique({
                        where: { chatId },
                        select: { nonWhitelistWelcomeMessage: true, showAuthPrompt: true }
                    })

                    const customMsg = settings?.nonWhitelistWelcomeMessage?.trim()
                    if (customMsg && settings?.showAuthPrompt !== false) {
                        // 使用自定义的非白名单欢迎消息
                        try {
                            await ctx.reply(customMsg, { parse_mode: 'Markdown' })
                            logger.info('[my_chat_member] ✅ 非白名单自定义欢迎消息发送成功', { chatId, msgLength: customMsg.length })
                        } catch (e) {
                            logger.warn('[my_chat_member] ⚠️ 非白名单自定义消息Markdown发送失败，尝试纯文本', { chatId, error: e.message })
                            try {
                                await ctx.reply(customMsg)
                                logger.info('[my_chat_member] ✅ 非白名单自定义欢迎消息(纯文本)发送成功', { chatId, msgLength: customMsg.length })
                            } catch (e2) {
                                logger.error('[my_chat_member] ❌ 非白名单自定义欢迎消息发送失败', { chatId, error: e2.message })
                            }
                        }
                    } else if (settings?.showAuthPrompt !== false) {
                        // 使用默认提示消息
                        const defaultMsg = `🤖 *机器人已入群*\n\n` +
                            `⚠️ 本群尚未授权。\n` +
                            `邀请人：${actionUsername || actionFullName} (ID: ${actionUserId})\n\n` +
                            `请联系管理员在后台通过审核，或由白名单用户邀请。`
                        try {
                            await ctx.reply(defaultMsg, { parse_mode: 'Markdown' })
                            logger.info('[my_chat_member] ✅ 非白名单默认提示消息发送成功', { chatId })
                        } catch (e) {
                            logger.error('[my_chat_member] ❌ 非白名单默认提示消息发送失败', { chatId, error: e.message })
                        }
                    } else {
                        logger.info('[my_chat_member] ℹ️ 非白名单用户拉群，但showAuthPrompt被禁用，不发送消息', { chatId })
                    }
                }
            }
            // === 场景 B: 机器人被踢出或离开 ===
            else if (newStatus === 'left' || newStatus === 'kicked') {
                logger.info('[my_chat_member] 机器人被移除，执行彻底清理', { chatId })
                await cleanupGroupData(chatId)
            }

        } catch (e) {
            logger.error('[my_chat_member] 处理异常', e)
        }
    })

}
