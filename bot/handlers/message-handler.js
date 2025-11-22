import { prisma } from '../../lib/db.js'
import { ensureCurrentBotId } from '../bot-identity.js'
import { ensureDefaultFeatures } from '../constants.js'
import logger from '../logger.js'

// 🔥 地址验证功能：每个群只确认一个地址
async function handleAddressVerificationNew(ctx) {
    try {
        const chatId = String(ctx.chat.id)
        const text = ctx.message?.text || ''

        // 检测钱包地址格式
        const addressPatterns = [
            /\b(T[A-Za-z1-9]{33})\b/g,  // TRC20
            /\b(0x[a-fA-F0-9]{40})\b/g, // ERC20
            /\b([13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g, // BTC Legacy
            /\b(bc1[a-z0-9]{39,59})\b/g, // BTC SegWit
        ]

        let detectedAddress = null
        for (const pattern of addressPatterns) {
            const match = text.match(pattern)
            if (match) {
                detectedAddress = match[0]
                break
            }
        }

        if (!detectedAddress) return false

        // 检查是否启用了地址验证功能
        const setting = await prisma.setting.findUnique({
            where: { chatId },
            select: { addressVerificationEnabled: true }
        })

        if (!setting?.addressVerificationEnabled) return false

        const address = detectedAddress
        const senderId = String(ctx.from.id)
        const senderName = ctx.from.username ? `@${ctx.from.username}` :
            (ctx.from.first_name || ctx.from.last_name) ?
                `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() :
                senderId

        // 查询该群的地址验证记录（每个群只有一条记录）
        let record = await prisma.addressVerification.findUnique({
            where: { chatId }
        })

        if (!record) {
            // 第一次发送地址
            // 🔥 获取完整Telegram名称（first_name + last_name）
            const fullName = (ctx.from.first_name || '') + (ctx.from.last_name ? ' ' + ctx.from.last_name : '') || senderName

            await prisma.addressVerification.create({
                data: {
                    chatId,
                    confirmedAddress: address,
                    confirmedCount: 1,
                    lastSenderId: senderId,
                    lastSenderName: fullName
                }
            })

            const replyText = `🔐 *此地址已加入安全验证*\n\n` +
                `📍 验证地址：\`${address}\`\n` +
                `🔢 验证次数：*1*\n` +
                `👤 发送人：${fullName}`

            await ctx.reply(replyText, {
                parse_mode: 'Markdown',
                reply_to_message_id: ctx.message.message_id
            })

            logger.debug('[address-verification-new][first-time]', { chatId, address, senderId })
            return true
        }

        // 已有记录
        const confirmedAddr = record.confirmedAddress
        const pendingAddr = record.pendingAddress

        if (address === confirmedAddr) {
            // 发送的是已确认的地址
            const newCount = record.confirmedCount + 1
            // 🔥 获取用户名（优先）或完整名称
            const currentUsername = ctx.from.username ? `@${ctx.from.username}` : null
            const currentFullName = (ctx.from.first_name || '') + (ctx.from.last_name ? ' ' + ctx.from.last_name : '') || senderId
            const currentDisplay = currentUsername || currentFullName

            await prisma.addressVerification.update({
                where: { chatId },
                data: {
                    confirmedCount: newCount,
                    lastSenderId: senderId,
                    lastSenderName: currentDisplay,
                    updatedAt: new Date()
                }
            })

            const replyText = `✅ *地址验证通过*\n\n` +
                `📍 验证地址：\`${address}\`\n` +
                `🔢 验证次数：*${newCount}*\n` +
                `📤 上次发送人：${record.lastSenderName || record.lastSenderId}\n` +
                `📤 本次发送人：${currentDisplay}`

            await ctx.reply(replyText, {
                parse_mode: 'Markdown',
                reply_to_message_id: ctx.message.message_id
            })

            logger.debug('[address-verification-new][confirmed-address]', { chatId, address, count: newCount })
            return true
        }

        if (address === pendingAddr) {
            // 发送的是待确认的地址（第2次发送新地址）
            const newCount = record.pendingCount + 1

            // 🔥 获取用户名（优先）或完整名称
            const currentUsername = ctx.from.username ? `@${ctx.from.username}` : null
            const currentFullName = (ctx.from.first_name || '') + (ctx.from.last_name ? ' ' + ctx.from.last_name : '') || senderId
            const currentDisplay = currentUsername || currentFullName

            // 🔥 第2次发送待确认地址，将其升级为确认地址
            await prisma.addressVerification.update({
                where: { chatId },
                data: {
                    confirmedAddress: address,
                    confirmedCount: newCount,
                    pendingAddress: null,
                    pendingCount: 0,
                    lastSenderId: senderId,
                    lastSenderName: currentDisplay,
                    updatedAt: new Date()
                }
            })

            const replyText = `✅ *地址验证通过*\n\n` +
                `📍 验证地址：\`${address}\`\n` +
                `🔢 验证次数：*${newCount}*\n` +
                `📤 上次发送人：${record.lastSenderName || record.lastSenderId}\n` +
                `📤 本次发送人：${currentDisplay}`

            await ctx.reply(replyText, {
                parse_mode: 'Markdown',
                reply_to_message_id: ctx.message.message_id
            })

            logger.debug('[address-verification-new][pending-confirmed]', { chatId, address, newCount })
            return true
        }

        // 🔥 发送的是新地址（不同于确认地址和待确认地址）
        // 发出警告，并将新地址设为待确认地址

        // 🔥 获取当前发送人的信息
        const currentSenderUsername = ctx.from.username ? `@${ctx.from.username}` : null
        const currentSenderFullName = (ctx.from.first_name || '') + (ctx.from.last_name ? ' ' + ctx.from.last_name : '').trim() || senderId
        const currentSenderDisplay = currentSenderUsername || currentSenderFullName || senderId

        // 🔥 查询之前发送人的信息
        // 如果之前记录的是用户名，直接使用；如果是ID或名称，尝试查找用户名
        let previousSenderUsername = null
        let previousSenderFullName = '未知'

        // 从记录中获取之前的发送人名称
        if (record.lastSenderName) {
            // 如果之前保存的是用户名格式（@开头），则直接使用
            if (record.lastSenderName.startsWith('@')) {
                previousSenderUsername = record.lastSenderName
                // 需要查询该用户的实际名称（从数据库或缓存）
                previousSenderFullName = record.lastSenderName // 暂时使用用户名
            } else {
                // 如果之前保存的是Telegram名称，使用它
                previousSenderFullName = record.lastSenderName
            }
        }

        // 🔥 如果之前的发送人ID存在且不同，尝试从聊天记录中查找用户名
        // 注意：这里无法直接访问 chat state，暂时跳过从 state 查找用户名的逻辑，或者需要传入 chat state
        // 为了简化，这里暂时只使用数据库中的信息

        const previousSenderDisplay = previousSenderUsername || previousSenderFullName || record.lastSenderId || '未知'

        // 🔥 保存当前发送人的用户名（如果有）或完整名称
        await prisma.addressVerification.update({
            where: { chatId },
            data: {
                pendingAddress: address,
                pendingCount: 1,
                lastSenderId: senderId,
                lastSenderName: currentSenderUsername || currentSenderFullName, // 优先保存用户名
                updatedAt: new Date()
            }
        })

        const replyText = `⚠️⚠️⚠️*温馨提示*⚠️⚠️⚠️\n\n` +
            `❗️此地址和原地址不一样请小心交易❗️\n\n` +
            `🆔还想隐藏: \`${senderId}\`\n` +
            `🚹修改前名称：${previousSenderFullName}\n` +
            `🚺修改后名称：${currentSenderFullName}\n\n` +
            `📍新地址：\`${address}\`\n` +
            `📍原地址：\`${confirmedAddr || '无'}\`\n\n` +
            `🔢验证次数：0\n` +
            `📤上次发送人：${previousSenderDisplay}\n` +
            `📤本次发送人：${currentSenderDisplay}`

        await ctx.reply(replyText, {
            parse_mode: 'Markdown',
            reply_to_message_id: ctx.message.message_id
        })

        logger.debug('[address-verification-new][warning-new-address]', {
            chatId,
            oldAddress: confirmedAddr,
            newAddress: address,
            senderId
        })
        return true

    } catch (error) {
        logger.error('[address-verification-new][error]', error)
        return false
    }
}

export function registerMessageHandlers(bot) {
    // 兜底：收到任何消息时，确保 chat 记录已 upsert 并绑定到当前机器人
    bot.on('message', async (ctx, next) => {
        try {
            const chat = ctx.chat
            if (!chat) return await next()
            if (chat.type === 'channel') return
            const chatId = String(chat.id)
            const title = chat.title || ''
            const from = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.id
            const text = ctx.message?.text || ctx.message?.caption || '[非文本消息]'

            logger.debug('[message][recv]', { chatId, title, from, text })

            // 🔥 地址验证功能 - 优先处理（使用新版本逻辑）
            if (ctx.message?.text && chatId.startsWith('-')) {
                const handled = await handleAddressVerificationNew(ctx)
                if (handled) {
                    // 地址验证已处理，不继续执行后续逻辑
                    return
                }
            }

            // 🔥 检查群组是否存在，如果不存在或未绑定，尝试补充白名单检测
            const existingChat = await prisma.chat.findUnique({
                where: { id: chatId },
                select: { id: true, allowed: true, botId: true }
            })

            const botId = await ensureCurrentBotId(bot)

            // 如果群组不存在，或者未授权且未绑定机器人，尝试检测白名单
            if (!existingChat || (!existingChat.allowed && !existingChat.botId)) {
                // 🔥 备用白名单检测：从消息发送者检查
                // 获取群成员列表，找出可能的邀请人
                try {
                    const userId = String(ctx.from?.id || '')
                    const username = ctx.from?.username ? `@${ctx.from.username}` : null

                    // 检查当前消息发送者是否在白名单中
                    if (userId) {
                        const whitelistedUser = await prisma.whitelistedUser.findUnique({
                            where: { userId }
                        })

                        if (whitelistedUser) {
                            // 找到白名单用户，自动授权该群组
                            logger.info('[message][whitelist-detected]', { chatId, userId, username })

                            // 🔥 如果用户名不同，更新白名单记录中的用户名
                            if (username && username !== whitelistedUser.username) {
                                await prisma.whitelistedUser.update({
                                    where: { userId },
                                    data: { username }
                                }).catch((e) => {
                                    logger.error('[message][username-update-error]', e)
                                })
                                logger.debug('[message][username-updated]', { userId, oldUsername: whitelistedUser.username, newUsername: username })
                            }

                            // ⚠️ 不在这里创建邀请记录，避免与 my_chat_member 事件重复
                            // 邀请记录只在 my_chat_member 事件中创建

                            // 自动授权：先确保 Chat 与 Setting 存在，再为群聊创建功能开关，避免外键错误
                            await Promise.all([
                                prisma.chat.upsert({
                                    where: { id: chatId },
                                    create: {
                                        id: chatId,
                                        title,
                                        botId,
                                        status: 'APPROVED',
                                        allowed: true
                                    },
                                    update: {
                                        title,
                                        botId,
                                        status: 'APPROVED',
                                        allowed: true
                                    },
                                }),
                                prisma.setting.upsert({
                                    where: { chatId },
                                    create: { chatId, accountingEnabled: true }, // 🔥 默认开启记账
                                    update: {},
                                })
                            ])
                            // 仅对群聊创建默认功能开关（chatId 以 '-' 开头），避免私聊外键冲突
                            if (String(chatId).startsWith('-')) {
                                await ensureDefaultFeatures(chatId, prisma)
                            }

                            logger.info('[message][auto-authorized]', { chatId, userId })
                        } else {
                            // 非白名单用户
                            await Promise.all([
                                prisma.chat.upsert({
                                    where: { id: chatId },
                                    create: { id: chatId, title, botId, status: 'PENDING', allowed: false },
                                    update: { title, botId },
                                }),
                                prisma.setting.upsert({
                                    where: { chatId },
                                    create: { chatId, accountingEnabled: true }, // 🔥 默认开启记账
                                    update: {},
                                })
                            ])
                        }
                    } else {
                        await Promise.all([
                            prisma.chat.upsert({
                                where: { id: chatId },
                                create: { id: chatId, title, status: 'PENDING', allowed: false },
                                update: { title },
                            }),
                            prisma.setting.upsert({
                                where: { chatId },
                                create: { chatId, accountingEnabled: true }, // 🔥 默认开启记账
                                update: {},
                            })
                        ])
                    }
                } catch (e) {
                    logger.error('[message][whitelist-check-error]', e)
                    await Promise.all([
                        prisma.chat.upsert({
                            where: { id: chatId },
                            create: { id: chatId, title, status: 'PENDING', allowed: false },
                            update: { title },
                        }),
                        prisma.setting.upsert({
                            where: { chatId },
                            create: { chatId, accountingEnabled: true }, // 🔥 默认开启记账
                            update: {},
                        })
                    ])
                }
            } else {
                // 群组已存在，仅更新标题
                await prisma.chat.update({
                    where: { id: chatId },
                    data: { title }
                }).catch((e) => {
                    logger.error('[message][title-update-error]', { chatId, error: e.message })
                })
            }

            logger.debug('[message][upsert-ok]', { chatId })
        } catch (e) {
            logger.error('[message][error]', e)
        } finally {
            try { await next() } catch { }
        }
    })
}
