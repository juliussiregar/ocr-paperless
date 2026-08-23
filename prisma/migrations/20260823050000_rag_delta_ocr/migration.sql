-- AlterTable
ALTER TABLE "cloud_favorites" ADD COLUMN "last_synced_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sync_files" ADD COLUMN "ocr_pending_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sync_file_id" TEXT NOT NULL,
    "paperless_document_id" INTEGER NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "token_estimate" INTEGER NOT NULL DEFAULT 0,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_chunks_user_id_paperless_document_id_idx" ON "document_chunks"("user_id", "paperless_document_id");

-- CreateIndex
CREATE INDEX "document_chunks_sync_file_id_idx" ON "document_chunks"("sync_file_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_user_id_paperless_document_id_chunk_index_key" ON "document_chunks"("user_id", "paperless_document_id", "chunk_index");

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_sync_file_id_fkey" FOREIGN KEY ("sync_file_id") REFERENCES "sync_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
