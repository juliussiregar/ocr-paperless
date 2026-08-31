# DocSearch: API Integrasi WhatsApp

Dokumen ini menjelaskan cara **service WhatsApp** (mis. `simple-whatsapp-api`) memanggil DocSearch untuk fitur **Ask AI** pada arsip dokumen Cloud Bappenas.

Komunikasi antar tim sebaiknya mengacu pada dokumen ini. Perubahan API akan dicatat di bagian **Changelog** di bawah.

---

## Ringkasan

| Item | Nilai |
|------|--------|
| Produk | DocSearch (portal OCR + pencarian isi + Ask AI) |
| Base URL production | `http://103.58.100.237:3002` |
| Autentikasi | **Tidak ada** (endpoint terbuka) |
| User portal (tetap) | `triando@gmail.com` (kredensial cloud Bappenas milik user ini) |
| Format response chat | JSON (non-streaming) |
| Max dokumen rujukan | 3 per respons |
| Rate limit chat | 60 request / jam (per user integrasi) |

DocSearch **tidak** mengelola koneksi WhatsApp. Service WhatsApp bertugas:

1. Menerima pesan dari user WA
2. Memanggil API DocSearch (`/chat`)
3. Mengirim `answer` + file PDF (jika ada) kembali ke WA

---

## Arsitektur

```
User WhatsApp
    │
    ▼
Service WhatsApp (simple-whatsapp-api)
    │  POST /api/integrations/whatsapp/chat
    │  GET  /api/integrations/whatsapp/documents/{id}/download  (opsional)
    ▼
DocSearch (Next.js app)
    ├── PostgreSQL (metadata, chat history)
    ├── Paperless-ngx (OCR + indeks isi dokumen)
    └── OpenAI (GPT untuk jawaban)
```

---

## Endpoint

### 1. Health check

Memastikan DocSearch hidup sebelum integrasi atau monitoring.

```http
GET /api/health
```

**Response 200:**

```json
{ "status": "ok" }
```

**Contoh:**

```bash
curl -sS "http://103.58.100.237:3002/api/health"
```

---

### 2. Chat (Ask AI)

Endpoint utama. Mengajukan pertanyaan dalam bahasa natural; DocSearch mencari dokumen relevan dan mengembalikan jawaban AI beserta rujukan (max 3).

```http
POST /api/integrations/whatsapp/chat
Content-Type: application/json
```

#### Request body

