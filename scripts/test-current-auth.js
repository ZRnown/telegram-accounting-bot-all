#!/usr/bin/env node

// 当前认证状态测试脚本

// 🔥 强制加载环境变量（与启动脚本保持一致）
function loadEnvironmentVariables() {
  const fs = require('fs');
  const path = require('path');

  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          process.env[key.trim()] = value.trim();
        }
      }
    }
  }

  // 确保关键环境变量存在
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  process.env.TZ = process.env.TZ || 'Asia/Shanghai';
  process.env.ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'dev-admin-session-secret-key-for-development-only-change-in-production';
  process.env.ADMIN_PWD_SALT = process.env.ADMIN_PWD_SALT || 'dev-admin-salt';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./data/app.db';
  process.env.COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE || 'lax';
}

loadEnvironmentVariables();

const BASE_URL = process.env.BASE_URL || 'http://localhost:32156';

async function testServerStatus() {
  console.log('🔍 当前服务器认证状态测试');
  console.log('==============================');
  console.log('目标服务器:', BASE_URL);

  try {
    // 测试服务器是否响应
    console.log('\n1️⃣ 测试服务器连接...');
    const healthResponse = await fetch(`${BASE_URL}/api/auth/me`);
    console.log('服务器响应状态:', healthResponse.status);

    // 测试登录
    console.log('\n2️⃣ 测试登录...');
    const loginResponse = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin123'
      })
    });

    console.log('登录响应状态:', loginResponse.status);

    if (loginResponse.status === 200) {
      // 获取Cookie
      const setCookie = loginResponse.headers.get('set-cookie');
      if (setCookie) {
        const cookieMatch = setCookie.match(/adm_sess=([^;]+)/);
        if (cookieMatch) {
          const sessionCookie = cookieMatch[1];
          console.log('✅ 获取到Session Cookie');

          // 测试认证
          console.log('\n3️⃣ 测试认证状态...');
          const authResponse = await fetch(`${BASE_URL}/api/auth/me`, {
            headers: {
              'Cookie': `adm_sess=${sessionCookie}`
            }
          });

          console.log('认证响应状态:', authResponse.status);
          if (authResponse.status === 200) {
            console.log('✅ 认证成功');
          } else {
            console.log('❌ 认证失败');
            const errorText = await authResponse.text();
            console.log('错误详情:', errorText);
          }
        } else {
          console.log('❌ 无法解析Session Cookie');
        }
      } else {
        console.log('❌ 登录响应中没有Cookie');
      }
    } else {
      console.log('❌ 登录失败');
      const errorText = await loginResponse.text();
      console.log('登录错误:', errorText);
    }

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.log('\n💡 可能原因:');
    console.log('1. 服务器未启动');
    console.log('2. 网络连接问题');
    console.log('3. 防火墙阻止连接');
  }
}

testServerStatus().catch(console.error);
