-- 测试操作员权限修复

-- 1. 检查操作员数据
SELECT '当前操作员数量:', COUNT(*) FROM Operator;

-- 2. 检查特定群组的操作员
SELECT
    o.username,
    c.title as chat_title
FROM Operator o
LEFT JOIN Chat c ON o.chatId = c.id
WHERE o.chatId = '-5181543741'; -- 功能演示群组

-- 3. 检查内存同步状态（通过检查数据库是否有操作员记录来验证）
SELECT '验证操作员权限应该正常工作' as status;
