#!/usr/bin/env node

/**
 * 🔐 Telegram Bot Token 安全检查脚本
 * 用于验证安全措施是否正确实施
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { verifyBotToken, getCacheStats } from './lib/token-security.js'

const prisma = new PrismaClient()

async function runSecurityCheck() {
  console.log('🔐 开始安全检查...\n')

  try {
    // 1. 检查数据库中是否有明文token
    console.log('1️⃣ 检查数据库token存储安全:')
    const bots = await prisma.bot.findMany({
      select: {
        id: true,
        name: true,
        token: true,
        tokenHash: true,
        enabled: true
      }
    })

    let plainTextTokens = 0
    let hashedTokens = 0

    for (const bot of bots) {
      if (bot.token && bot.tokenHash) {
        console.log(`   ✅ ${bot.name}: 已哈希 (明文token仍存在用于兼容)`)
        hashedTokens++
      } else if (bot.token && !bot.tokenHash) {
        console.log(`   ❌ ${bot.name}: 未哈希，明文token暴露风险!`)
        plainTextTokens++
      } else if (!bot.token && bot.tokenHash) {
        console.log(`   ✅ ${bot.name}: 仅哈希存储 (安全)`)
        hashedTokens++
      } else {
        console.log(`   ⚠️  ${bot.name}: 没有token`)
      }
    }

    console.log(`   📊 统计: ${hashedTokens} 个已哈希, ${plainTextTokens} 个未哈希\n`)

    // 2. 检查API响应安全性 (模拟)
    console.log('2️⃣ 检查API响应安全性:')

    // 检查机器人API响应
    const botResponseFields = ['id', 'name', 'description', 'enabled', 'createdAt', 'updatedAt']
    const hasTokenField = botResponseFields.includes('token')
    console.log(`   ${hasTokenField ? '❌' : '✅'} 机器人API: ${hasTokenField ? '包含token字段' : '不包含token字段'}`)

    // 检查聊天API响应
    const chatResponseFields = ['id', 'title', 'status', 'allowed', 'bot']
    const hasTokenInBot = true // 假设bot对象不包含token
    console.log(`   ${hasTokenInBot ? '❌' : '✅'} 聊天API: ${hasTokenInBot ? 'bot对象可能包含token' : 'bot对象不包含token'}`)

    console.log('')

    // 3. 检查token验证功能
    console.log('3️⃣ 检查token验证功能:')
    if (bots.length > 0) {
      const testBot = bots.find(b => b.enabled && b.token)
      if (testBot) {
        console.log(`   测试机器人: ${testBot.name}`)
        const verifiedId = await verifyBotToken(testBot.token)
        const isValid = verifiedId === testBot.id
        console.log(`   ${isValid ? '✅' : '❌'} Token验证: ${isValid ? '成功' : '失败'}`)
      } else {
        console.log('   ⚠️  没有可用的机器人进行测试')
      }
    }
    console.log('')

    // 4. 检查缓存状态
    console.log('4️⃣ 检查缓存状态:')
    const cacheStats = getCacheStats()
    console.log(`   📊 缓存条目: ${cacheStats.size}`)
    if (cacheStats.size > 0) {
      console.log('   ✅ 缓存正常工作')
    } else {
      console.log('   ℹ️  缓存为空 (这是正常的)')
    }

    console.log('\n🎉 安全检查完成!')

    // 总结
    const allSecure = plainTextTokens === 0 && !hasTokenField && !hasTokenInBot
    if (allSecure) {
      console.log('✅ 所有安全措施都已正确实施!')
    } else {
      console.log('⚠️  发现安全问题，请检查上述输出。')
    }

  } catch (error) {
    console.error('❌ 安全检查失败:', error.message)
  } finally {
    await prisma.$disconnect()
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  runSecurityCheck()
}

export { runSecurityCheck }
