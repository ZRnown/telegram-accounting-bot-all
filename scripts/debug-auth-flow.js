#!/usr/bin/env node

// 认证流程调试脚本
console.log('🔍 认证流程调试');
console.log('================');

// 检查环境变量
console.log('\n📋 环境变量检查:');
console.log('NODE_ENV:', process.env.NODE_ENV || 'undefined');
console.log('COOKIE_SAME_SITE:', process.env.COOKIE_SAME_SITE || 'undefined');
console.log('FORCE_HTTPS:', process.env.FORCE_HTTPS || 'undefined');
console.log('TZ:', process.env.TZ || 'undefined');
console.log('DATABASE_URL:', process.env.DATABASE_URL || 'undefined');
console.log('ADMIN_SESSION_SECRET length:', process.env.ADMIN_SESSION_SECRET?.length || 0);
console.log('ADMIN_PWD_SALT length:', process.env.ADMIN_PWD_SALT?.length || 0);

// 检查数据库
console.log('\n💾 数据库状态:');
const dbPath = process.env.DATABASE_URL;
if (dbPath?.startsWith('file:')) {
  const fs = await import('fs');
  const path = await import('path');

  let dbFile = dbPath.slice(5);
  if (!dbFile.startsWith('/')) {
    dbFile = path.resolve(process.cwd(), dbFile);
  }

  console.log('数据库文件:', dbFile);
  console.log('文件存在:', fs.existsSync(dbFile));

  if (fs.existsSync(dbFile)) {
    const stats = fs.statSync(dbFile);
    console.log('文件大小:', stats.size, 'bytes');
    console.log('权限:', stats.mode.toString(8));
  }
}

// 检查时区
console.log('\n🕐 时区信息:');
console.log('TZ环境变量:', process.env.TZ);
console.log('当前时间:', new Date().toISOString());
console.log('本地时间:', new Date().toLocaleString());

// 模拟认证流程
console.log('\n🔐 认证流程模拟:');

const crypto = await import('crypto');

function getSecret() {
  const base = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PWD_SALT || 'session_secret_fallback';
  const rotate = process.env.ADMIN_SESSION_ROTATE || '';
  return `${base}:${rotate}`;
}

function createSession(username, ver = 0) {
  const payload = JSON.stringify({
    u: username,
    ver,
    iat: Date.now(),
    exp: Date.now() + 8 * 60 * 60 * 1000 // 8小时
  });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

const testSession = createSession('admin');
console.log('测试会话创建成功，长度:', testSession.length);
console.log('会话预览:', testSession.substring(0, 50) + '...');

// 检查可能的中间件冲突
console.log('\n🛡️ 中间件检查:');
const sensitivePaths = ['/api/auth', '/api/bots', '/api/chats', '/api/bills', '/api/admin', '/api/logs', '/dashboard', '/admin'];
console.log('敏感路径包含 /security:', sensitivePaths.some(p => '/security'.startsWith(p)));

console.log('\n✅ 调试完成');

console.log('\n💡 建议检查项:');
console.log('1. 浏览器开发者工具 -> Network -> 查看 /api/auth/me 请求');
console.log('2. 检查 Cookie 是否在请求中发送');
console.log('3. 查看服务器日志中的认证相关信息');
console.log('4. 确认环境变量已正确设置并重启应用');
