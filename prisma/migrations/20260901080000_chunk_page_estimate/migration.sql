-- Estimated page (1-based) for chunk location in source PDF
ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "page_estimate" INTEGER;
