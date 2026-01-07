#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 修复数据库权限
function fixDatabasePermissions() {
  const dbPath = process.env.DATABASE_URL || 'file:./data/app.db';
  if (dbPath.startsWith('file:')) {
    let dbFile = dbPath.slice(5);
    if (!dbFile.startsWith('/')) {
      dbFile = join(process.cwd(), dbFile);
    }

    try {
      // 确保数据库目录存在
      const dbDir = dirname(dbFile);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // 确保数据库文件存在并有写入权限
      if (!fs.existsSync(dbFile)) {
        // 创建空文件
        fs.closeSync(fs.openSync(dbFile, 'w'));
      }

      // 设置正确的权限 (644 for file, 755 for directory)
      fs.chmodSync(dbFile, 0o644);
      fs.chmodSync(dbDir, 0o755);

      console.log('✅ 数据库权限已修复');
    } catch (error) {
      console.error('❌ 修复数据库权限失败:', error.message);
    }
  }
}

// 解析命令行参数
const args = process.argv.slice(2);
let port = process.env.PORT || '3000';

// 支持 -p 或 --port 参数
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '-p' || args[i] === '--port') && args[i + 1]) {
    port = args[i + 1];
    args.splice(i, 2); // 移除已处理的端口参数
    break;
  }
}

// 修复数据库权限
fixDatabasePermissions();

// 设置环境变量
process.env.PORT = port;

// 启动Next.js服务器（普通模式）
const child = spawn('npx', ['next', 'start', '--port', port, ...args], {
  stdio: 'inherit',
  env: process.env
});

child.on('close', (code) => {
  process.exit(code);
});

child.on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
