#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

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

// 启动standalone服务器
const serverPath = path.join(__dirname, '..', '.next', 'standalone', 'server.js');
const child = spawn('node', [serverPath, ...args], {
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
