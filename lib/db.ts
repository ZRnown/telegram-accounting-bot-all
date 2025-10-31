import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'

// 🔥 确保数据库文件在 Prisma 初始化之前存在
function ensureDatabase() {
  try {
    const dbUrl = process.env.DATABASE_URL || 'file:./prisma/data/app.db'
    
    if (dbUrl.startsWith('file:')) {
      let dbPath = dbUrl.slice(5) // 移除 'file:' 前缀
      
      // 如果是相对路径，转为绝对路径
      if (!dbPath.startsWith('/')) {
        dbPath = path.resolve(process.cwd(), dbPath)
      }
      
      const dir = path.dirname(dbPath)
      
      // 确保目录存在
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
        console.log('[lib/db] ✅ 创建数据库目录:', dir)
      }
      
      // 确保数据库文件存在
      if (!fs.existsSync(dbPath)) {
        fs.closeSync(fs.openSync(dbPath, 'a'))
        console.log('[lib/db] ✅ 创建数据库文件:', dbPath)
      }
      
      console.log('[lib/db] ✅ 数据库路径:', dbPath)
    }
  } catch (error) {
    console.error('[lib/db] ❌ 数据库初始化错误:', error)
  }
}

// 执行数据库初始化
ensureDatabase()

// 🔥 定义全局 Prisma 类型
declare global {
  var prisma: PrismaClient | undefined
}

// 🔥 创建 Prisma Client 实例
let prismaInstance: PrismaClient

if (process.env.NODE_ENV === 'production') {
  // 生产环境：每次都创建新实例
  prismaInstance = new PrismaClient({
    log: process.env.DEBUG_PRISMA === 'true' ? ['query', 'error', 'warn'] : ['error'],
  })
  console.log('[lib/db] ✅ Prisma Client 已初始化 (生产环境)')
} else {
  // 开发环境：使用全局单例
  if (!global.prisma) {
    global.prisma = new PrismaClient({
      log: ['query', 'error', 'warn'],
    })
    console.log('[lib/db] ✅ Prisma Client 已初始化 (开发环境)')
  }
  prismaInstance = global.prisma
}

// 🔥 导出 prisma 实例
export const prisma = prismaInstance

// 🔥 验证导出成功
if (!prisma) {
  console.error('[lib/db] ❌ 严重错误: prisma 实例为 undefined!')
  throw new Error('Prisma Client 初始化失败')
}

// 🔥 添加连接测试（仅在首次导入时执行）
if (typeof window === 'undefined') {
  prisma.$connect()
    .then(() => {
      console.log('[lib/db] ✅ Prisma Client 已连接到数据库')
    })
    .catch((error: any) => {
      console.error('[lib/db] ❌ Prisma Client 连接失败:', error)
    })
}

