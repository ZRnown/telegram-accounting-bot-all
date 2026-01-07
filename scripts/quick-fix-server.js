#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔧 服务器快速修复');
console.log('=================');

// 1. 修复数据库权限
function fixDatabasePermissions() {
  console.log('\n1️⃣ 修复数据库权限...');

  const dbPath = process.env.DATABASE_URL || 'file:./data/app.db';
  if (dbPath.startsWith('file:')) {
    let dbFile = dbPath.slice(5);
    if (!dbFile.startsWith('/')) {
      dbFile = path.resolve(process.cwd(), dbFile);
    }

    try {
      const dbDir = path.dirname(dbFile);

      // 确保目录存在
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        console.log('   📂 创建目录:', dbDir);
      }

      // 确保文件存在
      if (!fs.existsSync(dbFile)) {
        fs.closeSync(fs.openSync(dbFile, 'w'));
        console.log('   📄 创建文件:', dbFile);
      }

      // 设置权限
      try {
        fs.chmodSync(dbDir, 0o755);
        fs.chmodSync(dbFile, 0o644);
        console.log('   ✅ 权限设置完成');
      } catch (permErr) {
        console.log('   ⚠️ 权限设置失败（可能需要sudo）:', permErr.message);
      }

      // 测试写入
      try {
        const testData = 'test_' + Date.now();
        fs.appendFileSync(dbFile, testData);
        const stats = fs.statSync(dbFile);
        fs.truncateSync(dbFile, stats.size - testData.length);
        console.log('   ✅ 写入测试成功');
      } catch (writeErr) {
        console.log('   ❌ 写入测试失败:', writeErr.message);
        console.log('   🔧 手动修复命令:');
        console.log('      sudo chmod 644', dbFile);
        console.log('      sudo chmod 755', dbDir);
        console.log('      sudo chown', process.env.USER || 'www-data', dbFile);
        console.log('      sudo chown', process.env.USER || 'www-data', dbDir);
      }

    } catch (error) {
      console.log('   ❌ 数据库修复失败:', error.message);
    }
  }
}

// 2. 检查时区设置
function checkTimezone() {
  console.log('\n2️⃣ 检查时区设置...');

  const tz = process.env.TZ;
  if (!tz) {
    console.log('   ⚠️  未设置TZ环境变量，建议设置:');
    console.log('   export TZ=Asia/Shanghai');
  } else {
    console.log('   ✅ TZ设置:', tz);
  }

  console.log('   当前时间:', new Date().toISOString());
  console.log('   本地时间:', new Date().toLocaleString());
}

// 3. 检查环境变量
function checkEnvironment() {
  console.log('\n3️⃣ 检查环境变量...');

  const required = ['DATABASE_URL', 'ADMIN_SESSION_SECRET'];
  const optional = ['NODE_ENV', 'TZ', 'BOT_TOKEN'];

  required.forEach(key => {
    if (process.env[key]) {
      console.log('   ✅', key + ':', key.includes('SECRET') || key.includes('TOKEN') ?
        '[已设置]' : process.env[key]);
    } else {
      console.log('   ❌', key + ': 未设置');
    }
  });

  optional.forEach(key => {
    if (process.env[key]) {
      console.log('   ℹ️ ', key + ':', key.includes('SECRET') || key.includes('TOKEN') ?
        '[已设置]' : process.env[key]);
    }
  });
}

// 4. 清理可能的锁文件
function cleanupLocks() {
  console.log('\n4️⃣ 清理可能的锁文件...');

  const dbPath = process.env.DATABASE_URL || 'file:./data/app.db';
  if (dbPath.startsWith('file:')) {
    let dbFile = dbPath.slice(5);
    if (!dbFile.startsWith('/')) {
      dbFile = path.resolve(process.cwd(), dbFile);
    }

    const lockFile = dbFile + '-lock';
    const walFile = dbFile + '-wal';
    const shmFile = dbFile + '-shm';

    [lockFile, walFile, shmFile].forEach(file => {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
          console.log('   🗑️ 删除锁文件:', file);
        } catch (err) {
          console.log('   ⚠️ 无法删除锁文件:', file, err.message);
        }
      }
    });
  }
}

// 执行修复
fixDatabasePermissions();
checkTimezone();
checkEnvironment();
cleanupLocks();

console.log('\n✅ 快速修复完成');
console.log('🔄 请重启应用程序测试修改密码功能');
