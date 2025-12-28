import 'dotenv/config'
import bcrypt from 'bcrypt'

async function testBasic() {
  try {
    console.log('🧪 基本功能测试...')

    // 测试bcrypt
    const testToken = '123456789:test_token'
    console.log('🔄 测试bcrypt哈希...')
    const hashed = await bcrypt.hash(testToken, 12)
    console.log('✅ bcrypt哈希成功，长度:', hashed.length)

    // 测试Prisma
    console.log('🗄️ 测试Prisma导入...')
    const { PrismaClient } = await import('@prisma/client')
    console.log('✅ Prisma导入成功')

    const prisma = new PrismaClient()

    console.log('🔗 测试数据库连接...')
    await prisma.$connect()
    console.log('✅ 数据库连接成功')

    const bots = await prisma.bot.findMany({
      select: { id: true, name: true, enabled: true },
      take: 5
    })

    console.log(`✅ 查询成功，找到 ${bots.length} 个机器人`)

    if (bots.length > 0) {
      console.log('🤖 机器人列表:')
      bots.forEach(bot => {
        console.log(`  - ${bot.name} (${bot.enabled ? '启用' : '禁用'})`)
      })
    }

    await prisma.$disconnect()
    console.log('🎉 基本测试通过！')

  } catch (error) {
    console.error('❌ 测试失败:', error.message)
    if (error.code) {
      console.error('❌ 错误代码:', error.code)
    }
  }
}

testBasic()
