import { prisma } from '../../lib/db.js'
import {
  SALESPEOPLE_CONFIG_KEY,
  SALESPEOPLE_GROUP_BUTTON_CONFIG_KEY,
  buildSalespersonListText,
  parseSalespeopleGroupButtonValue,
  parseSalespersonConfigValue,
  parseSalespersonTokens
} from '../salespeople-utils.js'
import { hasWhitelistOnlyPermission } from '../helpers.js'

async function loadSalespeople() {
  const config = await prisma.globalConfig.findUnique({
    where: { key: SALESPEOPLE_CONFIG_KEY },
    select: { value: true }
  })

  const ids = parseSalespersonConfigValue(config?.value)
  if (ids.length === 0) {
    return { ids: [], users: [] }
  }

  const users = await prisma.whitelistedUser.findMany({
    where: { userId: { in: ids } },
    select: { userId: true, username: true, note: true }
  })

  const userMap = new Map(users.map(user => [String(user.userId), user]))
  const orderedUsers = ids.map(id => userMap.get(id)).filter(Boolean)
  return { ids, users: orderedUsers }
}

async function saveSalespeople(ids, updatedBy) {
  await prisma.globalConfig.upsert({
    where: { key: SALESPEOPLE_CONFIG_KEY },
    create: {
      key: SALESPEOPLE_CONFIG_KEY,
      value: JSON.stringify(ids),
      description: '业务员白名单用户ID列表',
      updatedBy
    },
    update: {
      value: JSON.stringify(ids),
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
    return { users: [], unresolved: [], invalid: [] }
  }

  const matchedById = parsed.userIds.length > 0
    ? await prisma.whitelistedUser.findMany({
      where: { userId: { in: parsed.userIds } },
      select: { userId: true, username: true, note: true }
    })
    : []

  const usersWithUsername = parsed.usernames.length > 0
    ? await prisma.whitelistedUser.findMany({
      where: { username: { not: null } },
      select: { userId: true, username: true, note: true }
    })
    : []

  const usernameMap = new Map()
  for (const user of usersWithUsername) {
    const key = String(user.username || '').toLowerCase().trim()
    if (!key || usernameMap.has(key)) continue
    usernameMap.set(key, user)
  }

  const unresolved = []
  const matchedIdSet = new Set(matchedById.map(user => String(user.userId)))
  for (const userId of parsed.userIds) {
    if (!matchedIdSet.has(userId)) unresolved.push(userId)
  }

  const matchedByUsername = []
  for (const username of parsed.usernames) {
    const user = usernameMap.get(username)
    if (!user) {
      unresolved.push(`@${username}`)
      continue
    }
    matchedByUsername.push(user)
  }

  const users = []
  const seen = new Set()
  for (const user of [...matchedById, ...matchedByUsername]) {
    const userId = String(user.userId)
    if (seen.has(userId)) continue
    seen.add(userId)
    users.push(user)
  }

  return {
    users,
    unresolved,
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
      const { users, unresolved, invalid } = await resolveSalespeopleFromInput(rawInput)

      if (invalid.length > 0) {
        return ctx.reply(`❌ 以下输入格式无效：${invalid.join('、')}`)
      }

      if (unresolved.length > 0) {
        return ctx.reply(`❌ 以下用户不在白名单：${unresolved.join('、')}`)
      }

      if (users.length === 0) {
        return ctx.reply('❌ 未匹配到有效业务员，请检查输入')
      }

      const ids = users.map(user => String(user.userId))
      await saveSalespeople(ids, updatedBy)

      await ctx.reply(`✅ 业务员已更新，共 ${ids.length} 人\n\n${buildSalespersonListText(users)}`)
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

      if (matched.unresolved.length > 0) {
        return ctx.reply(`❌ 以下用户不在白名单：${matched.unresolved.join('、')}`)
      }

      if (matched.users.length === 0) {
        return ctx.reply('❌ 未匹配到有效业务员，请检查输入')
      }

      const removeIdSet = new Set(matched.users.map(user => String(user.userId)))
      const nextIds = current.ids.filter(id => !removeIdSet.has(String(id)))
      if (nextIds.length === current.ids.length) {
        return ctx.reply('⚠️ 指定用户不在当前业务员列表中')
      }

      const updatedBy = String(ctx.from?.id || '')
      await saveSalespeople(nextIds, updatedBy)

      const after = await loadSalespeople()
      await ctx.reply(`✅ 已删除业务员，当前共 ${after.ids.length} 人\n\n${buildSalespersonListText(after.users)}`)
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
