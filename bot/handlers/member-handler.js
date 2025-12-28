import { prisma } from '../../lib/db.js'
import { ensureCurrentBotId } from '../bot-identity.js'
import { ensureDefaultFeatures } from '../constants.js'
import logger from '../logger.js'

/**
 * 获取机器人的欢迎消息 (白名单)
 */
async function getBotWelcomeMessage(botId) {
    const bot = await prisma.bot.findUnique({
        where: { id: botId },
        select: { welcomeMessage: true }
    })
    return bot?.welcomeMessage
}

/**
 * 彻底清理群组数据 (辅助函数)
 */
async function cleanupGroupData(chatId) {
    try {
        logger.info('[cleanup] 开始清理群组数据', { chatId })

        // 🔥 修复删除顺序：严格按照外键依赖关系从子表到父表删除
        // 1. 先删除所有子表记录
        await Promise.all([
            prisma.chatFeatureFlag.deleteMany({ where: { chatId } }),
            prisma.addressVerification.deleteMany({ where: { chatId } }),
            prisma.featureWarningLog.deleteMany({ where: { chatId } }),
            prisma.operator.deleteMany({ where: { chatId } }),
            prisma.commission.deleteMany({ where: { chatId } }),
            prisma.income.deleteMany({ where: { chatId } }),
            prisma.dispatch.deleteMany({ where: { chatId } }),
            prisma.billItem.deleteMany({ where: { bill: { chatId } } }),
            prisma.bill.deleteMany({ where: { chatId } })
        ])

        // 2. 删除setting（有chatId外键）
        await prisma.setting.deleteMany({ where: { chatId } })

        // 3. 最后删除chat主表
        await prisma.chat.delete({ where: { id: chatId } })

        logger.info('[cleanup] 群组数据清理完成', { chatId })
        return true
    } catch (e) {
        if (e.code !== 'P2025') logger.error('[cleanup] 清理数据失败', { chatId, error: e.message })
        return false
    }
}

