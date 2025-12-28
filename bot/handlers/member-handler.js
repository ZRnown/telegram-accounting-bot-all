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

            logger.info('[my_chat_member] 触发者信息', {
                actionUserId,
                actionUsername,
                actionFullName,
                hasMyChatMemberFrom: !!ctx.myChatMember?.from,
                hasCtxFrom: !!ctx.from
            })

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
                    // 检查是否需要重新初始化（比如之前被禁用了）
                    const existingChat = await prisma.chat.findUnique({
                        where: { id: chatId },
                        select: { allowed: true, status: true }
                    })

                    // 如果群组之前被禁用，现在重新启用，需要重新初始化
                    if (existingChat && (!existingChat.allowed || existingChat.status === 'BLOCKED')) {
                        logger.info('[my_chat_member] 检测到群组重新启用，开始重新初始化', { chatId })
                        // 这里会继续执行下面的新加入逻辑
                    } else {
                    // 仅更新标题和绑定关系
                    await prisma.chat.update({
                        where: { id: chatId },
                        data: { title, botId }
                    }).catch(() => {})
                    return
                    }
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
                        logger.info('[my_chat_member] ✅ 邀请人是白名单用户，自动授权', { inviter: actionUserId, username: actionUsername })

                        // 顺便更新白名单用户的用户名
                        const newUsername = actionUsername || (actionFullName ? actionFullName : null)
                        if (newUsername && newUsername !== whitelistedUser.username) {
                            await prisma.whitelistedUser.update({
                                where: { userId: actionUserId },
                                data: { username: newUsername }
                            }).catch(() => {})
                            logger.info('[my_chat_member] ✅ 更新白名单用户显示名', {
                                userId: actionUserId,
                                oldName: whitelistedUser.username,
                                newName: newUsername
                            })
                        }
                    } else {
                        logger.info('[my_chat_member] ❌ 邀请人不在白名单中', { inviter: actionUserId, username: actionUsername })
                    }
                } else {
                    logger.warn('[my_chat_member] ⚠️ 无法获取邀请人信息', { chatId, title })
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
                        // 🔥 修复点：如果检测到白名单，强制更新为 APPROVED，否则保持原样 (undefined)
                        status: autoAllowed ? 'APPROVED' : undefined,
                        allowed: autoAllowed ? true : undefined,
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

                // 🔥 新增：为新群组自动获取实时汇率
                try {
                    const { fetchUsdtToFiatRate } = await import('../helpers.js')
                    const rate = await fetchUsdtToFiatRate('cny') // 默认使用人民币汇率
                    if (rate) {
                        await prisma.setting.update({
                            where: { chatId },
                            data: { realtimeRate: rate, fixedRate: null }
                        })
                        logger.info('[my_chat_member] ✅ 自动设置实时汇率', { chatId, rate })
                    }
                } catch (e) {
                    logger.warn('[my_chat_member] ⚠️ 自动获取汇率失败', { chatId, error: e.message })
                }

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

                    if (settings?.showAuthPrompt !== false) {
                    const customMsg = settings?.nonWhitelistWelcomeMessage?.trim()

                        // 确定要发送的消息
                        const msgToSend = customMsg || (
                            `🚫 *未授权警告*\n\n` +
                            `本群尚未被授权使用。\n` +
                            `请联系管理员在后台通过审核，或由白名单用户邀请入群。`
                        )

                        // 🔥 替换变量
                        const finalMsg = msgToSend
                            .replace('{inviter}', actionUsername || actionFullName || '未知用户')
                            .replace('{chat}', title)
                            .replace('{id}', actionUserId)

                        try {
                            await ctx.reply(finalMsg, { parse_mode: 'Markdown' })
                            logger.info('[my_chat_member] ✅ 非白名单提醒消息发送成功', { chatId, msgLength: finalMsg.length })
                        } catch (e) {
                            logger.warn('[my_chat_member] ⚠️ 非白名单提醒消息Markdown发送失败，尝试纯文本', { chatId, error: e.message })
                            try {
                                await ctx.reply(finalMsg)
                                logger.info('[my_chat_member] ✅ 非白名单提醒消息(纯文本)发送成功', { chatId, msgLength: finalMsg.length })
                            } catch (e2) {
                                logger.error('[my_chat_member] ❌ 非白名单提醒消息发送失败', { chatId, error: e2.message })
                            }
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
