# Deploy DocSearch (checklist)

Gunakan dokumen ini sebelum `git pull` + `./scripts/server-up.sh` di production.

## 1. Prasyarat server

- Docker + Compose plugin
- RAM disarankan **8GB+** (Paperless OCR + sync-worker + app)
- Firewall: buka `APP_PORT` (default 3002), **bukan** Postgres/Redis/Paperless ke publik
- `COMPOSE_PROFILES=prod` di `.env`

## 2. Env wajib

Salin `.env.example` → `.env`, isi semua yang tidak placeholder:

| Variabel | Catatan |
|----------|---------|
| `NEXTAUTH_URL` | URL publik portal, mis. `http://IP:3002` |
| `NEXTAUTH_SECRET`, `ENCRYPTION_KEY` | Min 32 char, unik |
| `POSTGRES_PASSWORD`, `PAPERLESS_*` | Kuat |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Login portal |
| `PAPERLESS_API_TOKEN` | Setelah Paperless pertama kali up |

Opsional penting:

| Variabel | Default | Fungsi |
|----------|---------|--------|
| `SCAN_MAX_FILES` | 100 | Batch ingest |
| `OPENAI_API_KEY` | - | Ask AI + embedding |
| `INGEST_MAX_RETRY_COUNT` | 5 | Cap auto-retry FAILED |
| `ASK_FULL_DOC_MAX_CHARS` | 100000 | Analisis teks OCR utuh |
| `EMBED_BACKFILL_BATCH` | 15 | Kecepatan index embedding |

## 3. Cek lokal sebelum push

```bash
./scripts/pre-deploy-check.sh
```

## 4. Deploy di server

```bash
git pull
./scripts/server-up.sh
```

Entrypoint app menjalankan `prisma db push` otomatis saat container start.

## 5. Verifikasi setelah up

```bash
curl -s http://127.0.0.1:3002/api/health | jq
docker compose ps
docker compose logs --tail=50 sync-worker
```

Health harus `status: ok` dengan `database: true`, `redis: true`.

## 6. Paperless token (sekali)

Lihat output `server-up.sh` jika `PAPERLESS_API_TOKEN` kosong.

```bash
docker compose up -d --force-recreate app sync-worker
```

## 7. Uji fungsional (staging / pilot)

1. Login admin → Profil: kredensial Bappenas test user
2. Library: browse folder, refresh cache
3. Ambil 1–2 dokumen (non-PDF jika perlu) → OCR done
4. Search: sync summary + live refresh
5. Ask AI: pin `@` dokumen, pertanyaan analitis
6. Admin → Scan health: queue depth 0, tidak ada job macet
7. Admin → Delta manual per user (batch kecil)
8. **Jangan** nyalakan auto-scan sampai uji manual OK

## 8. Aktifasi auto-scan (opsional)

Urutan di Admin:

1. `Siap deploy` ON
2. Set batch, interval, root/subtrees
3. Jadwal auto scan ON
4. Pantau Scan health 48 jam

Detail: [auto-scan-phases.md](./auto-scan-phases.md)

## 9. Troubleshooting

| Gejala | Cek |
|--------|-----|
| Health degraded | `docker compose logs app`, DB credentials |
| Redis false | `docker compose logs redis`, memory limit |
| OCR tidak selesai | Paperless logs, `PAPERLESS_API_TOKEN` |
| Ask AI kosong | `OPENAI_API_KEY`, embedding backfill di worker log |
| User scan lock | Admin → Release lock |
| FAILED loop | `INGEST_MAX_RETRY_COUNT`, manual retry di Library |

## 10. Update rutin

```bash
git pull
./scripts/pre-deploy-check.sh   # opsional di laptop
./scripts/server-up.sh
```

Schema baru otomatis via `db push` di app container restart.
