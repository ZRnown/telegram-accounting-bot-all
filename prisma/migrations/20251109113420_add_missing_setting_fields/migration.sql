-- AlterTable: 添加缺失的 Setting 字段
ALTER TABLE "Setting" ADD COLUMN "accountingMode" TEXT NOT NULL DEFAULT 'DAILY_RESET';
ALTER TABLE "Setting" ADD COLUMN "featureWarningMode" TEXT NOT NULL DEFAULT 'always';
ALTER TABLE "Setting" ADD COLUMN "addressVerificationEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Setting" ADD COLUMN "dailyCutoffHour" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Setting" ADD COLUMN "hideHelpButton" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Setting" ADD COLUMN "hideOrderButton" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Setting" ADD COLUMN "deleteBillConfirm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Setting" ADD COLUMN "accountingEnabled" BOOLEAN NOT NULL DEFAULT true;