| Field | Tipe | Wajib | Default | Deskripsi |
|-------|------|-------|---------|-----------|
| `question` | string | Ya | - | Pertanyaan user. Max 2000 karakter. |
| `conversationId` | string | Tidak | - | UUID conversation untuk lanjutan chat multi-turn. Kosong = conversation baru. |
| `includeFiles` | boolean | Tidak | `true` | Jika `true`, setiap dokumen rujukan disertai PDF sebagai `fileBase64`. Jika `false`, hanya metadata + `downloadUrl`. |
| `scope` | object | Tidak | `{ "mode": "all" }` | Hanya dipakai saat **conversation baru** (tanpa `conversationId`). Lihat [Scope pencarian](#scope-pencarian). |

#### Response 200 (sukses)

| Field | Tipe | Deskripsi |
|-------|------|-----------|
| `conversationId` | string | Simpan untuk pertanyaan berikutnya (multi-turn). |
| `messageId` | string | ID pesan assistant di database DocSearch. |
| `title` | string | Judul conversation (auto dari pertanyaan pertama). |
| `answer` | string | Jawaban AI dalam teks. |
| `documents` | array | Max 3 dokumen rujukan. Bisa kosong jika tidak ada dokumen relevan. |
| `user` | object | `{ email, name }` user portal integrasi. |

#### Objek `documents[]`

| Field | Tipe | Selalu ada | Deskripsi |
|-------|------|------------|-----------|
| `id` | number | Ya | Paperless document ID. |
| `title` | string | Ya | Judul tampilan dokumen. |
| `fileName` | string | Ya | Nama file asli. |
| `remotePath` | string \| null | Ya | Path di Cloud Bappenas (jika ada). |
| `fileSize` | number \| null | Ya | Ukuran file dalam byte (dari sync metadata). |
| `snippet` | string | Ya | Cuplikan teks OCR (max ~400 karakter). |
| `downloadUrl` | string | Ya | URL download PDF (endpoint terbuka DocSearch). |
| `contentType` | string | Jika `includeFiles` | Biasanya `application/pdf`. |
| `fileBase64` | string \| null | Jika `includeFiles` | PDF dalam base64. Null jika gagal atau terlalu besar. |
| `fileIncluded` | boolean | Jika `includeFiles` | `true` jika `fileBase64` berisi file. |
| `fileError` | string \| null | Jika `includeFiles` | Penyebab jika `fileIncluded: false`. |

#### Contoh request (pertanyaan baru, dengan file)

```bash
curl -sS -X POST "http://103.58.100.237:3002/api/integrations/whatsapp/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Ringkas isi dokumen terkait RPJMN",
    "includeFiles": true
  }'
```

#### Contoh request (lanjutan conversation)

```bash
curl -sS -X POST "http://103.58.100.237:3002/api/integrations/whatsapp/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Apa poin utama dari dokumen pertama?",
    "conversationId": "550e8400-e29b-41d4-a716-446655440000",
    "includeFiles": false
  }'
```

#### Contoh response (sukses, disingkat)

```json
{
  "conversationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "messageId": "f9e8d7c6-b5a4-3210-fedc-ba9876543210",
  "title": "Ringkas isi dokumen terkait RPJMN",
  "answer": "Berdasarkan dokumen yang ditemukan, RPJMN ...",
  "documents": [
    {
      "id": 35,
      "title": "RPJMN 2025-2029",
      "fileName": "RPJMN_2025.pdf",
      "remotePath": "/Bappenas/Perencanaan/RPJMN_2025.pdf",
      "fileSize": 2605844,
      "snippet": "Rencana Pembangunan Jangka Menengah Nasional ...",
      "downloadUrl": "http://103.58.100.237:3002/api/integrations/whatsapp/documents/35/download",
      "contentType": "application/pdf",
      "fileBase64": "JVBERi0xLjQKJeLjz9MK...",
      "fileIncluded": true,
      "fileError": null
    }
  ],
  "user": {
    "email": "triando@gmail.com",
    "name": "Triando"
  }
}
```

#### Response jika tidak ada dokumen relevan

`documents` bisa kosong; `answer` tetap ada (biasanya menyatakan tidak ditemukan informasi dalam konteks).

```json
{
  "conversationId": "...",
  "answer": "Tidak ditemukan informasi tentang ... dalam konteks yang diberikan.",
  "documents": [],
  "user": { "email": "triando@gmail.com", "name": "..." }
}
```

---

### 3. Download PDF (opsional)

Alternatif jika `includeFiles: false` atau `fileIncluded: false`. Mengambil byte PDF langsung.

```http
GET /api/integrations/whatsapp/documents/{id}/download
```

| Parameter | Tipe | Deskripsi |
|-----------|------|-----------|
| `id` | number (path) | Paperless document ID (sama dengan `documents[].id`). |

**Response 200:** body binary PDF.

**Headers:**

- `Content-Type`: `application/pdf` (atau tipe asli dari Paperless)
- `Content-Disposition`: `attachment; filename="..."`

**Contoh:**

```bash
curl -sS -o dokumen.pdf \
  "http://103.58.100.237:3002/api/integrations/whatsapp/documents/35/download"
```

---

## Scope pencarian

Saat conversation **baru** (tanpa `conversationId`), body bisa menyertakan `scope` untuk membatasi dokumen yang dijadikan konteks AI.

| `scope.mode` | Body | Deskripsi |
|--------------|------|-----------|
| `all` | `{ "mode": "all" }` | Semua dokumen user integrasi yang sudah OCR. **Default.** |
| `docs` | `{ "mode": "docs", "docIds": [35, 36] }` | Hanya dokumen dengan ID tertentu. |
| `folder` | `{ "mode": "folder", "pathPrefix": "/Bappenas/Perencanaan" }` | Dokumen di bawah path cloud tertentu. |

Setelah conversation dibuat, scope mengikuti conversation pertama (field `scope` di conversation tidak bisa diubah lewat request berikutnya).

---

## Alur integrasi (service WhatsApp)

### Mapping sesi WA ke conversation DocSearch

Disarankan simpan di database atau cache service WhatsApp:

| Kunci | Nilai |
|-------|--------|
| `waChatId` (nomor/grup WA) | `conversationId` DocSearch |

- Chat baru di WA → POST chat **tanpa** `conversationId`
- User lanjut bertanya di chat yang sama → POST chat **dengan** `conversationId` yang disimpan
- User minta "chat baru" / reset konteks → hapus mapping, POST tanpa `conversationId`

### Urutan kirim ke WhatsApp

1. **Teks jawaban** (`answer`) sebagai pesan teks pertama.
2. **Dokumen rujukan** (jika ada), max 3:
   - Jika `fileIncluded === true`: decode `fileBase64` → kirim sebagai file PDF.
   - Jika `fileIncluded === false`: kirim `downloadUrl` sebagai teks, atau fetch via GET download endpoint lalu kirim file.
3. Opsional: kirim `title` / `fileName` sebagai caption atau pesan pendek sebelum file.

### Pseudocode (Node.js)

```javascript
const DOCSEARCH = "http://103.58.100.237:3002";

async function handleWaMessage(waChatId, question) {
  const conversationId = await getStoredConversationId(waChatId);

  const res = await fetch(`${DOCSEARCH}/api/integrations/whatsapp/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      conversationId,
      includeFiles: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `DocSearch HTTP ${res.status}`);
  }

  const data = await res.json();
  await saveConversationId(waChatId, data.conversationId);

  // 1. Jawaban teks
  await waSendText(waChatId, data.answer);

  // 2. PDF rujukan
  for (const doc of data.documents ?? []) {
    const label = `${doc.title}\n${doc.fileName}`;
    if (doc.fileIncluded && doc.fileBase64) {
      const pdfBytes = Buffer.from(doc.fileBase64, "base64");
      await waSendDocument(waChatId, pdfBytes, doc.fileName, label);
    } else if (doc.downloadUrl) {
      await waSendText(waChatId, `${label}\n${doc.downloadUrl}`);
    }
  }
}
```

### Rekomendasi `includeFiles`

| Skenario | `includeFiles` | Catatan |
|----------|----------------|---------|
| Kirim PDF langsung ke WA | `true` | Response besar (beberapa MB jika 3 PDF). Timeout HTTP client minimal 60-120 detik. |
| Hanya teks + link | `false` | Response kecil, lebih cepat. User buka link manual. |
| PDF besar (>15 MB) | `false` atau fetch `downloadUrl` | Base64 tidak disertakan; `fileError` berisi penyebab. |

Batas ukuran file per PDF di response base64: **15 MB** (konfigurasi server: `WHATSAPP_FILE_MAX_BYTES`, default `15728640`).

---

## Error handling

Semua error (kecuali download sukses) mengembalikan JSON `{ "error": "..." }`.

| HTTP | Kondisi | Contoh `error` |
|------|---------|----------------|
| 400 | `question` kosong | `Pertanyaan tidak boleh kosong` |
| 400 | `question` > 2000 karakter | `Pertanyaan terlalu panjang (max 2000 karakter)` |
| 400 | ID dokumen invalid (download) | `Invalid document id` |
| 403 | Dokumen tidak milik user integrasi (download) | `Forbidden` |
| 404 | User integrasi tidak ada di DB | `User integrasi tidak ditemukan: triando@gmail.com` |
| 404 | `conversationId` tidak valid | `Conversation not found` |
| 404 | Dokumen tidak ada (download) | `Not found` |
| 429 | Rate limit chat | `Batas pertanyaan tercapai. Coba lagi dalam N detik.` |
| 502 | Gagal OpenAI / internal | Pesan error teknis (potong untuk user WA) |

**Saran untuk user WA:**

- 429 → "Mohon tunggu beberapa menit sebelum bertanya lagi."
- 502 → "Layanan DocSearch sementara tidak tersedia. Coba lagi nanti."
- 404 conversation → reset mapping, buat conversation baru.

---

## Rate limit dan performa

| Item | Nilai |
|------|--------|
| Rate limit | 60 request POST chat / jam per user integrasi |
| Window | Rolling 1 jam (in-memory per instance app) |
| Latency chat tipikal | 5-30 detik (tergantung pertanyaan dan jumlah dokumen) |
| Latency dengan `includeFiles: true` | +5-15 detik (fetch PDF dari Paperless) |
| Max dokumen rujukan | 3 |
| Max panjang pertanyaan | 2000 karakter |
| History multi-turn | 10 pesan terakhir (user + assistant) |

Service WhatsApp harus:

- Set HTTP timeout **≥ 120 detik** untuk POST chat dengan `includeFiles: true`
- Menampilkan indikator "memproses" ke user WA selama menunggu
- Menangani 429 dengan retry setelah `retryAfterSec` (dari pesan error)

---

## Keamanan

**Status saat ini: endpoint terbuka tanpa API key atau token.**

Siapa pun yang bisa mengakses URL production dapat:

- Menggunakan Ask AI (terbatas rate limit)
- Download PDF milik user integrasi

Ini disengaja untuk mempercepat integrasi awal. Untuk produksi jangka panjang, disarankan salah satu:

- API key di header (perlu implementasi di DocSearch)
- Whitelist IP service WhatsApp
- Reverse proxy dengan autentikasi

Tim DocSearch dapat menambahkan autentikasi setelah service WhatsApp siap; dokumentasi akan diperbarui.

---

## Konfigurasi server (tim DocSearch)

Variabel di `.env` production (bukan untuk service WhatsApp):

| Variabel | Default | Deskripsi |
|----------|---------|-----------|
| `WHATSAPP_USER_EMAIL` | `triando@gmail.com` | Email user portal yang dipakai integrasi. |
| `WHATSAPP_FILE_MAX_BYTES` | `15728640` (15 MB) | Batas byte per PDF di `fileBase64`. |
| `NEXTAUTH_URL` | - | Dipakai untuk membangun `downloadUrl` di response. Harus sesuai URL publik (`http://103.58.100.237:3002`). |

