console.log('Starting test...')

// 同步检查
try {
  const fs = require('fs')
  const path = require('path')

  const helpersPath = path.join(__dirname, 'bot', 'helpers.js')
  const content = fs.readFileSync(helpersPath, 'utf8')

  if (content.includes('export async function hasAdminPermission')) {
    console.log('✅ hasAdminPermission function found in helpers.js')
  } else {
    console.log('❌ hasAdminPermission function NOT found in helpers.js')
  }

  if (content.includes('export async function isAdmin')) {
    console.log('✅ isAdmin function found in helpers.js')
  } else {
    console.log('❌ isAdmin function NOT found in helpers.js')
  }

} catch (e) {
  console.error('Error reading file:', e.message)
}

console.log('Test completed.')
