# DocSearch Bappenas

Portal OCR & pencarian dokumen dari Cloud Bappenas, dengan Paperless-ngx + AI chatbot.

## Arsitektur (tanpa Nginx)

```
Browser ──► :3000 (Next.js app)
                ├── postgres:5432
                ├── redis:6379
                └── paperless:8000   (internal Docker network)

sync-worker ──► postgres / redis / paperless / consume volume
```

Yang dipublish ke luar: **hanya port app** (`APP_PORT`, default 3000).  
Postgres, Redis, Paperless hanya di `127.0.0.1` (untuk tooling / setup token).

---

## Deploy di server (semua via Docker)

### Prasyarat

- Docker + Docker Compose
- File `.env` di root (salin dari `.env.example`)

### 1. Siapkan env

```bash
cp .env.example .env
# Edit .env: password, secret, NEXTAUTH_URL, OPENAI_API_KEY, dll.
```

Penting:

| Variabel | Isi |
|----------|-----|
| `NEXTAUTH_URL` | URL publik app, mis. `http://IP_SERVER:3000` |
| `NEXTAUTH_SECRET` | random panjang |
| `ENCRYPTION_KEY` | min 32 karakter (jangan diganti setelah ada data) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | login portal (di-seed saat `app` start) |
| `PAPERLESS_API_TOKEN` | isi setelah langkah 3 |

### 2. Build & jalankan semua service

```bash
# Infra saja (dev / default)
docker compose up -d --build

# Full termasuk Next.js app (production)
docker compose --profile prod up -d --build
# atau: npm run prod:up
```

Tanpa profile `prod`, service `app` tidak dijalankan (supaya tidak bentrok dengan `npm run dev` di port 3000).

- App (prod): http://SERVER:3000  
- Paperless (hanya localhost server): http://127.0.0.1:8000  

### 3. Paperless API token

Di server:

```bash
# opsi A: buka di mesin server
curl -I http://127.0.0.1:8000

# opsi B: tunnel dari laptop
ssh -L 8000:127.0.0.1:8000 user@SERVER
# lalu buka http://127.0.0.1:8000 di browser laptop
```

1. Login Paperless (`PAPERLESS_ADMIN_USER` / `PAPERLESS_ADMIN_PASSWORD`)
2. Profile → **API Auth Token** → Create
3. Paste ke `.env` → `PAPERLESS_API_TOKEN=...`
4. Recreate app + worker:

```bash
docker compose up -d --force-recreate app sync-worker
```

### 4. Verifikasi

```bash
docker compose ps
docker compose logs -f app
curl http://127.0.0.1:3000/api/health
```

Login portal dengan `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### Perintah berguna

```bash
docker compose up -d --build   # start / rebuild
docker compose logs -f         # semua log
docker compose logs -f app     # log Next.js
docker compose down            # stop (volume tetap aman)
docker compose down -v         # stop + hapus data (hati-hati)
```

### Update versi

```bash
git pull
docker compose up -d --build
```

---

## Development (infra Docker + Next.js lokal)

Hot reload untuk coding sehari-hari.

### Env

| File | Dipakai oleh |
|------|----------------|
| **`.env` (root)** | Docker Compose |
| **`app/.env.local`** | Next.js (`npm run dev`) |

### Langkah

```bash
# 1. Infra saja (tanpa rebuild app image)
docker compose up -d postgres redis paperless sync-worker

# 2. Schema + seed
npm run db:push

# 3. Next.js lokal
cd app && npm run dev
```

- App: http://localhost:3000  
- Paperless: http://127.0.0.1:8000  
- Postgres: `127.0.0.1:5434` · Redis: `127.0.0.1:6380`

Atau full stack Docker (termasuk app): `docker compose up -d --build`.

### Admin (dev)

Admin dibuat lewat `npm run db:push` / `npm run db:seed`, atau otomatis saat container `app` start.

### Paperless API Token (dev)

Sama seperti deploy: isi `PAPERLESS_API_TOKEN` di root `.env` dan `PAPERLESS_TOKEN` di `app/.env.local`, lalu:

```bash
docker compose up -d --force-recreate sync-worker
```

---

## Fitur keamanan

- Admin via seed (bukan endpoint publik)
- Paperless / DB / Redis hanya di localhost host
- Rate limit chat & scan
- OCR timeout, auto-scan, audit log

## Struktur

```
ocr-paperless/
├── .env                 # Docker (semua service)
├── app/.env.local       # Next.js lokal (dev)
├── app/                 # Next.js (+ Dockerfile)
├── sync-worker/         # WebDAV → Paperless
├── prisma/
└── docker-compose.yml   # postgres, redis, paperless, sync-worker, app
```
