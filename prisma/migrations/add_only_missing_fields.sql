-- 只添加缺失的字段（跳过已存在的字段）
-- 使用方法：在 sqlite3 中执行 PRAGMA table_info(Setting); 查看已有字段
-- 然后只执行不存在的字段的 ALTER TABLE 语句

-- 根据你的错误信息，accountingMode 已存在，所以跳过它
-- 从 featureWarningMode 开始尝试添加：

ALTER TABLE "Setting" ADD COLUMN "featureWarningMode" TEXT NOT NULL DEFAULT 'always';
ALTER TABLE "Setting" ADD COLUMN "addressVerificationEnabled" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Setting" ADD COLUMN "dailyCutoffHour" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Setting" ADD COLUMN "hideHelpButton" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Setting" ADD COLUMN "hideOrderButton" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Setting" ADD COLUMN "deleteBillConfirm" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Setting" ADD COLUMN "accountingEnabled" INTEGER NOT NULL DEFAULT 1;

