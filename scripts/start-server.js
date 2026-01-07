#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// 🔥 强制加载环境变量
function loadEnvironmentVariables() {
  console.log('🔧 强制加载环境变量...');

  const envPath = join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    console.log('📄 发现 .env 文件:', envPath);

    try {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const lines = envContent.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').replace(/^["']|["']$/g, ''); // 移除引号
            process.env[key.trim()] = value.trim();
            console.log(`✅ 设置环境变量: ${key.trim()}=${value.substring(0, 20)}${value.length > 20 ? '...' : ''}`);
          }
        }
      }

      console.log('✅ 环境变量加载完成');
    } catch (error) {
      console.error('❌ 读取 .env 文件失败:', error.message);
    }
  } else {
    console.warn('⚠️ 未找到 .env 文件，使用默认配置');
  }

  // 🔥 确保关键环境变量存在
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  process.env.TZ = process.env.TZ || 'Asia/Shanghai';
  process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'dev-admin-session-secret-key-for-development-only-change-in-production';
  process.env.ADMIN_PWD_SALT = process.env.ADMIN_PWD_SALT || 'dev-admin-salt';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./data/app.db';
  process.env.COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE || 'lax';

  console.log('🔧 确保关键环境变量存在');
  console.log('   NODE_ENV:', process.env.NODE_ENV);
  console.log('   TZ:', process.env.TZ);
  console.log('   ADMIN_SESSION_SECRET length:', process.env.ADMIN_SESSION_SECRET.length);
  console.log('   DATABASE_URL:', process.env.DATABASE_URL);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 强制加载环境变量
loadEnvironmentVariables();

// 修复数据库权限
function fixDatabasePermissions() {
  const dbPath = process.env.DATABASE_URL || 'file:./data/app.db';
  console.log('🔧 检查数据库路径:', dbPath);

  if (dbPath.startsWith('file:')) {
    let dbFile = dbPath.slice(5);
    if (!dbFile.startsWith('/')) {
      dbFile = join(process.cwd(), dbFile);
    }

    console.log('📁 数据库文件路径:', dbFile);

    try {
      // 确保数据库目录存在
      const dbDir = dirname(dbFile);
      console.log('📂 数据库目录:', dbDir);

      if (!fs.existsSync(dbDir)) {
        console.log('📂 创建数据库目录...');
        fs.mkdirSync(dbDir, { recursive: true });
        console.log('📂 数据库目录创建成功');
      }

      // 检查目录权限
      try {
        fs.chmodSync(dbDir, 0o755);
        console.log('📂 数据库目录权限已设置: 755');
      } catch (dirPermErr) {
        console.warn('⚠️ 无法设置目录权限:', dirPermErr.message);
      }

      // 确保数据库文件存在
      if (!fs.existsSync(dbFile)) {
        console.log('📄 创建数据库文件...');
        fs.closeSync(fs.openSync(dbFile, 'w'));
        console.log('📄 数据库文件创建成功');
      }

      // 设置文件权限
      try {
        fs.chmodSync(dbFile, 0o644);
        console.log('📄 数据库文件权限已设置: 644');
      } catch (filePermErr) {
        console.warn('⚠️ 无法设置文件权限:', filePermErr.message);
      }

      // 测试写入权限
      try {
        const testData = 'test';
        fs.appendFileSync(dbFile, testData);
        // 移除测试数据
        const stats = fs.statSync(dbFile);
        fs.truncateSync(dbFile, stats.size - testData.length);
        console.log('✅ 数据库写入权限测试成功');
      } catch (writeErr) {
        console.error('❌ 数据库写入权限测试失败:', writeErr.message);
        console.error('🔧 请手动修复数据库权限:');
        console.error('   chmod 644', dbFile);
        console.error('   chmod 755', dbDir);
      }

      console.log('✅ 数据库权限检查完成');
    } catch (error) {
      console.error('❌ 数据库权限修复失败:', error.message);
      console.error('🔧 请手动检查数据库路径和权限');
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
