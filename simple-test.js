// 最简单的测试
console.log('Starting simple test...')

try {
  console.log('Importing dotenv...')
  await import('dotenv/config')
  console.log('Dotenv imported successfully')

  console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Set' : 'Not set')
  console.log('BOT_TOKEN length:', process.env.BOT_TOKEN ? process.env.BOT_TOKEN.length : 'Not set')

  console.log('Test completed successfully')
} catch (error) {
  console.error('Error:', error.message)
  process.exit(1)
}
