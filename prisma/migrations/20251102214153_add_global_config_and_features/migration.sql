-- AlterTable
ALTER TABLE "Setting" ADD COLUMN "overDepositLimit" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Setting" ADD COLUMN "lastOverDepositWarning" DATETIME;

-- CreateTable
CREATE TABLE "GlobalConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "updatedBy" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "GlobalConfig_key_key" ON "GlobalConfig"("key");
CREATE INDEX "GlobalConfig_key_idx" ON "GlobalConfig"("key");
