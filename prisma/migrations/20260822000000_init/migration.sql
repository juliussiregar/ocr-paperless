-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('DISCOVERED', 'DOWNLOADING', 'QUEUED', 'OCR_PENDING', 'OCR_DONE', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScanJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_config" (
    "id" TEXT NOT NULL,
    "bappenas_url" TEXT NOT NULL DEFAULT 'https://cloud.bappenas.go.id',
    "encrypted_username" TEXT NOT NULL,
    "encrypted_password" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_discovery_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cloud_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_files" (
    "id" TEXT NOT NULL,
    "remote_path" TEXT NOT NULL,
    "remote_file_id" TEXT,
    "file_name" TEXT NOT NULL,
    "etag" TEXT,
    "last_modified" TIMESTAMP(3),
    "file_size" BIGINT,
    "content_hash" TEXT,
    "mime_type" TEXT,
    "sync_status" "SyncStatus" NOT NULL DEFAULT 'DISCOVERED',
    "paperless_document_id" INTEGER,
    "error_message" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_jobs" (
    "id" TEXT NOT NULL,
    "triggered_by_id" TEXT,
    "status" "ScanJobStatus" NOT NULL DEFAULT 'PENDING',
    "total_files" INTEGER NOT NULL DEFAULT 0,
    "processed_files" INTEGER NOT NULL DEFAULT 0,
    "skipped_files" INTEGER NOT NULL DEFAULT 0,
    "failed_files" INTEGER NOT NULL DEFAULT 0,
    "new_files" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "meta" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sync_files_remote_path_key" ON "sync_files"("remote_path");

-- CreateIndex
CREATE INDEX "sync_files_content_hash_idx" ON "sync_files"("content_hash");

-- CreateIndex
CREATE INDEX "sync_files_sync_status_idx" ON "sync_files"("sync_status");

-- CreateIndex
CREATE INDEX "sync_files_etag_idx" ON "sync_files"("etag");

-- CreateIndex
CREATE INDEX "sync_files_paperless_document_id_idx" ON "sync_files"("paperless_document_id");

-- CreateIndex
CREATE INDEX "scan_jobs_status_idx" ON "scan_jobs"("status");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