User integrasi harus sudah terdaftar di portal dan memiliki dokumen yang sudah di-sync + OCR dari Cloud Bappenas.

---

## Troubleshooting

| Gejala | Kemungkinan penyebab | Tindakan |
|--------|----------------------|----------|
| 404 user integrasi | Email tidak ada di DB portal | Tim DocSearch cek user `WHATSAPP_USER_EMAIL` |
| `documents: []` selalu | Arsip belum sync/OCR untuk user | Tim DocSearch cek status sync di portal |
| `fileIncluded: false`, file besar | PDF > 15 MB | Pakai `downloadUrl` atau naikkan `WHATSAPP_FILE_MAX_BYTES` |
| Timeout di service WA | Chat + 3 PDF lambat | Naikkan timeout client; atau `includeFiles: false` |
| `downloadUrl` hostname salah | `NEXTAUTH_URL` tidak sesuai | Tim DocSearch perbaiki env |
| 429 sering | Terlalu banyak request | Throttle di service WA; tunggu 1 jam |

---

## Checklist go-live (service WhatsApp)

- [ ] HTTP client timeout ≥ 120 detik untuk POST chat
- [ ] Mapping `waChatId` → `conversationId` (persisten atau TTL sesuai kebutuhan)
- [ ] Kirim `answer` sebelum file PDF
- [ ] Handle `documents` kosong (jawaban tetap valid)
- [ ] Handle `fileIncluded: false` (fallback link atau skip file)
- [ ] Pesan error ramah untuk user WA (429, 502, timeout)
- [ ] Health check periodik ke `GET /api/health`
- [ ] (Opsional) Rate limit di sisi WA agar tidak memicu 429 DocSearch

---

## Changelog

| Tanggal | Perubahan |
|---------|-----------|
| 2026-08-28 | Dokumen awal: POST chat, GET download, `includeFiles` + `fileBase64` default `true`, max 3 dokumen, user tetap `triando@gmail.com`, tanpa API key. |

---

## Kontak

Perubahan API, issue production, atau penambahan autentikasi: hubungi tim DocSearch (pemilik repo `ocr-paperless`).

Service WhatsApp: repo `simple-whatsapp-api` (terpisah). Integrasi hanya lewat endpoint di dokumen ini.
