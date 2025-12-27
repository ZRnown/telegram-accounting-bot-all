#!/usr/bin/env node

// SafeW平台兼容性测试脚本
const https = require('https')

const SAFEW_API_BASE = process.env.SAFEW_API_BASE || 'https://api.safew.org'
const BOT_TOKEN = process.env.BOT_TOKEN

if (!BOT_TOKEN) {
  console.error('❌ 请设置 BOT_TOKEN 环境变量')
  process.exit(1)
}

console.log('🧪 开始SafeW API兼容性测试...')
console.log(`📍 API端点: ${SAFW_API_BASE}`)
console.log(`🤖 Bot Token: ${BOT_TOKEN.substring(0, 10)}...`)

// 测试1: getMe
console.log('\n1️⃣ 测试 getMe...')
const getMeUrl = `${SAFW_API_BASE}/bot${BOT_TOKEN}/getMe`

https.get(getMeUrl, (res) => {
  let data = ''
  res.on('data', chunk => data += chunk)
  res.on('end', () => {
    try {
      const response = JSON.parse(data)
      if (response.ok) {
        console.log('✅ getMe 成功')
        console.log(`   机器人: ${response.result.first_name} (@${response.result.username})`)
      } else {
        console.log('❌ getMe 失败:', response.description)
      }
    } catch (e) {
      console.log('❌ getMe 响应解析失败:', e.message)
    }
  })
}).on('error', (e) => {
  console.log('❌ getMe 请求失败:', e.message)
})

// 测试2: getUpdates (检查轮询支持)
setTimeout(() => {
  console.log('\n2️⃣ 测试 getUpdates...')

  const getUpdatesUrl = `${SAFW_API_BASE}/bot${BOT_TOKEN}/getUpdates?limit=1`

  https.get(getUpdatesUrl, (res) => {
    let data = ''
    res.on('data', chunk => data += chunk)
    res.on('end', () => {
      try {
        const response = JSON.parse(data)
        if (response.ok) {
          console.log('✅ getUpdates 成功')
          console.log(`   更新数量: ${response.result.length}`)
        } else {
          console.log('❌ getUpdates 失败:', response.description)
        }
      } catch (e) {
        console.log('❌ getUpdates 响应解析失败:', e.message)
      }

      console.log('\n🎯 测试完成！')
      console.log('如果所有测试都通过，说明SafeW API兼容性良好。')
    })
  }).on('error', (e) => {
    console.log('❌ getUpdates 请求失败:', e.message)
  })
}, 2000)
