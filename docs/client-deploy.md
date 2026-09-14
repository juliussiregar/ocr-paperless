# Deploy di server client (satu perintah)

Persiapan di mesin client (Docker + Compose sudah terpasang):

```bash
cp .env.example .env
nano .env          # isi wajib saja (lihat komentar di file)
./scripts/client-up.sh
```

Atau: `npm run client:up` / `npm run prod:up`.

## Env

- **Wajib:** [.env.example](../.env.example) (minimal)
- **Opsional / tuning:** [.env.example.full](../.env.example.full)

Setelah Paperless naik, buat API token sekali, paste ke `PAPERLESS_API_TOKEN`, lalu:

```bash
docker compose up -d --force-recreate app sync-worker
```

## Cek

```bash
docker compose ps
./scripts/verify-up.sh
# atau:
curl -s http://127.0.0.1:${APP_PORT:-3002}/api/health
```

`verify-up.sh`:

- exit `0` = siap fitur penuh
- exit `2` = health OK, tapi `OPENAI_API_KEY` / `PAPERLESS_API_TOKEN` belum siap
- exit `1` = health gagal

Lokal (tanpa Docker stack penuh): `npm test` atau `npm run smoke`.

## Setelah `git pull` (update)

```bash
cd /path/ke/ocr-paperless
git pull --ff-only
# JANGAN: cp .env.example .env (menimpa secret)
# Bandingkan key baru bila perlu: diff -u .env .env.example | less
./scripts/client-up.sh
./scripts/verify-up.sh
```

## Catatan

- Script ini **build di server** (`docker compose up -d --build`), bukan `docker load` dari laptop.
- Build default serial (`COMPOSE_PARALLEL_LIMIT=1`) agar VPS 8GB tidak OOM.
- Tidak membutuhkan akses SSH dari mesin developer; operator client cukup punya `.env` dan menjalankan `./scripts/client-up.sh`.

## Jangan

1. Anggap selesai hanya karena container `Up` tanpa token Paperless (+ OpenAI jika butuh Tanya Arsip)
2. Publish Postgres / Redis / Paperless ke internet
3. Ganti `POSTGRES_PASSWORD` atau `ENCRYPTION_KEY` setelah data ada
4. `docker compose down -v` kecuali sengaja hapus data
5. Password dengan karakter `@ : / # $` (bisa pecahkan URL database)
