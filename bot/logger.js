import winston from 'winston'
import 'winston-daily-rotate-file'
import path from 'path'
import fs from 'fs'
const LOG_TO_FILE = process.env.LOG_TO_FILE === 'true'
const LOG_STDOUT = process.env.LOG_STDOUT !== 'false'
const LOG_DIR = process.env.LOG_DIR || 'logs'
const DEFAULT_LEVEL = process.env.LOG_LEVEL || (process.env.DEBUG_BOT === 'true' ? 'debug' : 'warn')

let loggerInstance = null

const initLogger = ({ dir = LOG_DIR, level = DEFAULT_LEVEL, stdout = LOG_STDOUT } = {}) => {
    if (loggerInstance) return loggerInstance

    // Ensure log directory exists
    if (LOG_TO_FILE) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        }
    }

    const transports = []

    // Console transport
    if (stdout) {
        transports.push(
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                    winston.format.printf(({ timestamp, level, message, ...meta }) => {
                        const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : ''
                        return `[${timestamp}] ${level}: ${message} ${metaStr}`
                    })
                ),
            })
        )
    }

    // File transport with rotation
    if (LOG_TO_FILE) {
        transports.push(
            new winston.transports.DailyRotateFile({
                filename: path.join(dir, 'application-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                zippedArchive: true,
                maxSize: '20m',
                maxFiles: '14d',
                level: level,
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.json()
                ),
            })
        )
    }

    // Error file transport
    if (LOG_TO_FILE) {
        transports.push(
            new winston.transports.DailyRotateFile({
                filename: path.join(dir, 'error-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                zippedArchive: true,
                maxSize: '20m',
                maxFiles: '30d',
                level: 'error',
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.json()
                ),
            })
        )
    }

    loggerInstance = winston.createLogger({
        level: level,
        transports: transports,
    })

    return loggerInstance
}

const hijackConsole = () => {
    if (!loggerInstance) return
    if (process.env.HIJACK_CONSOLE !== 'true') return

    const originalLog = console.log
    const originalError = console.error
    const originalWarn = console.warn
    const originalDebug = console.debug

    console.log = (...args) => {
        loggerInstance.info(args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' '))
    }

    console.error = (...args) => {
        loggerInstance.error(args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' '))
    }

    console.warn = (...args) => {
        loggerInstance.warn(args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' '))
    }

    console.debug = (...args) => {
        loggerInstance.debug(args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' '))
    }
}

// Proxy methods to the underlying winston instance
const proxyLogger = {
    initLogger,
    hijackConsole,
    info: (...args) => loggerInstance?.info(...args),
    warn: (...args) => loggerInstance?.warn(...args),
    error: (...args) => loggerInstance?.error(...args),
    debug: (...args) => loggerInstance?.debug(...args),
    log: (...args) => loggerInstance?.info(...args),
}

export default proxyLogger
