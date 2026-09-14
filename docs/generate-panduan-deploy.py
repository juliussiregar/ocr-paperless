#!/usr/bin/env python3
"""Buat PDF panduan deploy DocSearch untuk operator server client."""

from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "Panduan-Deploy-DocSearch.pdf"

INK = colors.HexColor("#1a1a1a")
MUTED = colors.HexColor("#555555")
LINE = colors.HexColor("#cccccc")
TEAL = colors.HexColor("#0d5c56")
SOFT = colors.HexColor("#f4f7f6")
WARN_BG = colors.HexColor("#fff8e8")
WARN_INK = colors.HexColor("#7a4e00")
CODE_BG = colors.HexColor("#f0f0f0")


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=22,
            textColor=INK,
            spaceAfter=6,
        ),
        "sub": ParagraphStyle(
            "sub",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=MUTED,
            spaceAfter=16,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=17,
            textColor=TEAL,
            spaceBefore=16,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=INK,
            spaceBefore=12,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=INK,
            alignment=TA_JUSTIFY,
            spaceAfter=8,
        ),
        "li": ParagraphStyle(
            "li",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=13,
            textColor=INK,
        ),
        "code": ParagraphStyle(
            "code",
            parent=base["Code"],
            fontName="Courier",
            fontSize=8.5,
            leading=11,
            textColor=INK,
            backColor=CODE_BG,
            leftIndent=4,
            rightIndent=4,
            spaceBefore=4,
            spaceAfter=10,
        ),
        "note": ParagraphStyle(
            "note",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13,
            textColor=WARN_INK,
            spaceAfter=8,
        ),
        "footer": ParagraphStyle(
            "footer",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
        "th": ParagraphStyle(
            "th",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            textColor=INK,
        ),
        "td": ParagraphStyle(
            "td",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=INK,
        ),
    }


def bullets(items, s):
    return ListFlowable(
        [ListItem(Paragraph(i, s["li"]), leftIndent=8, bulletColor=TEAL) for i in items],
        bulletType="bullet",
        start="-",
        leftIndent=12,
        spaceBefore=2,
        spaceAfter=8,
    )


def code_block(text, s):
    return Preformatted(text.strip("\n"), s["code"])


def table(rows, col_widths):
    data = []
    for i, row in enumerate(rows):
        style = "th" if i == 0 else "td"
        # styles passed later - build with Paragraph outside
        data.append(row)
    t = Table(data, colWidths=col_widths, hAlign="LEFT")
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), SOFT),
                ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.4, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return t


