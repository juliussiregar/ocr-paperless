# DocSearch Bappenas

Portal OCR & pencarian dokumen Cloud Bappenas (Next.js + Paperless-ngx + sync-worker).  
**Tanpa Nginx**: browser langsung ke port app (`APP_PORT`, default 3000).

```
Browser ──► :3000 (app)
              ├── postgres / redis / paperless (internal)
sync-worker ──► WebDAV Bappenas → consume → Paperless OCR
```

Postgres, Redis, Paperless hanya bind `127.0.0.1` di host (tidak dipublish ke internet).

---

## Deploy di server (cara pendek)

Contoh VPS **arteloka** (sudah ada app di `:3001`, Postgres di `:5432`):

| Service | Port host |
|---------|-----------|
| Arteloka app | `3001` (biarkan) |
| DocSearch portal | **`3002`** |
| DocSearch Postgres | `127.0.0.1:5434` (bukan 5432) |
| DocSearch Redis | `127.0.0.1:6380` |
| Paperless admin | `127.0.0.1:8000` |

Project Compose bernama `docsearch` (container/volume terpisah dari `arteloka-*`).  
RAM **8GB+** disarankan (Paperless ~2GB, sync-worker ~1GB, app ~768MB, Redis 256MB).

Checklist deploy lengkap: [docs/deploy.md](docs/deploy.md)

```bash
npm run pre-deploy          # lokal: tsc + worker build
./scripts/server-up.sh      # server: build + up
```

### 1. Prasyarat

- Docker Engine + Docker Compose plugin
- Firewall buka **`APP_PORT`** (default 3002)

### 2. Env

```bash
cp .env.example .env
nano .env
```

Isi wajib (jangan biarkan `change-me…` / `SERVER_IP`):

| Variabel | Contoh arteloka |
|----------|-----------------|
| `COMPOSE_PROFILES` | `prod` |
| `APP_PORT` | `3002` |
| `NEXTAUTH_URL` | `http://IP_SERVER:3002` |
| `NEXTAUTH_SECRET` / `ENCRYPTION_KEY` | random kuat |
| Password DB / Paperless / Admin | kuat |

### 3. Build & up

```bash
chmod +x scripts/server-up.sh
./scripts/server-up.sh
```

### 4. Token Paperless (sekali)

```bash
ssh -L 8000:127.0.0.1:8000 arteloka@SERVER
# browser: http://127.0.0.1:8000 → API token → .env PAPERLESS_API_TOKEN=
docker compose up -d --force-recreate app sync-worker
```

### 5. Cek

```bash
docker compose ps
curl http://127.0.0.1:3002/api/health
# arteloka tetap: docker ps | grep arteloka
```

### Update

```bash
git pull
./scripts/server-up.sh
```

### Stop DocSearch saja (arteloka tetap)

```bash
docker compose down
```

---

## Development (laptop)

Infra Docker, Next.js hot-reload lokal (service `app` **tidak** dijalankan):

```bash
# di .env lokal: hapus / kosongkan COMPOSE_PROFILES
cp .env.example .env
# edit password; jangan set COMPOSE_PROFILES=prod

npm run dev:infra          # postgres redis paperless sync-worker
npm run db:push            # schema + seed (butuh app/.env.local)
cd app && npm run dev      # http://localhost:3000
```

Salin token Paperless ke root `.env` (`PAPERLESS_API_TOKEN`) dan `app/.env.local` (`PAPERLESS_TOKEN`), lalu:

```bash
docker compose up -d --force-recreate sync-worker
```

---

## Integrasi WhatsApp

API terbuka untuk service WhatsApp: [docs/whatsapp-integration.md](docs/whatsapp-integration.md)

## Auto scan

Roadmap dan cara aktivasi: [docs/auto-scan-phases.md](docs/auto-scan-phases.md)

## Deploy checklist

Langkah verifikasi production: [docs/deploy.md](docs/deploy.md)

---

## Keamanan singkat

- Jangan publish Postgres / Redis / Paperless ke `0.0.0.0`
- Firewall: cukup buka `APP_PORT`
- Jangan ganti `ENCRYPTION_KEY` setelah ada kredensial tersimpan
- Auto-scan default off (aktifkan di Admin)

## Struktur

```
ocr-paperless/
├── .env                 # Docker (server & infra)
├── .env.example
├── scripts/server-up.sh # deploy server
├── app/                 # Next.js
├── sync-worker/
├── prisma/
└── docker-compose.yml
```
