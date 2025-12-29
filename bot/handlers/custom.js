// 自定义指令（文本+图片）处理器
import { prisma } from '../../lib/db.js'
import { hasPermissionWithWhitelist } from '../helpers.js'
import { getChat } from '../state.js'
import { ensureDbChat } from '../database.js'

const BACKEND_URL = process.env.BACKEND_URL

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
                console.warn('[resolveImageUrl] Invalid BACKEND_URL:', BACKEND_URL)
                return url
            }
        }
    }

    return url
}

async function getIndex(chatId) {
  const row = await prisma.globalConfig.findUnique({ where: { key: `customcmd_index:${chatId}` }, select: { value: true } }).catch(() => null)
  if (!row?.value) return []
  try { return JSON.parse(row.value) } catch { return [] }
}

async function setIndex(chatId, arr) {
  const value = JSON.stringify(Array.from(new Set(arr)))
  await prisma.globalConfig.upsert({
    where: { key: `customcmd_index:${chatId}` },
    create: { key: `customcmd_index:${chatId}`, value, description: `Custom commands index for ${chatId}`, updatedBy: 'system' },
    update: { value, description: `Custom commands index for ${chatId}`, updatedBy: 'system', updatedAt: new Date() }
  })
}

async function getCmd(chatId, trigger) {
  const key = `customcmd:${chatId}:${trigger}`
  const row = await prisma.globalConfig.findUnique({ where: { key }, select: { value: true } }).catch(() => null)
  if (!row?.value) return null
  try { return JSON.parse(row.value) } catch { return null }
}

async function setCmd(chatId, trigger, payload) {
  const key = `customcmd:${chatId}:${trigger}`
  const value = JSON.stringify(payload)
  await prisma.globalConfig.upsert({
    where: { key },
    create: { key, value, description: `Custom command ${trigger} for ${chatId}`, updatedBy: 'system' },
    update: { value, description: `Custom command ${trigger} for ${chatId}`, updatedBy: 'system', updatedAt: new Date() }
  })
}

async function delCmd(chatId, trigger) {
  const key = `customcmd:${chatId}:${trigger}`
  await prisma.globalConfig.delete({ where: { key } }).catch(() => {})
}

export function registerCustomCommands(bot, ensureChat) {
  // 群组内自定义指令功能已禁用，只保留后台管理指令
  // 如需恢复，请取消注释以下代码

  bot.on('text', async (ctx, next) => {
  // 添加/编辑 文本指令：添加自定义指令 <触发词> <内容>
  bot.hears(/^添加自定义指令\s+([^\s]+)\s+([\s\S]+)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    const chatId = await ensureDbChat(ctx, chat)
    const ok = await hasPermissionWithWhitelist(ctx, chat)
    if (!ok) return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')

    const trigger = (ctx.match[1] || '').trim()
    const content = (ctx.match[2] || '').trim()
    if (!trigger || !content) return ctx.reply('用法：添加自定义指令 触发词 内容')

    const payload = await getCmd(chatId, trigger) || {}
    payload.content = content
    if (!payload.parseMode) payload.parseMode = 'Markdown'
    await setCmd(chatId, trigger, payload)

    const index = await getIndex(chatId)
    if (!index.includes(trigger)) {
      index.push(trigger)
      await setIndex(chatId, index)
    }
    await ctx.reply(`✅ 已设置自定义指令：${trigger}`)
  })

  // 设置图片：设置自定义图片 <触发词> <图片URL>
  bot.hears(/^设置自定义图片\s+([^\s]+)\s+(https?:\/\/\S+)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    const chatId = await ensureDbChat(ctx, chat)
    const ok = await hasPermissionWithWhitelist(ctx, chat)
    if (!ok) return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')

    const trigger = (ctx.match[1] || '').trim()
    const imageUrl = (ctx.match[2] || '').trim()
    const existing = await getCmd(chatId, trigger) || { content: '' }
    existing.imageUrl = resolveImageUrl(imageUrl)
    if (!existing.parseMode) existing.parseMode = 'Markdown'
    await setCmd(chatId, trigger, existing)

    const index = await getIndex(chatId)
    if (!index.includes(trigger)) {
      index.push(trigger)
      await setIndex(chatId, index)
    }
    await ctx.reply(`✅ 已设置图片：${trigger}`)
  })

  // 删除：删除自定义指令 <触发词>
  bot.hears(/^删除自定义指令\s+([^\s]+)$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    const chatId = await ensureDbChat(ctx, chat)
    const ok = await hasPermissionWithWhitelist(ctx, chat)
    if (!ok) return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')

    const trigger = (ctx.match[1] || '').trim()
    await delCmd(chatId, trigger)
    const index = (await getIndex(chatId)).filter(t => t !== trigger)
    await setIndex(chatId, index)
    await ctx.reply(`🗑️ 已删除：${trigger}`)
  })

  // 列表：自定义指令列表
  bot.hears(/^自定义指令列表$/i, async (ctx) => {
    const chat = ensureChat(ctx)
    if (!chat) return
    if (!(await hasPermissionWithWhitelist(ctx, chat))) {
      return ctx.reply('⚠️ 您没有权限。只有管理员、操作人或白名单用户可以操作。')
    }
    const chatId = await ensureDbChat(ctx, chat)
    const index = await getIndex(chatId)
    if (index.length === 0) return ctx.reply('当前没有自定义指令')
    await ctx.reply('📜 自定义指令列表：\n\n' + index.map(t => `- ${t}`).join('\n'))
  })

  // 触发：消息全文等于触发词时回复（仅管理员/操作人/白名单）
  bot.on('text', async (ctx, next) => {
    try {
      const text = (ctx.message?.text || '').trim()
      if (!text) return next()
      const chatId = String(ctx.chat?.id || '')
      const chat = ensureChat(ctx)
      if (!chat) return next()
      if (!(await hasPermissionWithWhitelist(ctx, chat))) {
        return next()
      }
      const cmd = await getCmd(chatId, text)
      if (!cmd) return next()
      const content = cmd.content || ''
      const imageUrl = cmd.imageUrl || ''
      const parse_mode = cmd.parseMode || 'Markdown'
      if (imageUrl) {
        try {
          await ctx.replyWithPhoto(imageUrl, { caption: content, parse_mode })
        } catch {
          await ctx.reply(content, { parse_mode })
        }
      } else {
        await ctx.reply(content, { parse_mode })
      }
    } catch (e) {
      // 静默失败，不影响其他命令
      return next()
    }
  })
})
}
