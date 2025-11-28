-- 检查 Setting 表当前结构
-- 使用方法：sqlite3 prisma/data/app.db < prisma/migrations/check_and_add_fields.sql

-- 先查看当前表结构
.schema Setting

-- 或者查看字段列表
-- PRAGMA table_info(Setting);

-- 然后根据实际情况，只执行不存在的字段的 ALTER TABLE 语句
-- 如果字段已存在，会报错 "duplicate column name"，可以忽略

-- 尝试添加字段（如果已存在会报错，可以忽略）
-- 注意：SQLite 不支持 IF NOT EXISTS，所以需要手动检查

-- 如果 accountingMode 不存在，执行：
-- ALTER TABLE "Setting" ADD COLUMN "accountingMode" TEXT NOT NULL DEFAULT 'DAILY_RESET';

-- 如果 featureWarningMode 不存在，执行：
-- ALTER TABLE "Setting" ADD COLUMN "featureWarningMode" TEXT NOT NULL DEFAULT 'always';

-- 如果 addressVerificationEnabled 不存在，执行：
-- ALTER TABLE "Setting" ADD COLUMN "addressVerificationEnabled" INTEGER NOT NULL DEFAULT 0;

-- 如果 dailyCutoffHour 不存在，执行：
-- ALTER TABLE "Setting" ADD COLUMN "dailyCutoffHour" INTEGER NOT NULL DEFAULT 0;

-- 如果 hideHelpButton 不存在，执行：
-- ALTER TABLE "Setting" ADD COLUMN "hideHelpButton" INTEGER NOT NULL DEFAULT 0;

-- 如果 hideOrderButton 不存在，执行：
-- ALTER TABLE "Setting" ADD COLUMN "hideOrderButton" INTEGER NOT NULL DEFAULT 0;

-- 如果 deleteBillConfirm 不存在，执行：
-- ALTER TABLE "Setting" ADD COLUMN "deleteBillConfirm" INTEGER NOT NULL DEFAULT 0;

-- 如果 accountingEnabled 不存在，执行：
-- ALTER TABLE "Setting" ADD COLUMN "accountingEnabled" INTEGER NOT NULL DEFAULT 1;

