import { prisma } from '../../lib/db.js'
import { ensureCurrentBotId } from '../bot-identity.js'
import logger from '../logger.js'

export function registerMemberHandlers(bot) {
    // 机器人成员状态变更：加入/被移除群
    bot.on('my_chat_member', async (ctx) => {
        try {
            const upd = ctx.update?.my_chat_member
            const chat = ctx.chat
            if (!upd || !chat) return
            const newStatus = upd.new_chat_member?.status
            const oldStatus = upd.old_chat_member?.status
            const chatId = String(chat.id)
            const title = chat.title || ''
            const botId = await ensureCurrentBotId(bot)

            // 🔥 修复：从 ctx.myChatMember.from 获取邀请人信息
            const from = ctx.myChatMember?.from || upd.from
            const inviterId = String(from?.id || '')
            const inviterUsername = from?.username ? `@${from.username}` : null

            // 🔥 调试日志：输出原始数据
            logger.debug('[my_chat_member][raw-data]', {
                from: from,
                inviterId,
                inviterUsername,
                firstName: from?.first_name,
                lastName: from?.last_name
            })

            logger.info('[my_chat_member]', {
                botId,
                chatId,
                title,
                inviterId,
                inviterUsername,
                inviterName: from ? `${from.first_name || ''} ${from.last_name || ''}`.trim() : '',
                from: from?.username ? `@${from.username}` : from?.id,
                old: oldStatus,
                new: newStatus,
            })

            if (newStatus === 'member' || newStatus === 'administrator') {
                // 🔥 只有当旧状态不是 member/administrator 时才是新加入（邀请）
                // 避免重新设置为管理员等操作被误判为邀请
                const isNewJoin = !oldStatus || oldStatus === 'left' || oldStatus === 'kicked'

                if (!isNewJoin) {
                    logger.info('[my_chat_member][not-new-join]', { oldStatus, newStatus, chatId })
                    // 仅更新群组信息，不记录邀请
                    await prisma.chat.update({
                        where: { id: chatId },
                        data: { title, botId }
                    }).catch(() => { })
                    return
                }

                // 🔥 检查邀请人是否在白名单中
                let autoAllowed = false
                let isWhitelisted = false

                if (inviterId) {
                    const whitelistedUser = await prisma.whitelistedUser.findUnique({
                        where: { userId: inviterId }
                    })

                    if (whitelistedUser) {
                        isWhitelisted = true
                        autoAllowed = true
                        logger.info('[my_chat_member][whitelisted]', { inviterId, inviterUsername, chatId })

                        // 🔥 如果用户名不同，更新白名单记录中的用户名
                        if (inviterUsername && inviterUsername !== whitelistedUser.username) {
                            await prisma.whitelistedUser.update({
                                where: { userId: inviterId },
                                data: { username: inviterUsername }
                            }).catch(() => { })
                            logger.debug('[my_chat_member][username-updated]', { inviterId, oldUsername: whitelistedUser.username, newUsername: inviterUsername })
                        }
                    } else {
                        logger.info('[my_chat_member][not-whitelisted]', { inviterId, inviterUsername, chatId })
                    }
                }

                // 🔥 邀请记录功能已删除

                // Upsert chat，如果邀请人在白名单，自动设置 allowed=true
                // 🔥 修复：在新加入时总是保存邀请人信息
                const res = await prisma.chat.upsert({
                    where: { id: chatId },
                    create: {
                        id: chatId,
                        title,
                        botId,
                        status: autoAllowed ? 'APPROVED' : 'PENDING',
                        allowed: autoAllowed,
                        invitedBy: inviterId || null, // 🔥 保存邀请人ID
                        invitedByUsername: inviterUsername || null // 🔥 保存邀请人用户名
                    },
                    update: {
                        title,
                        botId,
                        status: autoAllowed ? 'APPROVED' : undefined,
                        allowed: autoAllowed ? true : undefined,
                        // 🔥 新加入时总是更新邀请人信息（允许仅有ID时也更新）
                        ...(inviterId ? { invitedBy: inviterId } : {}),
                        ...(inviterUsername ? { invitedByUsername: inviterUsername } : {})
                    },
                })

                logger.info('[my_chat_member][upsert-result]', {
                    chatId,
                    status: res.status,
                    allowed: res.allowed,
                    invitedBy: res.invitedBy
                })
            } else if (newStatus === 'left' || newStatus === 'kicked') {
                // 机器人被移除
                logger.info('[my_chat_member][bot-removed]', { chatId })
                // 可以选择更新状态为 BLOCKED，或者保持原样
            }
        } catch (e) {
            logger.error('[my_chat_member][error]', e)
        }
    })
}
