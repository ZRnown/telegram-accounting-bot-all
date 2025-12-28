#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
