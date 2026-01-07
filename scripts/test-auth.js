#!/usr/bin/env node

// 测试认证系统
// 使用 Node.js 内置 fetch (18+)

const BASE_URL = process.env.BASE_URL || 'http://localhost:32156';

console.log('🔍 认证系统测试');
console.log('================');
console.log('目标URL:', BASE_URL);

async function testLogin() {
  console.log('\n1️⃣ 测试登录...');

  try {
    const response = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TestScript/1.0'
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin123'
      })
    });

    console.log('登录响应状态:', response.status);
    console.log('登录响应头:');
    response.headers.forEach((value, key) => {
      if (key.toLowerCase().includes('cookie') || key.toLowerCase().includes('set-cookie')) {
        console.log('  ', key + ':', value);
      }
    });

    const data = await response.json();
    console.log('登录响应数据:', data);

    // 获取session cookie
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const cookieMatch = setCookie.match(/adm_sess=([^;]+)/);
      if (cookieMatch) {
        return cookieMatch[1];
      }
    }

    return null;
  } catch (error) {
    console.error('登录测试失败:', error.message);
    return null;
  }
}

async function testAuthMe(sessionCookie) {
  console.log('\n2️⃣ 测试 /api/auth/me...');

  try {
    const response = await fetch(`${BASE_URL}/api/auth/me`, {
      method: 'GET',
      headers: {
        'Cookie': `adm_sess=${sessionCookie}`,
        'User-Agent': 'TestScript/1.0'
      }
    });

    console.log('/auth/me 响应状态:', response.status);
    const data = await response.json();
    console.log('/auth/me 响应数据:', data);

    return response.status === 200;
  } catch (error) {
    console.error('/auth/me 测试失败:', error.message);
    return false;
  }
}

async function testChangePassword(sessionCookie) {
  console.log('\n3️⃣ 测试修改密码...');

  try {
    const response = await fetch(`${BASE_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `adm_sess=${sessionCookie}`,
        'User-Agent': 'TestScript/1.0'
      },
      body: JSON.stringify({
        username: 'admin',
        oldPassword: 'admin123',
        newPassword: 'newpassword123'
      })
    });

    console.log('修改密码响应状态:', response.status);
    const data = await response.text();
    console.log('修改密码响应数据:', data);

    return response.status === 204;
  } catch (error) {
    console.error('修改密码测试失败:', error.message);
    return false;
  }
}

async function runTests() {
  // 测试登录
  const sessionCookie = await testLogin();
  if (!sessionCookie) {
    console.log('\n❌ 登录测试失败，无法继续测试');
    return;
  }

  console.log('\n✅ 登录成功，获取到Session Cookie');

  // 测试认证检查
  const authWorks = await testAuthMe(sessionCookie);
  if (!authWorks) {
    console.log('\n❌ 认证检查失败');
  } else {
    console.log('\n✅ 认证检查成功');
  }

  // 测试修改密码
  const passwordChanged = await testChangePassword(sessionCookie);
  if (!passwordChanged) {
    console.log('\n❌ 修改密码失败');
  } else {
    console.log('\n✅ 修改密码成功');
  }

  console.log('\n🎯 测试完成');
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests };
