# Dokumentasi DocSearch

## PDF utama (disarankan)

| File | Keterangan |
|------|------------|
| **`DocSearch-Dokumentasi-Aplikasi.pdf`** | Dokumentasi A4 lengkap (bukan slide): konteks, Paperless mendalam, arsitektur, DB, alur teknis ber-flowchart, modul halaman, keamanan, OpenAI & biaya, operasional, FAQ |

Generate ulang:

```bash
pip3 install reportlab
python3 docs/presentation/generate_docs_pdf.py
```

Script sumber: `generate_docs_pdf.py` (helper flowchart `FlowBox` / `ArrowDown` / `HFlow`, callout, tabel).

## Isi dokumen (bab)

**A. Ringkasan & konteks**
1. Ringkasan aplikasi
2. Masalah yang diselesaikan

**B. Paperless-ngx mendalam**
3. Asal, fungsi, kelebihan, batasan, consume folder, checksum/ID vs SyncFile, API yang dipakai portal

**C. Arsitektur & stack**
4. Arsitektur DocSearch
5. Stack teknologi

**D. Database lengkap**
6. DB `paperless` vs `app`, ER/relasi, field penting, status SyncFile + arti UI

**E. Alur teknis mendalam** (banyak flowchart)
7. Pipeline SyncFile, retry/0B/timeout OCR, auto-scan, embedding backfill, ingest E2E, Ask AI, Search

**F. Modul per halaman**
8. Ask AI, Search, Library, Admin, Profil (tujuan, cara pakai, API, batasan)

**G. Keamanan & multi-user**
9. Isolasi data, `ENCRYPTION_KEY`, role ADMIN/USER, bcrypt, audit, rate limit

**H. OpenAI models & biaya**
10. Default `gpt-4o-mini` / `text-embedding-3-small`, kapan dipanggil, audit biaya

**I. Operasional**
11. Deploy/update, backup, health, tuning ~8 GB RAM

**J. Lampiran**
12. Glosarium, FAQ, checklist go-live

## File lama (opsional)

Slide PPT/PDF sales sebelumnya masih ada (`DocSearch-Bappenas-Presentasi.*`) bila dibutuhkan untuk pitch singkat. Untuk penjelasan teknis, pakai PDF dokumentasi di atas.
