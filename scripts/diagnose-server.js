#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 服务器环境诊断');
console.log('==================');

// 检查环境变量
console.log('\n📋 环境变量检查:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL:', process.env.DATABASE_URL);
console.log('TZ:', process.env.TZ || '未设置（使用系统默认时区）');

// 检查数据库
console.log('\n💾 数据库检查:');
const dbPath = process.env.DATABASE_URL || 'file:./data/app.db';
if (dbPath.startsWith('file:')) {
  let dbFile = dbPath.slice(5);
  if (!dbFile.startsWith('/')) {
    dbFile = path.resolve(process.cwd(), dbFile);
  }

  console.log('数据库文件路径:', dbFile);

  try {
    const dbDir = path.dirname(dbFile);
    console.log('数据库目录:', dbDir);
    console.log('目录存在:', fs.existsSync(dbDir));
    console.log('文件存在:', fs.existsSync(dbFile));

    if (fs.existsSync(dbFile)) {
      const stats = fs.statSync(dbFile);
      console.log('文件大小:', stats.size, 'bytes');
      console.log('文件权限:', stats.mode.toString(8));

      // 检查写入权限
      try {
        fs.accessSync(dbFile, fs.constants.W_OK);
        console.log('写入权限: ✅');
      } catch {
        console.log('写入权限: ❌');
      }

      // 检查读取权限
      try {
        fs.accessSync(dbFile, fs.constants.R_OK);
        console.log('读取权限: ✅');
      } catch {
        console.log('读取权限: ❌');
      }
    }
  } catch (error) {
    console.log('数据库检查失败:', error.message);
  }
}

// 检查时区和时间
console.log('\n🕐 时间和时区检查:');
console.log('当前时间:', new Date().toISOString());
console.log('本地时间:', new Date().toLocaleString());
console.log('时区偏移:', new Date().getTimezoneOffset(), '分钟');

// 检查进程用户
console.log('\n👤 进程信息:');
console.log('进程ID:', process.pid);
console.log('用户ID:', process.getuid?.() || 'N/A');
console.log('组ID:', process.getgid?.() || 'N/A');
console.log('工作目录:', process.cwd());

console.log('\n✅ 诊断完成');
