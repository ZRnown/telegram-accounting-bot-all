import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
const DEBUG_DB = process.env.DEBUG_DB === 'true';
// 🔥 确保数据库文件在 Prisma 初始化之前存在
function ensureDatabase() {
    try {
        const dbUrl = process.env.DATABASE_URL || 'file:./prisma/data/app.db';
        if (dbUrl.startsWith('file:')) {
            let dbPath = dbUrl.slice(5); // 移除 'file:' 前缀
            // 如果是相对路径，转为绝对路径
            if (!dbPath.startsWith('/')) {
                dbPath = path.resolve(process.cwd(), dbPath);
            }
            const dir = path.dirname(dbPath);
            // 确保目录存在
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                if (DEBUG_DB)
                    console.log('[lib/db] ✅ 创建数据库目录:', dir);
            }
            // 确保数据库文件存在
            if (!fs.existsSync(dbPath)) {
                fs.closeSync(fs.openSync(dbPath, 'a'));
                if (DEBUG_DB)
                    console.log('[lib/db] ✅ 创建数据库文件:', dbPath);
            }
            if (DEBUG_DB)
                console.log('[lib/db] ✅ 数据库路径:', dbPath);
        }
    }
    catch (error) {
        console.error('[lib/db] ❌ 数据库初始化错误:', error);
    }
}
// 执行数据库初始化
ensureDatabase();
// 🔥 创建 Prisma Client 实例
let prismaInstance;
// 🔥 统一日志配置：只在 DEBUG_PRISMA=true 时输出查询日志
// 说明：Prisma v6 的 LogLevel 类型位置较深，这里直接使用 any 简化类型
const prismaLogConfig = process.env.DEBUG_PRISMA === 'true'
    ? ['query', 'error', 'warn']
    : ['error']; // 仅输出错误日志
if (process.env.NODE_ENV === 'production') {
    // 生产环境：每次都创建新实例
    prismaInstance = new PrismaClient({
        log: prismaLogConfig,
    });
    if (DEBUG_DB)
        console.log('[lib/db] ✅ Prisma Client 已初始化 (生产环境)');
}
else {
    // 开发环境：使用全局单例
    if (!global.prisma) {
        global.prisma = new PrismaClient({
            log: prismaLogConfig, // 🔥 默认不输出查询日志
        });
        if (DEBUG_DB)
            console.log('[lib/db] ✅ Prisma Client 已初始化 (开发环境)');
    }
    prismaInstance = global.prisma;
}
// 🔥 导出 prisma 实例
export const prisma = prismaInstance;
// 🔥 验证导出成功
if (!prisma) {
    console.error('[lib/db] ❌ 严重错误: prisma 实例为 undefined!');
    throw new Error('Prisma Client 初始化失败');
}
// 🔥 添加连接测试（仅在首次导入时执行）
if (typeof window === 'undefined') {
    prisma.$connect()
        .then(() => {
        if (DEBUG_DB)
            console.log('[lib/db] ✅ Prisma Client 已连接到数据库');
    })
        .catch((error) => {
        console.error('[lib/db] ❌ Prisma Client 连接失败:', error);
    });
}
