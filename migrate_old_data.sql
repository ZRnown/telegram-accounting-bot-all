-- 迁移旧数据库数据的SQL脚本
-- 注意：AdminLoginAttempt 和 AdminAuditLog 表在新schema中不存在，跳过导入

PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

-- 1. 导入 Bot 表（跳过welcomeMessage字段，因为旧数据没有）
INSERT OR IGNORE INTO Bot (id, name, description, token, proxyUrl, enabled, createdAt, updatedAt)
SELECT id, name, description, token, proxyUrl, enabled,
       datetime(createdAt/1000, 'unixepoch'),
       datetime(updatedAt/1000, 'unixepoch')
FROM temp_old.Bot;

-- 2. 导入 BotFeatureFlag 表
INSERT OR IGNORE INTO BotFeatureFlag (id, botId, feature, enabled)
SELECT id, botId, feature, enabled
FROM temp_old.BotFeatureFlag;

-- 3. 导入 ChatGroup 表
INSERT OR IGNORE INTO ChatGroup (id, botId, name, description, createdAt, updatedAt)
SELECT id, botId, name, description,
       datetime(createdAt/1000, 'unixepoch'),
       datetime(updatedAt/1000, 'unixepoch')
FROM temp_old.ChatGroup;

-- 4. 导入 Chat 表（跳过新字段，旧数据没有）
INSERT OR IGNORE INTO Chat (id, title, createdAt, status, allowed, botId)
SELECT id, title,
       datetime(createdAt/1000, 'unixepoch'),
       CASE status
         WHEN 'APPROVED' THEN 'APPROVED'
         WHEN 'PENDING' THEN 'PENDING'
         WHEN 'BLOCKED' THEN 'BLOCKED'
         ELSE 'PENDING'
       END,
       allowed, botId
FROM temp_old.Chat;

-- 5. 导入 ChatFeatureFlag 表
INSERT OR IGNORE INTO ChatFeatureFlag (id, chatId, feature, enabled)
SELECT id, chatId, feature, enabled
FROM temp_old.ChatFeatureFlag;

-- 6. 导入 Setting 表（只导入兼容的字段）
INSERT OR IGNORE INTO Setting (
    id, chatId, feePercent, fixedRate, realtimeRate, displayMode,
    headerText, everyoneAllowed, accountingMode, featureWarningMode,
    addressVerificationEnabled, dailyCutoffHour, hideHelpButton,
    hideOrderButton, overDepositLimit, deleteBillConfirm,
    accountingEnabled, calculatorEnabled
)
SELECT
    id, chatId, feePercent, fixedRate, realtimeRate, displayMode,
    headerText, everyoneAllowed,
    CASE accountingMode
      WHEN 'DAILY_RESET' THEN 'DAILY_RESET'
      WHEN 'CARRY_OVER' THEN 'CARRY_OVER'
      ELSE 'DAILY_RESET'
    END,
    featureWarningMode, addressVerificationEnabled, dailyCutoffHour,
    hideHelpButton, hideOrderButton, overDepositLimit, deleteBillConfirm,
    accountingEnabled, calculatorEnabled
FROM temp_old.Setting;

-- 7. 导入 Operator 表
INSERT OR IGNORE INTO Operator (id, chatId, username)
SELECT id, chatId, username
FROM temp_old.Operator;

-- 8. 导入 Bill 表
INSERT OR IGNORE INTO Bill (id, chatId, status, openedAt, savedAt, closedAt)
SELECT id, chatId,
       CASE status
         WHEN 'OPEN' THEN 'OPEN'
         WHEN 'CLOSED' THEN 'CLOSED'
         ELSE 'OPEN'
       END,
       datetime(openedAt/1000, 'unixepoch'),
       datetime(savedAt/1000, 'unixepoch'),
       CASE WHEN closedAt IS NOT NULL THEN datetime(closedAt/1000, 'unixepoch') ELSE NULL END
FROM temp_old.Bill;

-- 9. 导入 BillItem 表（只导入兼容的字段）
INSERT OR IGNORE INTO BillItem (
    id, billId, type, amount, usdt, rate, feeRate, remark,
    replier, operator, displayName, userId, messageId, createdAt
)
SELECT id, billId,
       CASE type
         WHEN 'INCOME' THEN 'INCOME'
         WHEN 'DISPATCH' THEN 'DISPATCH'
         ELSE 'INCOME'
       END,
       amount, usdt, rate, feeRate, remark,
       replier, operator, displayName, userId, messageId,
       datetime(createdAt/1000, 'unixepoch')
FROM temp_old.BillItem;

-- 10. 导入 Income 表
INSERT OR IGNORE INTO Income (id, chatId, amount, rate, replier, operator, createdAt)
SELECT id, chatId, amount, rate, replier, operator,
       datetime(createdAt/1000, 'unixepoch')
FROM temp_old.Income;

-- 11. 导入 Dispatch 表
INSERT OR IGNORE INTO Dispatch (id, chatId, amount, usdt, replier, operator, createdAt)
SELECT id, chatId, amount, usdt, replier, operator,
       datetime(createdAt/1000, 'unixepoch')
FROM temp_old.Dispatch;

-- 12. 导入 Commission 表
INSERT OR IGNORE INTO Commission (id, chatId, username, value)
SELECT id, chatId, username, value
FROM temp_old.Commission;

-- 13. 导入 WhitelistedUser 表
INSERT OR IGNORE INTO WhitelistedUser (id, userId, username, note, createdAt, updatedAt)
SELECT id, userId, username, note,
       datetime(createdAt/1000, 'unixepoch'),
       datetime(updatedAt/1000, 'unixepoch')
FROM temp_old.WhitelistedUser;

-- 14. 导入 FeatureWarningLog 表
INSERT OR IGNORE INTO FeatureWarningLog (id, chatId, feature, warnedAt)
SELECT id, chatId, feature,
       datetime(warnedAt/1000, 'unixepoch')
FROM temp_old.FeatureWarningLog;

-- 15. 导入 AddressVerification 表
INSERT OR IGNORE INTO AddressVerification (
    id, chatId, confirmedAddress, confirmedCount, pendingAddress,
    pendingCount, lastSenderId, lastSenderName, createdAt, updatedAt
)
SELECT id, chatId, confirmedAddress, confirmedCount, pendingAddress,
       pendingCount, lastSenderId, lastSenderName,
       datetime(createdAt/1000, 'unixepoch'),
       datetime(updatedAt/1000, 'unixepoch')
FROM temp_old.AddressVerification;

-- 16. 导入 GlobalConfig 表
INSERT OR IGNORE INTO GlobalConfig (id, key, value, description, updatedAt, updatedBy)
SELECT id, key, value, description,
       datetime(updatedAt/1000, 'unixepoch'),
       updatedBy
FROM temp_old.GlobalConfig;

COMMIT;
PRAGMA foreign_keys=ON;
