import 'dotenv/config'
import bcrypt from 'bcrypt'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function migrateTokens() {
  console.log('🔐 开始迁移机器人token到哈希存储...')

  try {
    // 获取所有机器人
    const bots = await prisma.bot.findMany({
      select: { id: true, name: true, token: true, tokenHash: true }
    })

    console.log(`📊 发现 ${bots.length} 个机器人`)

    for (const bot of bots) {
      if (bot.token && !bot.tokenHash) {
        console.log(`🔄 正在哈希机器人 ${bot.name} 的token...`)

        // 生成token哈希
        const saltRounds = 12
        const tokenHash = await bcrypt.hash(bot.token, saltRounds)

        // 更新数据库
        await prisma.bot.update({
          where: { id: bot.id },
          data: { tokenHash }
        })

        console.log(`✅ 机器人 ${bot.name} token已哈希完成`)
      } else if (bot.tokenHash) {
        console.log(`⏭️  机器人 ${bot.name} 已经哈希过了`)
      } else {
        console.log(`⚠️  机器人 ${bot.name} 没有token，跳过`)
      }
    }

    console.log('🎉 Token迁移完成！')

    // 验证哈希是否正确
    console.log('🔍 验证哈希正确性...')
    for (const bot of bots) {
      if (bot.token && bot.tokenHash) {
        const isValid = await bcrypt.compare(bot.token, bot.tokenHash)
        if (isValid) {
          console.log(`✅ 机器人 ${bot.name} 哈希验证通过`)
        } else {
          console.log(`❌ 机器人 ${bot.name} 哈希验证失败`)
        }
      }
    }

  } catch (error) {
    console.error('❌ 迁移失败:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// 验证token函数（用于生产环境）
export async function verifyToken(botId, plainToken) {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { tokenHash: true }
  })

  if (!bot?.tokenHash) {
    return false
  }

  return await bcrypt.compare(plainToken, bot.tokenHash)
}

// 获取token用于API调用（仅在需要时）
export async function getTokenForApi(botId) {
  // ⚠️  这个函数应该只在绝对需要的地方使用
  // 生产环境中应该移除明文token存储
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { token: true }
  })

  return bot?.token
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrateTokens()
}
