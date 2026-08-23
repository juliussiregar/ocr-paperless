-- Fix DocumentChunk unique to be per-user (multi-tenant safe)
DROP INDEX IF EXISTS "document_chunks_paperless_document_id_chunk_index_key";

CREATE UNIQUE INDEX IF NOT EXISTS "document_chunks_user_id_paperless_document_id_chunk_index_key"
  ON "document_chunks"("user_id", "paperless_document_id", "chunk_index");
