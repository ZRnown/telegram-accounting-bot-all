-- 手动添加缺失的 Setting 表字段
-- 使用方法：sqlite3 prisma/data/app.db < prisma/migrations/manual_add_setting_fields.sql
-- 或者：sqlite3 prisma/data/app.db
-- 然后复制粘贴下面的 SQL 语句

-- 检查字段是否已存在（如果已存在会报错，可以忽略）
-- 添加 accountingMode 字段（枚举类型，存储为 TEXT）
ALTER TABLE "Setting" ADD COLUMN "accountingMode" TEXT NOT NULL DEFAULT 'DAILY_RESET';

-- 添加 featureWarningMode 字段
ALTER TABLE "Setting" ADD COLUMN "featureWarningMode" TEXT NOT NULL DEFAULT 'always';

-- 添加 addressVerificationEnabled 字段（SQLite 中 BOOLEAN 实际是 INTEGER）
ALTER TABLE "Setting" ADD COLUMN "addressVerificationEnabled" INTEGER NOT NULL DEFAULT 0;

-- 添加 dailyCutoffHour 字段
ALTER TABLE "Setting" ADD COLUMN "dailyCutoffHour" INTEGER NOT NULL DEFAULT 0;

-- 添加 hideHelpButton 字段
ALTER TABLE "Setting" ADD COLUMN "hideHelpButton" INTEGER NOT NULL DEFAULT 0;

-- 添加 hideOrderButton 字段
ALTER TABLE "Setting" ADD COLUMN "hideOrderButton" INTEGER NOT NULL DEFAULT 0;

-- 添加 deleteBillConfirm 字段
ALTER TABLE "Setting" ADD COLUMN "deleteBillConfirm" INTEGER NOT NULL DEFAULT 0;

-- 添加 accountingEnabled 字段（这是导致错误的字段）
ALTER TABLE "Setting" ADD COLUMN "accountingEnabled" INTEGER NOT NULL DEFAULT 1;

-- 验证：查看 Setting 表结构
-- .schema Setting

