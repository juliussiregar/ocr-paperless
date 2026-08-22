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

### 1. Prasyarat

- Docker Engine + Docker Compose plugin
- Port `3000` (atau `APP_PORT`) dibuka di firewall

### 2. Env

```bash
cp .env.example .env
nano .env   # atau vim
```

Isi wajib (jangan biarkan `change-me…` / `SERVER_IP`):

| Variabel | Contoh |
|----------|--------|
| `COMPOSE_PROFILES` | `prod` (sudah di example) |
| `NEXTAUTH_URL` | `http://IP_SERVER:3000` |
| `NEXTAUTH_SECRET` | string random panjang |
| `ENCRYPTION_KEY` | ≥ 32 karakter |
| `POSTGRES_PASSWORD` | kuat |
| `PAPERLESS_SECRET_KEY` / `PAPERLESS_ADMIN_*` | kuat |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | login portal |

`PAPERLESS_API_TOKEN` boleh kosong dulu (diisi setelah Paperless hidup).

### 3. Build & up

```bash
chmod +x scripts/server-up.sh
./scripts/server-up.sh
```

Atau setara:

```bash
docker compose up -d --build
```

(dengan `COMPOSE_PROFILES=prod` di `.env` agar service `app` ikut.)

### 4. Token Paperless (sekali)

```bash
# di server
curl -I http://127.0.0.1:8000

# atau tunnel dari laptop
ssh -L 8000:127.0.0.1:8000 user@SERVER
```

1. Login Paperless  
2. Profile → **API Auth Tokens** → Create  
3. Paste ke `.env` → `PAPERLESS_API_TOKEN=...`  
4. Apply:

```bash
docker compose up -d --force-recreate app sync-worker
```

### 5. Cek

```bash
docker compose ps
curl http://127.0.0.1:3000/api/health
```

Buka `NEXTAUTH_URL`, login `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### Update kode

```bash
git pull
./scripts/server-up.sh
```

### Perintah biasa

```bash
docker compose logs -f app
docker compose logs -f sync-worker
docker compose down          # stop, data volume aman
docker compose down -v       # HAPUS data (hati-hati)
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
