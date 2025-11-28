-- 手动添加 Chat 表的 invitedBy 字段（如果还没有添加的话）
-- 使用方法：sqlite3 prisma/data/app.db < prisma/migrations/manual_add_chat_fields.sql

-- 检查字段是否已存在（如果已存在会报错，可以忽略）
ALTER TABLE "Chat" ADD COLUMN "invitedBy" TEXT;
ALTER TABLE "Chat" ADD COLUMN "invitedByUsername" TEXT;