export function registerMemberHandlers(bot) {
    console.log('[REGISTER] registerMemberHandlers 被调用')

    // (保留普通的 chat_member 监听，用于欢迎新成员，代码不变)
    bot.on('chat_member', async (ctx) => {
        // ... 原有逻辑：监听新成员加入并发送欢迎语 ...
        // 这里的逻辑只针对"普通成员"加入已授权的群组
        // ... (保持原样即可) ...
    })

    // 监听机器人自身进出群状态变更 (核心逻辑)
    const memberHandler = async (ctx) => {
        console.log('[LISTENER] my_chat_member 监听器被触发', {
            updateId: ctx.update?.update_id,
            chatId: ctx.chat?.id,
            newStatus: ctx.update?.my_chat_member?.new_chat_member?.status,
            oldStatus: ctx.update?.my_chat_member?.old_chat_member?.status
        })

        try {
            const upd = ctx.update?.my_chat_member
            const chat = ctx.chat

            logger.info('[my_chat_member] 收到事件', {
                hasUpdate: !!ctx.update,
                hasMyChatMember: !!ctx.update?.my_chat_member,
                hasChat: !!chat,
                updateType: ctx.update?.update_id ? 'full' : 'unknown',
                chatId: chat?.id,
                chatTitle: chat?.title
            })

            if (!upd || !chat) {
                logger.warn('[my_chat_member] 缺少必要数据', {
                    hasUpdate: !!upd,
                    hasChat: !!chat,
                    updateKeys: ctx.update ? Object.keys(ctx.update) : []
                })
                return
            }

            const newStatus = upd.new_chat_member?.status
            const oldStatus = upd.old_chat_member?.status
            const chatId = String(chat.id)
            const title = chat.title || ''
            const botId = await ensureCurrentBotId(bot)

            // 获取触发动作的人（邀请人）- 多种方式尝试获取
            let from = null
            let actionUserId = ''
            let actionUsername = null
            let actionFullName = ''

            // 方法1: 从 ctx.myChatMember.from 获取
            if (ctx.myChatMember?.from) {
                from = ctx.myChatMember.from
                logger.info('[my_chat_member] 从 ctx.myChatMember.from 获取邀请人', {
                    userId: from.id,
                    username: from.username,
                    firstName: from.first_name,
                    lastName: from.last_name
                })
            }
            // 方法2: 从 ctx.from 获取
            else if (ctx.from) {
                from = ctx.from
                logger.info('[my_chat_member] 从 ctx.from 获取邀请人', {
                    userId: from.id,
                    username: from.username,
                    firstName: from.first_name,
                    lastName: from.last_name
                })
            }
            // 方法3: 从 update 原始数据获取
            else if (upd.from) {
                from = upd.from
                logger.info('[my_chat_member] 从 upd.from 获取邀请人', {
                    userId: from.id,
                    username: from.username,
                    firstName: from.first_name,
                    lastName: from.last_name
                })
            }
            // 方法4: 记录完整 update 数据用于调试
            else {
                logger.warn('[my_chat_member] 无法获取邀请人信息，记录完整update数据', {
                    chatId,
                    update: JSON.stringify(ctx.update, null, 2)
                })
            }

            if (from) {
                actionUserId = String(from.id || '')
                actionUsername = from.username ? `@${from.username}` : null
                actionFullName = `${from.first_name || ''} ${from.last_name || ''}`.trim()
            }

            logger.info('[my_chat_member] 机器人状态变更', {
                chatId,
                title,
                action: newStatus,
                oldStatus,
                inviter: actionUserId,
                inviterUsername: actionUsername,
                inviterFullName: actionFullName,
                hasInviter: !!actionUserId
            })

            // === 场景 A: 机器人被邀请入群 ===
            // 🔥 只处理从外部状态进入群组的情况（真正的新加群）
            if ((newStatus === 'member' || newStatus === 'administrator') &&
                (oldStatus === 'left' || oldStatus === 'kicked' || !oldStatus)) {

                logger.info('[my_chat_member] 机器人被邀请入群 (真正的新加群)', {
                    chatId,
                    title,
                    inviter: actionUserId,
                    inviterUsername: actionUsername,
                    inviterFullName: actionFullName,
                    status: newStatus,
                    oldStatus: oldStatus,
                    hasInviterInfo: !!actionUserId
                })

                // 🔥 如果无法获取邀请人信息，但机器人确实被邀请入群，记录警告但继续处理
                if (!actionUserId) {
                    logger.warn('[my_chat_member] 无法获取邀请人信息，将使用默认处理逻辑', {
                        chatId,
                        title,
                        updateInfo: {
                            newStatus,
                            oldStatus,
                            hasFrom: !!from,
                            updateKeys: Object.keys(upd)
                        }
                    })
                }

                let isWhitelisted = false
                let whitelistedUser = null

                if (actionUserId) {
                    whitelistedUser = await prisma.whitelistedUser.findUnique({
                        where: { userId: actionUserId }
                    })
                    isWhitelisted = !!whitelistedUser

                    logger.info('[my_chat_member] 白名单检查结果', {
                        chatId,
                        inviter: actionUserId,
                        isWhitelisted,
                        whitelistedUser: whitelistedUser ? {
                            id: whitelistedUser.id,
                            username: whitelistedUser.username,
                            note: whitelistedUser.note
                        } : null
                    })
                } else {
                    logger.warn('[my_chat_member] 无法获取邀请人信息，将使用默认处理（非白名单模式）', { chatId, title })
                    // 无法获取邀请人时，默认为非白名单，但仍然发送消息
                    isWhitelisted = false
                }

                // 3. 准备变量替换（即使没有邀请人信息也要有合理的默认值）
                const vars = {
                    '{inviter}': actionUsername || actionFullName || '未知用户',
                    '{chat}': title || '本群',
                    '{id}': actionUserId || '未知'
                };

                const replaceVars = (str) => {
                    if (!str) return str;
                    let out = str;
                    for (const [k, v] of Object.entries(vars)) {
                        out = out.split(k).join(v);
                    }
                    return out;
                };

                // 在监听器函数内部重新获取消息模板（避免闭包作用域问题）
                const botRecord = await prisma.bot.findUnique({
                    where: { id: botId },
                    select: { welcomeMessage: true }
                })

                const latestSetting = await prisma.setting.findFirst({
                    where: { chat: { botId }, nonWhitelistWelcomeMessage: { not: null } },
                    select: { nonWhitelistWelcomeMessage: true }
                })

                logger.info(`[my_chat_member] 消息模板获取: botRecord=${!!botRecord?.welcomeMessage}, latestSetting=${!!latestSetting?.nonWhitelistWelcomeMessage}`, {
                    chatId,
                    botId
                })

                // 1. 强制更新逻辑：如果是白名单，强制 status='APPROVED' 和 allowed=true
                const chatUpdateData = {
                    title,
                    botId,
                    invitedBy: actionUserId || null,
                    invitedByUsername: actionUsername || null
                }
                // 🔥 白名单用户：强制更新为 APPROVED，无论当前状态如何
                if (isWhitelisted) {
                    chatUpdateData.status = 'APPROVED'
                    chatUpdateData.allowed = true
                }

                logger.info('[my_chat_member] 开始数据库操作', {
                    chatId,
                    isWhitelisted,
                    willSetStatus: isWhitelisted ? 'APPROVED' : 'PENDING',
                    willSetAllowed: isWhitelisted
                })

                const upsertResult = await prisma.chat.upsert({
                    where: { id: chatId },
                    create: {
                        id: chatId,
                        ...chatUpdateData,
                        status: isWhitelisted ? 'APPROVED' : 'PENDING',
                        allowed: isWhitelisted
                    },
                    update: chatUpdateData
                })

                logger.info('[my_chat_member] 群组记录已更新', {
                    chatId,
                    upsertResult: {
                        id: upsertResult.id,
                        title: upsertResult.title,
                        status: upsertResult.status,
                        allowed: upsertResult.allowed,
                        invitedBy: upsertResult.invitedBy,
                        invitedByUsername: upsertResult.invitedByUsername
                    }
                })

                // 2. 确保 Setting 存在
                const settingResult = await prisma.setting.upsert({
                    where: { chatId },
                    create: { chatId, accountingEnabled: true },
                    update: {}
                })

                logger.info('[my_chat_member] 设置记录已确保存在', {
                    chatId,
                    settingId: settingResult.id,
                    accountingEnabled: settingResult.accountingEnabled
                })

                // 5. 发送消息
                if (isWhitelisted) {
                    // === 白名单欢迎 ===

                    logger.info('[my_chat_member] 准备发送白名单欢迎消息', {
                        chatId,
                        hasCustomWelcome: !!botRecord?.welcomeMessage,
                        willInitializeFeatures: String(chatId).startsWith('-')
                    })

                    // 初始化功能
                    if (String(chatId).startsWith('-')) {
                        const featuresResult = await ensureDefaultFeatures(chatId, prisma, true)
                        logger.info('[my_chat_member] 功能开关已初始化', {
                            chatId,
                            featuresResult
                        })
                    }

                    const rawMsg = botRecord?.welcomeMessage || `✅ *机器人已激活*\n\n本群已自动授权。`;
                    const finalMsg = replaceVars(rawMsg);

                    logger.info('[my_chat_member] 发送白名单欢迎消息', {
                        chatId,
                        rawMessage: rawMsg,
                        finalMessage: finalMsg,
                        variables: vars
                    })

                    try {
                        await ctx.reply(finalMsg, { parse_mode: 'Markdown' })
                        logger.info('[my_chat_member] 白名单欢迎消息发送成功', { chatId })
                    } catch (replyError) {
                        logger.warn('[my_chat_member] Markdown模式发送失败，尝试纯文本', {
                            chatId,
                            error: replyError.message
                        })
                        await ctx.reply(finalMsg)
                        logger.info('[my_chat_member] 白名单欢迎消息（纯文本）发送成功', { chatId })
                    }

                } else {
                    // === 非白名单提醒 ===
                    logger.info('[my_chat_member] 准备发送非白名单提醒消息', {
                        chatId,
                        hasCustomMessage: !!latestSetting?.nonWhitelistWelcomeMessage
                    })

                    // 🔥 核心修复：优先使用你在后台设置的内容
                    const customNonMsg = latestSetting?.nonWhitelistWelcomeMessage;
                    const defaultNonMsg = `🚫 *未授权警告*\n\n本群尚未授权。邀请人: {inviter} (ID: {id})`;

                    const rawMsg = customNonMsg || defaultNonMsg;
                    const finalMsg = replaceVars(rawMsg);

                    logger.info('[my_chat_member] 发送非白名单提醒消息', {
                        chatId,
                        rawMessage: rawMsg,
                        finalMessage: finalMsg,
                        variables: vars,
                        usedCustom: !!customNonMsg
                    })

                    try {
                        await ctx.reply(finalMsg, { parse_mode: 'Markdown' })
                        logger.info('[my_chat_member] 非白名单提醒消息发送成功', { chatId })
                    } catch (replyError) {
                        logger.warn('[my_chat_member] Markdown模式发送失败，尝试纯文本', {
                            chatId,
                            error: replyError.message
                        })
                        await ctx.reply(finalMsg)
                        logger.info('[my_chat_member] 非白名单提醒消息（纯文本）发送成功', { chatId })
                    }
                }

            }

            // === 场景 B: 机器人被踢出或离开 ===
            else if (newStatus === 'left' || newStatus === 'kicked') {
                logger.info('[my_chat_member] 机器人被移除，执行彻底清理', {
                    chatId,
                    newStatus,
                    oldStatus
                })
                // 当机器人被踢出时，也执行彻底清理，保证下次加群是全新的
                await cleanupGroupData(chatId)
            }

            // === 场景 C: 机器人权限变更（已在群内） ===
            else {
                logger.info('[my_chat_member] 机器人权限变更（已在群内）', {
                    chatId,
                    title,
                    oldStatus,
                    newStatus,
                    inviter: actionUserId
                })
                // 对于权限变更，不需要发送欢迎消息，只需要更新数据库状态
            }

        } catch (e) {
            logger.error('[my_chat_member] 处理异常', e)
        }
    }

    bot.on('my_chat_member', memberHandler)
    console.log('[REGISTER] my_chat_member 监听器已注册')
}
