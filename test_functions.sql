-- 测试功能修复的SQL查询
-- 在机器人运行后执行这些查询来验证功能

-- 1. 检查Setting表是否有正确的字段
.schema Setting

-- 2. 检查是否有操作员数据
SELECT '操作员数量:', COUNT(*) FROM Operator;

-- 3. 检查ChatFeatureFlag表
SELECT '功能开关数量:', COUNT(*) FROM ChatFeatureFlag;

-- 4. 检查特定群组的功能开关状态
SELECT
    cf.feature,
    cf.enabled,
    c.title as chat_title
FROM ChatFeatureFlag cf
LEFT JOIN Chat c ON cf.chatId = c.id
WHERE cf.chatId = '-5181543741'; -- 功能演示群组

-- 5. 检查Setting中的关键配置
SELECT
    chatId,
    addressVerificationEnabled,
    accountingEnabled,
    calculatorEnabled,
    welcomeMessage
FROM Setting
WHERE chatId = '-5181543741';

-- 6. 检查自定义命令
SELECT key, value FROM GlobalConfig WHERE key LIKE 'customcmds:%' LIMIT 5;
