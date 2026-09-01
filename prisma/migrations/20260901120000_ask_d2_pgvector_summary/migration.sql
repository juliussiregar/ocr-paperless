-- pgvector for chunk ANN search; doc summary fields for two-stage retrieval
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "sync_files" ADD COLUMN IF NOT EXISTS "doc_summary" TEXT;
ALTER TABLE "sync_files" ADD COLUMN IF NOT EXISTS "doc_embedding" JSONB;

ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "embedding_vec" vector(1536);

CREATE INDEX IF NOT EXISTS "document_chunks_embedding_vec_idx"
  ON "document_chunks" USING hnsw ("embedding_vec" vector_cosine_ops)
  WHERE "embedding_vec" IS NOT NULL;

-- Backfill embedding_vec from existing JSON embeddings (safe no-op if empty)
UPDATE document_chunks
SET embedding_vec = (
  '[' || (
    SELECT string_agg(elem::text, ',')
    FROM jsonb_array_elements_text(embedding::jsonb) AS elem
  ) || ']'
)::vector
WHERE embedding_vec IS NULL
  AND embedding IS NOT NULL
  AND jsonb_typeof(embedding::jsonb) = 'array'
  AND jsonb_array_length(embedding::jsonb) = 1536;
