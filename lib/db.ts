import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'

// Ensure SQLite DB file exists BEFORE initializing Prisma
(() => {
  try {
    const dbUrl = process.env.DATABASE_URL || ''
    if (dbUrl.startsWith('file:')) {
      let p = dbUrl.slice(5)
      if (!p) return
      if (!p.startsWith('/')) p = path.resolve(process.cwd(), p)
      const dir = path.dirname(p)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      if (!fs.existsSync(p)) fs.closeSync(fs.openSync(p, 'a'))
    }
  } catch {}
})()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

