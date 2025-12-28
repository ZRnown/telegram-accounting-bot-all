import 'dotenv/config'

async function verifyDB() {
  try {
    console.log('🔍 验证数据库结构和数据...')

    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()

    // 检查机器人表结构
    console.log('🤖 检查机器人表...')
    const bots = await prisma.bot.findMany({
      select: {
        id: true,
        name: true,
        token: true,
        tokenHash: true,
        enabled: true
      },
      take: 3
    })

    console.log(`✅ 找到 ${bots.length} 个机器人`)

    if (bots.length > 0) {
      bots.forEach((bot, i) => {
        console.log(`  ${i + 1}. ${bot.name}: token=${!!bot.token}, tokenHash=${!!bot.tokenHash}, enabled=${bot.enabled}`)
      })

      // 测试token验证
      if (bots[0].token) {
        console.log('🔐 测试token验证...')
        const { verifyBotToken } = await import('./lib/token-security.js')
        const result = await verifyBotToken(bots[0].token)
        console.log(`🔐 Token验证结果: ${result === bots[0].id ? '✅ 成功' : '❌ 失败'}`)
      }
    }

    // 检查其他表
    console.log('📊 检查其他表...')
    const chatCount = await prisma.chat.count()
    const settingCount = await prisma.setting.count()
    const billCount = await prisma.bill.count()

    console.log(`📊 统计: ${chatCount} 个群组, ${settingCount} 个设置, ${billCount} 个账单`)

    await prisma.$disconnect()
    console.log('🎉 数据库验证完成！')

  } catch (error) {
    console.error('❌ 验证失败:', error.message)
    process.exit(1)
  }
}

verifyDB()
