// scripts/test-ssl.js
import https from 'https';
import http from 'http';

const DOMAIN = 'ji.thy1cc.top';
const PORT = 443;

console.log('🔍 SSL 连接测试');
console.log('================');

console.log('\n1️⃣ 测试 HTTPS 连接...');
const req = https.request({
  hostname: DOMAIN,
  port: PORT,
  path: '/',
  method: 'GET',
  rejectUnauthorized: false, // 允许自签名证书
  timeout: 5000
}, (res) => {
  console.log('✅ HTTPS 连接成功');
  console.log('   状态码:', res.statusCode);
  console.log('   证书有效:', res.socket.authorized ? '是' : '否');

  if (res.socket.authorized === false) {
    console.log('   证书错误:', res.socket.authorizationError);
  }

  res.on('data', () => {}); // 消耗响应数据
  res.on('end', () => {
    console.log('\n2️⃣ 测试 HTTP 重定向...');
    testHttpRedirect();
  });
});

req.on('error', (err) => {
  console.log('❌ HTTPS 连接失败:', err.message);
  console.log('   错误码:', err.code);

  if (err.code === 'ECONNREFUSED') {
    console.log('   原因: 服务器拒绝连接，可能端口未开放');
  } else if (err.code === 'ENOTFOUND') {
    console.log('   原因: 域名解析失败');
  } else if (err.code === 'CERT_HAS_EXPIRED') {
    console.log('   原因: SSL 证书已过期');
  } else if (err.code === 'ERR_SSL_PROTOCOL_ERROR') {
    console.log('   原因: SSL 协议错误');
  }

  console.log('\n2️⃣ 测试 HTTP 连接...');
  testHttpConnection();
});

req.on('timeout', () => {
  console.log('⏰ HTTPS 连接超时');
  req.destroy();
});

req.end();

function testHttpConnection() {
  const req = http.request({
    hostname: DOMAIN,
    port: 80,
    path: '/',
    method: 'GET',
    timeout: 5000
  }, (res) => {
    console.log('✅ HTTP 连接成功');
    console.log('   状态码:', res.statusCode);

    let headers = '';
    res.on('data', () => {});
    res.on('end', () => {
      console.log('\n📋 建议解决方案:');

      if (res.statusCode === 301 || res.statusCode === 302) {
        console.log('• HTTP 重定向到 HTTPS，SSL 证书可能有问题');
        console.log('• 检查 Cloudflare SSL 设置');
      } else {
        console.log('• HTTP 正常，问题在 HTTPS 配置');
        console.log('• 检查 Cloudflare SSL/TLS 设置');
      }

      printSolutions();
    });
  });

  req.on('error', (err) => {
    console.log('❌ HTTP 连接也失败:', err.message);
    console.log('\n📋 建议解决方案:');
    console.log('• 检查 DNS 解析');
    console.log('• 检查服务器防火墙');
    console.log('• 检查域名配置');
    printSolutions();
  });

  req.on('timeout', () => {
    console.log('⏰ HTTP 连接超时');
    req.destroy();
  });

  req.end();
}

function testHttpRedirect() {
  const req = http.request({
    hostname: DOMAIN,
    port: 80,
    path: '/',
    method: 'HEAD',
    timeout: 5000
  }, (res) => {
    console.log('✅ HTTP 重定向检查完成');
    console.log('   状态码:', res.statusCode);

    if (res.headers.location) {
      console.log('   重定向到:', res.headers.location);
    }
  });

  req.on('error', () => {
    console.log('ℹ️ HTTP 重定向检查跳过');
  });

  req.on('timeout', () => {
    console.log('⏰ HTTP 重定向检查超时');
    req.destroy();
  });

  req.end();
}

function printSolutions() {
  console.log('\n🔧 Cloudflare 配置检查:');
  console.log('1. 登录 Cloudflare Dashboard');
  console.log('2. 选择域名 ji.thy1cc.top');
  console.log('3. 进入 SSL/TLS > Overview');
  console.log('4. 确保设置为 "Full (strict)" 或 "Flexible"');
  console.log('5. 检查 Edge Certificates 是否有效');

  console.log('\n🔧 如果要临时禁用 HTTPS:');
  console.log('1. 在 .env 中设置: FORCE_HTTPS=false');
  console.log('2. 重启应用');
  console.log('3. 测试 HTTP 访问: http://ji.thy1cc.top');

  console.log('\n🔧 防火墙规则检查:');
  console.log('• Cloudflare > Security > WAF');
  console.log('• 禁用可能影响 SSL 的规则');

  console.log('\n✅ 测试完成后记得恢复 HTTPS 设置');
}
