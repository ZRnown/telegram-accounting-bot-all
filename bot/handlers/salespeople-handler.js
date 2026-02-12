import { prisma } from '../../lib/db.js'
import {
  SALESPEOPLE_CONFIG_KEY,
  SALESPEOPLE_GROUP_BUTTON_CONFIG_KEY,
  buildSalespersonEntriesFromTokens,
  buildSalespersonListText,
  parseSalespeopleGroupButtonValue,
  parseSalespersonConfigEntries,
  parseSalespersonTokens
} from '../salespeople-utils.js'
import { hasWhitelistOnlyPermission } from '../helpers.js'

async function loadSalespeople() {
  const config = await prisma.globalConfig.findUnique({
    where: { key: SALESPEOPLE_CONFIG_KEY },
    select: { value: true }
  })

  const entries = parseSalespersonConfigEntries(config?.value)
  if (entries.length === 0) {
    return { entries: [], users: [] }
  }

  return { entries, users: entries }
}

async function saveSalespeople(entries, updatedBy) {
  await prisma.globalConfig.upsert({
    where: { key: SALESPEOPLE_CONFIG_KEY },
    create: {
      key: SALESPEOPLE_CONFIG_KEY,
      value: JSON.stringify(entries),
      description: '业务员列表（用户名/用户ID）',
      updatedBy
    },
    update: {
      value: JSON.stringify(entries),
      updatedBy,
      updatedAt: new Date()
    }
  })
}

async function saveSalespeopleGroupButtonVisible(visible, updatedBy) {
  await prisma.globalConfig.upsert({
    where: { key: SALESPEOPLE_GROUP_BUTTON_CONFIG_KEY },
    create: {
      key: SALESPEOPLE_GROUP_BUTTON_CONFIG_KEY,
      value: visible ? 'true' : 'false',
      description: '群聊是否展示查看业务员按钮',
      updatedBy
    },
    update: {
      value: visible ? 'true' : 'false',
      updatedBy,
      updatedAt: new Date()
    }
  })
}

async function loadSalespeopleGroupButtonVisible() {
  const config = await prisma.globalConfig.findUnique({
    where: { key: SALESPEOPLE_GROUP_BUTTON_CONFIG_KEY },
    select: { value: true }
  })
  return parseSalespeopleGroupButtonValue(config?.value, true)
}

async function resolveSalespeopleFromInput(rawInput) {
  const parsed = parseSalespersonTokens(rawInput)
  if (parsed.userIds.length === 0 && parsed.usernames.length === 0 && parsed.invalid.length === 0) {
    return { users: [], invalid: [] }
  }

  const users = buildSalespersonEntriesFromTokens(parsed)

  return {
    users,
    invalid: parsed.invalid
  }
}

