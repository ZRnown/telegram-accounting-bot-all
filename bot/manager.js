import 'dotenv/config'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import dotenv from 'dotenv'
import { prisma } from '../lib/db.js'
import logger from './logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Fallback: if DATABASE_URL not set by .env, try config/env
if (!process.env.DATABASE_URL) {
  const configEnvPath = path.resolve(__dirname, '../config/env')
  if (fs.existsSync(configEnvPath)) {
    dotenv.config({ path: configEnvPath })
  }
}

logger.initLogger({ dir: 'logs', level: process.env.DEBUG_BOT === 'true' ? 'debug' : 'info', stdout: true })
logger.hijackConsole()
console.log('[manager] DATABASE_URL=', process.env.DATABASE_URL)

const children = new Map() // botId -> ChildProcess

function startBotProcess(bot) {
  if (children.has(bot.id)) return
  const env = { ...process.env, BOT_TOKEN: bot.token }
  if (bot.proxyUrl) env.PROXY_URL = bot.proxyUrl
  const child = spawn('node', [path.resolve(__dirname, './index.js')], {
    stdio: 'inherit',
    env,
  })
  children.set(bot.id, child)
  child.on('exit', (code) => {
    children.delete(bot.id)
    console.log(`[bot:${bot.name}] 退出 code=${code}`)
  })
  console.log(`[bot:${bot.name}] 已启动`)
}

function stopBotProcess(botId) {
  const child = children.get(botId)
  if (child) {
    child.kill('SIGTERM')
    children.delete(botId)
  }
}

async function syncBotsOnce() {
  const bots = await prisma.bot.findMany({
    where: { enabled: true },
    select: {
      id: true,
      name: true,
      token: true, // 保留明文token用于启动机器人
      proxyUrl: true,
      enabled: true
    }
  })
  const running = new Set(children.keys())
  const shouldRun = new Set(bots.map(b => b.id))

  // start new ones
  for (const bot of bots) {
    if (!running.has(bot.id)) startBotProcess(bot)
  }
  // stop disabled/removed
  for (const id of running) {
    if (!shouldRun.has(id)) stopBotProcess(id)
  }
}

async function main() {
  await syncBotsOnce()
  // poll every 30s for changes
  setInterval(() => {
    syncBotsOnce().catch((e) => console.error('syncBotsOnce error', e))
  }, 30000)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
