-- CreateTable
CREATE TABLE "cloud_favorites" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "last_opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cloud_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cloud_favorites_user_id_idx" ON "cloud_favorites"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_favorites_user_id_path_key" ON "cloud_favorites"("user_id", "path");

-- AddForeignKey
ALTER TABLE "cloud_favorites" ADD CONSTRAINT "cloud_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