export function registerSalespeopleHandler(bot) {
  bot.action('view_salespeople', async (ctx) => {
    try {
      await ctx.answerCbQuery()
    } catch (e) {
      console.error('[view_salespeople][answerCbQuery]', e)
    }

    try {
      const { users } = await loadSalespeople()
      await ctx.reply(buildSalespersonListText(users))
    } catch (e) {
      console.error('[view_salespeople][error]', e)
      await ctx.reply('❌ 获取业务员列表失败，请稍后重试').catch(() => {})
    }
  })

  bot.hears(/^设置业务员(?:\s+(.+))?$/i, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      return ctx.reply('❌ 请在私聊中设置业务员')
    }

    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) {
      return ctx.reply('⚠️ 您不在白名单中，无法设置业务员')
    }

    const rawInput = (ctx.match?.[1] || '').trim()
    if (!rawInput) {
      const { users } = await loadSalespeople()
      const current = buildSalespersonListText(users)
      return ctx.reply(
        `${current}\n\n` +
        `请发送：设置业务员 @用户名1 @用户名2\n` +
        `也支持：设置业务员 123456789 987654321`
      )
    }

    const updatedBy = String(ctx.from?.id || '')

    try {
      const { users, invalid } = await resolveSalespeopleFromInput(rawInput)

      if (invalid.length > 0) {
        return ctx.reply(`❌ 以下输入格式无效：${invalid.join('、')}`)
      }

      if (users.length === 0) {
        return ctx.reply('❌ 未匹配到有效业务员，请检查输入')
      }

      await saveSalespeople(users, updatedBy)

      await ctx.reply(`✅ 业务员已更新，共 ${users.length} 人\n\n${buildSalespersonListText(users)}`)
    } catch (e) {
      console.error('[设置业务员][error]', e)
      await ctx.reply('❌ 设置业务员失败，请稍后重试')
    }
  })

  bot.hears(/^删除业务员(?:\s+(.+))?$/i, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      return ctx.reply('❌ 请在私聊中删除业务员')
    }

    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) {
      return ctx.reply('⚠️ 您不在白名单中，无法删除业务员')
    }

    const rawInput = (ctx.match?.[1] || '').trim()
    if (!rawInput) {
      return ctx.reply('❌ 请输入要删除的业务员，例如：删除业务员 @用户名 或 删除业务员 123456789')
    }

    try {
      const [current, matched] = await Promise.all([
        loadSalespeople(),
        resolveSalespeopleFromInput(rawInput)
      ])

      if (matched.invalid.length > 0) {
        return ctx.reply(`❌ 以下输入格式无效：${matched.invalid.join('、')}`)
      }

      if (matched.users.length === 0) {
        return ctx.reply('❌ 未匹配到有效业务员，请检查输入')
      }

      const removeIdSet = new Set(matched.users.map(user => String(user.userId || '').trim()).filter(Boolean))
      const removeUsernameSet = new Set(matched.users.map(user => String(user.username || '').trim().toLowerCase()).filter(Boolean))
      const nextEntries = current.entries.filter(entry => {
        const userId = String(entry.userId || '').trim()
        const username = String(entry.username || '').trim().toLowerCase()
        if (userId && removeIdSet.has(userId)) return false
        if (username && removeUsernameSet.has(username)) return false
        return true
      })
      if (nextEntries.length === current.entries.length) {
        return ctx.reply('⚠️ 指定用户不在当前业务员列表中')
      }

      const updatedBy = String(ctx.from?.id || '')
      await saveSalespeople(nextEntries, updatedBy)

      const after = await loadSalespeople()
      await ctx.reply(`✅ 已删除业务员，当前共 ${after.entries.length} 人\n\n${buildSalespersonListText(after.users)}`)
    } catch (e) {
      console.error('[删除业务员][error]', e)
      await ctx.reply('❌ 删除业务员失败，请稍后重试')
    }
  })

  bot.hears(/^清空业务员$/i, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      return ctx.reply('❌ 请在私聊中清空业务员')
    }

    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) {
      return ctx.reply('⚠️ 您不在白名单中，无法清空业务员')
    }

    try {
      const updatedBy = String(ctx.from?.id || '')
      await saveSalespeople([], updatedBy)
      await ctx.reply('✅ 已清空业务员列表')
    } catch (e) {
      console.error('[清空业务员][error]', e)
      await ctx.reply('❌ 清空业务员失败，请稍后重试')
    }
  })

  bot.hears(/^设置业务员展示(?:\s+(.+))?$/i, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      return ctx.reply('❌ 请在私聊中设置业务员展示')
    }

    const isWhitelisted = await hasWhitelistOnlyPermission(ctx)
    if (!isWhitelisted) {
      return ctx.reply('⚠️ 您不在白名单中，无法设置业务员展示')
    }

    const rawInput = (ctx.match?.[1] || '').trim()
    if (!rawInput) {
      try {
        const visible = await loadSalespeopleGroupButtonVisible()
        return ctx.reply(
          `当前群内“查看业务员”按钮状态：${visible ? '开启' : '关闭'}\n` +
          '请发送：设置业务员展示 开 或 设置业务员展示 关'
        )
      } catch (e) {
        console.error('[设置业务员展示][query][error]', e)
        return ctx.reply('❌ 读取业务员展示状态失败，请稍后重试')
      }
    }

    const visible = parseSalespeopleGroupButtonValue(rawInput, null)
    if (visible == null) {
      return ctx.reply('❌ 仅支持：开/关、显示/隐藏、on/off、true/false、1/0')
    }

    try {
      const updatedBy = String(ctx.from?.id || '')
      await saveSalespeopleGroupButtonVisible(visible, updatedBy)
      await ctx.reply(`✅ 已${visible ? '开启' : '关闭'}群内“查看业务员”按钮`)
    } catch (e) {
      console.error('[设置业务员展示][error]', e)
      await ctx.reply('❌ 设置业务员展示失败，请稍后重试')
    }
  })

  bot.hears(/^查看业务员(?:设置)?$/i, async (ctx) => {
    try {
      const { users } = await loadSalespeople()
      await ctx.reply(buildSalespersonListText(users))
    } catch (e) {
      console.error('[查看业务员][error]', e)
      await ctx.reply('❌ 获取业务员列表失败，请稍后重试').catch(() => {})
    }
  })
}
