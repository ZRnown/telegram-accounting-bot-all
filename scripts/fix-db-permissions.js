#!/usr/bin/env node

/**
 * 数据库权限修复脚本
 * 用于修复SQLite数据库的权限问题
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function getDbPath() {
  // 从环境变量获取数据库路径
  const dbUrl = process.env.DATABASE_URL
  if (dbUrl && dbUrl.startsWith('file:')) {
    return dbUrl.substring(5) // 移除 'file:' 前缀
  }

  // 默认路径
  return path.join(process.cwd(), 'data', 'app.db')
}

async function fixDatabasePermissions() {
  const dbPath = getDbPath()
  const dbDir = path.dirname(dbPath)

  console.log('🔍 检查数据库权限...')
  console.log(`📍 数据库路径: ${dbPath}`)
  console.log(`📁 数据库目录: ${dbDir}`)

  try {
    // 检查目录是否存在
    if (!fs.existsSync(dbDir)) {
      console.log('📁 创建数据库目录...')
      fs.mkdirSync(dbDir, { recursive: true })
    }

    // 检查目录权限
    const dirStats = fs.statSync(dbDir)
    const dirMode = dirStats.mode & parseInt('777', 8)
    console.log(`📁 目录权限: ${dirMode.toString(8)}`)

    // 检查数据库文件是否存在
    if (fs.existsSync(dbPath)) {
      const fileStats = fs.statSync(dbPath)
      const fileMode = fileStats.mode & parseInt('777', 8)
      console.log(`🗄️ 数据库文件权限: ${fileMode.toString(8)}`)

      // 检查是否为只读
      const isReadOnly = !(fileStats.mode & parseInt('200', 8)) // 检查写权限
      if (isReadOnly) {
        console.log('⚠️ 检测到数据库文件为只读，尝试修复...')

        // 尝试修改文件权限
        fs.chmodSync(dbPath, 0o666) // rw-rw-rw-
        console.log('✅ 数据库文件权限已修复为 666')
      } else {
        console.log('✅ 数据库文件权限正常')
      }
    } else {
      console.log('ℹ️ 数据库文件不存在，将在首次运行时创建')
    }

    // 检查目录写权限
    try {
      const testFile = path.join(dbDir, '.permission_test')
      fs.writeFileSync(testFile, 'test')
      fs.unlinkSync(testFile)
      console.log('✅ 目录写权限正常')
    } catch (error) {
      console.log('❌ 目录写权限不足，尝试修复...')
      fs.chmodSync(dbDir, 0o755) // rwxr-xr-x
      console.log('✅ 目录权限已修复为 755')
    }

    // 检查环境变量
    console.log('🔧 环境变量检查:')
    console.log(`DATABASE_URL: ${process.env.DATABASE_URL ? '已设置' : '未设置'}`)

    console.log('\n🎉 数据库权限检查完成！')

  } catch (error) {
    console.error('❌ 权限修复失败:', error.message)
    process.exit(1)
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  fixDatabasePermissions()
}
