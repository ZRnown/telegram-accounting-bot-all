-- 测试操作员权限修复 - 模拟添加操作员后的状态

-- 1. 清理现有操作员数据
DELETE FROM Operator;

-- 2. 添加测试操作员（不带@前缀）
INSERT OR IGNORE INTO Operator (id, chatId, username)
VALUES
('test-op-1', '-5181543741', 'tailande8899'),  -- 假设这是用户的用户名
('test-op-2', '-5181543741', 'dcbj6688');     -- 白名单用户

-- 3. 检查操作员数据
SELECT '操作员列表:' as info;
SELECT username, chatId FROM Operator;

-- 4. 验证用户名格式（应该没有@前缀）
SELECT '用户名格式检查:' as info,
       username,
       CASE WHEN username LIKE '@%' THEN '错误：包含@' ELSE '正确：无@' END as format_check
FROM Operator;

-- 预期结果：
-- 操作员数量: 2
-- 用户名格式都是"无@"
