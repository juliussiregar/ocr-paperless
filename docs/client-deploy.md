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

`verify-up.sh` memeriksa health app, Paperless, serta `OPENAI_API_KEY` / `PAPERLESS_API_TOKEN`.

Lokal (tanpa Docker stack penuh): `npm test` atau `npm run smoke`.

## Catatan

- Script ini **build di server** (`docker compose up -d --build`), bukan `docker load` dari laptop.
- Tidak membutuhkan akses SSH dari mesin developer; operator client cukup punya `.env` dan menjalankan `./scripts/client-up.sh`.
