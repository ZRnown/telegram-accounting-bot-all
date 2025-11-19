import fs from 'node:fs'
import path from 'node:path'

const levels = ['debug','info','warn','error']
let currentLevel = 'info'
let logsDir = path.resolve(process.cwd(), 'logs')
let stdoutEnabled = true
let currentDate = null
let currentStream = null

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
}

function openStreamForToday() {
  const today = new Date().toISOString().slice(0,10) // YYYY-MM-DD
  if (currentDate === today && currentStream) return
  // rotate
  try { if (currentStream) currentStream.end() } catch {}
  currentDate = today
  ensureDir(logsDir)
  const file = path.join(logsDir, `${today}.log`)
  currentStream = fs.createWriteStream(file, { flags: 'a' })
}

function writeLine(level, msg, meta) {
  try {
    openStreamForToday()
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, meta: meta || null }) + '\n'
    currentStream.write(line)
    if (stdoutEnabled) {
      // mirror to stdout/stderr by level
      if (level === 'error') {
        process.stderr.write(line)
      } else {
        process.stdout.write(line)
      }
    }
  } catch {}
}

function setLevel(lv) {
  if (levels.includes(lv)) currentLevel = lv
}

function shouldLog(lv) {
  return levels.indexOf(lv) >= levels.indexOf(currentLevel)
}

export function initLogger(options = {}) {
  if (options.dir) logsDir = path.resolve(process.cwd(), options.dir)
  if (options.level) setLevel(options.level)
  if (typeof options.stdout === 'boolean') stdoutEnabled = options.stdout
  // env overrides
  if (process.env.LOG_DIR) logsDir = path.resolve(process.cwd(), process.env.LOG_DIR)
  if (process.env.LOG_LEVEL) setLevel(process.env.LOG_LEVEL)
  if (process.env.LOG_STDOUT != null) stdoutEnabled = /^(1|true|yes)$/i.test(process.env.LOG_STDOUT)
  // prime stream
  openStreamForToday()
  // trap crashes
  process.on('uncaughtException', (e) => {
    error('uncaughtException', { message: e?.message, stack: e?.stack })
  })
  process.on('unhandledRejection', (e) => {
    error('unhandledRejection', { message: (e && e.message) || String(e) })
  })
}

export function rotateIfNeeded() {
  openStreamForToday()
}

export function debug(msg, meta) {
  if (shouldLog('debug')) writeLine('debug', msg, meta)
}
export function info(msg, meta) {
  if (shouldLog('info')) writeLine('info', msg, meta)
}
export function warn(msg, meta) {
  if (shouldLog('warn')) writeLine('warn', msg, meta)
}
export function error(msg, meta) {
  if (shouldLog('error')) writeLine('error', msg, meta)
}

export function hijackConsole() {
  const orig = { ...console }
  console.debug = (...args) => debug(args.map(String).join(' '))
  console.info = (...args) => info(args.map(String).join(' '))
  console.warn = (...args) => warn(args.map(String).join(' '))
  console.error = (...args) => error(args.map(String).join(' '))
  console.log = (...args) => info(args.map(String).join(' '))
  // return function to restore
  return () => {
    console.debug = orig.debug
    console.info = orig.info
    console.warn = orig.warn
    console.error = orig.error
    console.log = orig.log
  }
}

export default { initLogger, rotateIfNeeded, debug, info, warn, error, hijackConsole }