def build():
    s = styles()
    story = []

    story.append(Paragraph("Panduan Deploy DocSearch", s["title"]))
    story.append(
        Paragraph(
            "Dokumen internal untuk operator server. Versi ringkas: instalasi pertama, "
            "update setelah git pull, dan pengecekan.",
            s["sub"],
        )
    )

    story.append(Paragraph("1. Ringkasan", s["h1"]))
    story.append(
        Paragraph(
            "DocSearch adalah portal OCR dan pencarian dokumen Cloud Bappenas. "
            "Di server, seluruh layanan dijalankan dengan Docker Compose. "
            "Portal diakses lewat port aplikasi (default 3002). "
            "Postgres, Redis, dan Paperless hanya bind ke localhost.",
            s["body"],
        )
    )
    story.append(
        Paragraph(
            "Perintah utama: <b>./scripts/client-up.sh</b> (setara dengan server-up.sh).",
            s["body"],
        )
    )

    story.append(Paragraph("2. Prasyarat server", s["h1"]))
    story.append(
        bullets(
            [
                "Docker Engine dan plugin Docker Compose",
                "RAM disarankan 8 GB atau lebih (OCR butuh memori)",
                "Firewall: buka hanya port portal (APP_PORT, default 3002)",
                "Akses shell ke folder repository setelah clone / pull",
            ],
            s,
        )
    )

    story.append(Paragraph("3. Instalasi pertama", s["h1"]))
    story.append(Paragraph("3.1 Salin dan isi environment", s["h2"]))
    story.append(code_block("cd /path/ke/ocr-paperless\ncp .env.example .env\nnano .env", s))
    story.append(
        Paragraph(
            "Isi semua nilai <b>change-me</b> dan ganti <b>SERVER_IP</b>. "
            "Jangan biarkan placeholder. Ringkasan field wajib:",
            s["body"],
        )
    )

    story.append(
        table(
            [
                [Paragraph("Variabel", s["th"]), Paragraph("Catatan", s["th"])],
                [
                    Paragraph("POSTGRES_PASSWORD", s["td"]),
                    Paragraph("Password kuat, hindari karakter @ : / # $", s["td"]),
                ],
                [
                    Paragraph("PAPERLESS_SECRET_KEY", s["td"]),
                    Paragraph("String acak panjang", s["td"]),
                ],
                [
                    Paragraph("PAPERLESS_ADMIN_PASSWORD", s["td"]),
                    Paragraph("Login admin Paperless", s["td"]),
                ],
                [
                    Paragraph("NEXTAUTH_URL", s["td"]),
                    Paragraph("URL publik portal, contoh http://IP:3002", s["td"]),
                ],
                [
                    Paragraph("NEXTAUTH_SECRET", s["td"]),
                    Paragraph("String acak", s["td"]),
                ],
                [
                    Paragraph("ENCRYPTION_KEY", s["td"]),
                    Paragraph("Minimal 32 karakter. Jangan diganti setelah ada data", s["td"]),
                ],
                [
                    Paragraph("ADMIN_EMAIL / ADMIN_PASSWORD", s["td"]),
                    Paragraph("Login portal (password minimal 8 karakter)", s["td"]),
                ],
                [
                    Paragraph("OPENAI_API_KEY", s["td"]),
                    Paragraph("Wajib jika memakai Tanya Arsip dan indeks pencarian", s["td"]),
                ],
                [
                    Paragraph("PAPERLESS_API_TOKEN", s["td"]),
                    Paragraph("Kosong dulu. Diisi setelah Paperless hidup (lihat bagian 4)", s["td"]),
                ],
                [
                    Paragraph("COMPOSE_PROFILES", s["td"]),
                    Paragraph("Harus berisi prod agar service portal ikut naik", s["td"]),
                ],
            ],
            [5.2 * cm, 11.5 * cm],
        )
    )
    story.append(Spacer(1, 8))

    story.append(Paragraph("3.2 Build dan jalankan", s["h2"]))
    story.append(code_block("chmod +x scripts/*.sh\n./scripts/client-up.sh", s))
    story.append(
        Paragraph(
            "Script akan memvalidasi .env, menambah COMPOSE_PROFILES=prod bila perlu, "
            "lalu build dan menjalankan container. Build dibuat serial agar VPS 8 GB "
            "tidak kehabisan memori.",
            s["body"],
        )
    )

    story.append(Paragraph("3.3 Cek cepat", s["h2"]))
    story.append(
        code_block(
            "docker compose ps\n"
            "curl -s http://127.0.0.1:3002/api/health\n"
            "./scripts/verify-up.sh",
            s,
        )
    )
    story.append(
        Paragraph(
            "Arti exit code verify-up.sh: <b>0</b> siap dipakai penuh; "
            "<b>2</b> portal hidup tapi token Paperless atau kunci OpenAI belum lengkap; "
            "<b>1</b> health gagal.",
            s["body"],
        )
    )

    story.append(Paragraph("4. Token Paperless (sekali)", s["h1"]))
    story.append(
        Paragraph(
            "Tanpa token ini, OCR di Paperless bisa jalan, tetapi sinkron status ke portal "
            "tidak lengkap. Lakukan setelah instalasi pertama:",
            s["body"],
        )
    )
    story.append(
        bullets(
            [
                "Dari laptop (opsional): ssh -L 8000:127.0.0.1:8000 user@SERVER",
                "Buka http://127.0.0.1:8000",
                "Login dengan PAPERLESS_ADMIN_USER / PAPERLESS_ADMIN_PASSWORD",
                "Profile, lalu API Auth Tokens, lalu Create",
                "Paste token ke .env sebagai PAPERLESS_API_TOKEN=...",
                "Jalankan perintah recreate di bawah",
            ],
            s,
        )
    )
    story.append(
        code_block(
            "docker compose up -d --force-recreate app sync-worker\n./scripts/verify-up.sh",
            s,
        )
    )

    story.append(Paragraph("5. Update setelah git pull", s["h1"]))
    story.append(
        code_block(
            "cd /path/ke/ocr-paperless\n"
            "git pull --ff-only\n"
            "./scripts/client-up.sh\n"
            "./scripts/verify-up.sh",
            s,
        )
    )
    story.append(
        Paragraph(
            "<b>Jangan</b> menjalankan <font face='Courier'>cp .env.example .env</font> "
            "di server yang sudah berjalan. Itu menimpa password dan kunci yang sudah dipakai. "
            "Jika ada variabel baru di contoh env, salin hanya baris yang diperlukan ke .env lama.",
            s["body"],
        )
    )

    story.append(Paragraph("6. Port default", s["h1"]))
    story.append(
        table(
            [
                [Paragraph("Layanan", s["th"]), Paragraph("Port host", s["th"])],
                [Paragraph("Portal DocSearch", s["td"]), Paragraph("APP_PORT (default 3002), publik", s["td"])],
                [Paragraph("Postgres", s["td"]), Paragraph("127.0.0.1:5434", s["td"])],
                [Paragraph("Redis", s["td"]), Paragraph("127.0.0.1:6380", s["td"])],
                [Paragraph("Paperless", s["td"]), Paragraph("127.0.0.1:8000 (localhost saja)", s["td"])],
            ],
            [6 * cm, 10.7 * cm],
        )
    )
    story.append(Spacer(1, 8))

    story.append(Paragraph("7. Endpoint yang perlu diketahui", s["h1"]))
    story.append(
        Paragraph(
            "Untuk operasional sehari-hari cukup ini. Tidak perlu menyentuh API internal lain.",
            s["body"],
        )
    )
    story.append(
        table(
            [
                [Paragraph("URL", s["th"]), Paragraph("Kegunaan", s["th"])],
                [
                    Paragraph("NEXTAUTH_URL (browser)", s["td"]),
                    Paragraph("Login portal, Library, Search, Tanya Arsip", s["td"]),
                ],
                [
                    Paragraph("http://127.0.0.1:APP_PORT/api/health", s["td"]),
                    Paragraph("Cek status database, redis, dan konfigurasi dasar", s["td"]),
                ],
                [
                    Paragraph("http://127.0.0.1:8000", s["td"]),
                    Paragraph("Admin Paperless (hanya lewat localhost / SSH tunnel)", s["td"]),
                ],
            ],
            [7.5 * cm, 9.2 * cm],
        )
    )
    story.append(Spacer(1, 8))

    story.append(Paragraph("8. Yang tidak boleh dilakukan", s["h1"]))
    story.append(
        bullets(
            [
                "Menganggap selesai hanya karena container berstatus Up, tanpa verify-up dan token Paperless",
                "Membuka Postgres, Redis, atau Paperless ke internet",
                "Mengganti POSTGRES_PASSWORD setelah database sudah terisi",
                "Mengganti ENCRYPTION_KEY setelah ada kredensial Cloud tersimpan",
                "Menjalankan docker compose down -v kecuali sengaja menghapus seluruh data",
                "Membangun image di laptop lalu memindahkan ke server (build dilakukan di server)",
            ],
            s,
        )
    )

    story.append(Paragraph("9. Masalah yang sering muncul", s["h1"]))
    story.append(
        table(
            [
                [Paragraph("Gejala", s["th"]), Paragraph("Periksa", s["th"])],
                [
                    Paragraph("Script berhenti di awal", s["td"]),
                    Paragraph("Masih ada change-me atau SERVER_IP di .env", s["td"]),
                ],
                [
                    Paragraph("Portal tidak terbuka", s["td"]),
                    Paragraph("COMPOSE_PROFILES=prod, APP_PORT, firewall, docker compose ps", s["td"]),
                ],
                [
                    Paragraph("Login gagal dari luar", s["td"]),
                    Paragraph("NEXTAUTH_URL harus memakai IP/domain publik, bukan localhost", s["td"]),
                ],
                [
                    Paragraph("Tanya Arsip tidak menjawab", s["td"]),
                    Paragraph("OPENAI_API_KEY, lalu recreate app", s["td"]),
                ],
                [
                    Paragraph("OCR tidak masuk ke portal", s["td"]),
                    Paragraph("PAPERLESS_API_TOKEN, recreate app dan sync-worker", s["td"]),
                ],
                [
                    Paragraph("Build gagal / server berat", s["td"]),
                    Paragraph("RAM rendah. Pastikan COMPOSE_PARALLEL_LIMIT=1, pertimbangkan swap", s["td"]),
                ],
            ],
            [6.2 * cm, 10.5 * cm],
        )
    )
    story.append(Spacer(1, 10))

    story.append(Paragraph("10. Checklist singkat sebelum serah terima", s["h1"]))
    story.append(
        bullets(
            [
                "verify-up.sh exit 0",
                "Login portal dengan ADMIN_EMAIL berhasil",
                "Paperless token terisi",
                "OPENAI_API_KEY terisi (jika Tanya Arsip dipakai)",
                "Uji ambil 1 sampai 2 PDF, tunggu OCR selesai, coba Search dan Tanya Arsip",
            ],
            s,
        )
    )

    story.append(Spacer(1, 14))
    story.append(
        Paragraph(
            "File terkait di repository: docs/client-deploy.md, .env.example, "
            ".env.example.full (opsi lanjut). Log: docker compose logs -f",
            s["sub"],
        )
    )

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.4)
        canvas.line(2 * cm, 1.4 * cm, A4[0] - 2 * cm, 1.4 * cm)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(2 * cm, 0.9 * cm, "DocSearch - Panduan Deploy")
        canvas.drawRightString(A4[0] - 2 * cm, 0.9 * cm, f"Halaman {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=1.8 * cm,
        bottomMargin=2 * cm,
        title="Panduan Deploy DocSearch",
        author="DocSearch",
    )
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
