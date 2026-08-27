#!/usr/bin/env python3
"""Sales presentation for DocSearch – clearer visuals, high-level tech, 8GB RAM."""

from __future__ import annotations

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

OUT = Path(__file__).resolve().parent

# Palette
TEAL = RGBColor(11, 110, 99)
TEAL2 = RGBColor(15, 140, 125)
TEAL_DEEP = RGBColor(6, 70, 64)
TEAL_SOFT = RGBColor(232, 245, 243)
TEAL_MID = RGBColor(167, 214, 206)
INK = RGBColor(30, 41, 59)
MUTED = RGBColor(100, 116, 139)
WHITE = RGBColor(255, 255, 255)
CREAM = RGBColor(250, 250, 248)
AMBER = RGBColor(194, 120, 32)
AMBER_SOFT = RGBColor(255, 243, 224)
SKY = RGBColor(14, 116, 144)
SKY_SOFT = RGBColor(224, 242, 254)
SLATE = RGBColor(241, 245, 249)
ROSE = RGBColor(190, 70, 70)
ROSE_SOFT = RGBColor(254, 226, 226)

PDF_TEAL = colors.HexColor("#0B6E63")
PDF_SOFT = colors.HexColor("#E8F5F3")
PDF_INK = colors.HexColor("#1E293B")
PDF_MUTED = colors.HexColor("#64748B")
PDF_AMBER = colors.HexColor("#C27820")
PDF_SKY = colors.HexColor("#0E7490")
PDF_WHITE = colors.white


def set_bg(slide, rgb):
    f = slide.background.fill
    f.solid()
    f.fore_color.rgb = rgb


def shape_fill(shape, rgb, line=None, line_w=1.0):
    shape.fill.solid()
    shape.fill.fore_color.rgb = rgb
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = Pt(line_w)


def round_rect(slide, l, t, w, h, fill, line=None, adj=0.1):
    s = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, l, t, w, h)
    shape_fill(s, fill, line)
    try:
        s.adjustments[0] = adj
    except Exception:
        pass
    return s


def oval(slide, l, t, w, h, fill, line=None):
    s = slide.shapes.add_shape(MSO_SHAPE.OVAL, l, t, w, h)
    shape_fill(s, fill, line)
    return s


def chevron(slide, l, t, w, h, fill):
    s = slide.shapes.add_shape(MSO_SHAPE.CHEVRON, l, t, w, h)
    shape_fill(s, fill)
    return s


def arrow_right(slide, l, t, w, h, fill=TEAL):
    s = slide.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, l, t, w, h)
    shape_fill(s, fill)
    return s


def down_arrow(slide, l, t, w, h, fill=TEAL):
    s = slide.shapes.add_shape(MSO_SHAPE.DOWN_ARROW, l, t, w, h)
    shape_fill(s, fill)
    return s


def txt(
    slide,
    l,
    t,
    w,
    h,
    text,
    *,
    size=14,
    bold=False,
    color=INK,
    align=PP_ALIGN.LEFT,
    font="Calibri",
):
    box = slide.shapes.add_textbox(l, t, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(size)
    p.font.bold = bold
    p.font.color.rgb = color
    p.font.name = font
    p.alignment = align
    return box


def multilines(slide, l, t, w, h, lines, *, size=14, color=INK, bold_idx=None, align=PP_ALIGN.LEFT, gap=8):
    box = slide.shapes.add_textbox(l, t, w, h)
    tf = box.text_frame
    tf.word_wrap = True
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = line
        p.font.size = Pt(size)
        p.font.bold = bold_idx is not None and i in bold_idx
        p.font.color.rgb = color
        p.font.name = "Calibri"
        p.alignment = align
        p.space_after = Pt(gap)
    return box


def footer(slide, n, total, light=False):
    # left brand
    txt(slide, Inches(0.55), Inches(7.05), Inches(3), Inches(0.28), "DocSearch", size=10, bold=True, color=WHITE if light else TEAL)
    # right page
    t = txt(slide, Inches(11.4), Inches(7.05), Inches(1.5), Inches(0.28), f"{n} / {total}", size=10, color=WHITE if light else MUTED, align=PP_ALIGN.RIGHT)
    return t


def title_block(slide, title, subtitle=None):
    txt(slide, Inches(0.6), Inches(0.35), Inches(12), Inches(0.55), title, size=28, bold=True, color=TEAL_DEEP)
    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.6), Inches(0.95), Inches(0.9), Inches(0.07))
    shape_fill(bar, TEAL)
    if subtitle:
        txt(slide, Inches(0.6), Inches(1.15), Inches(12), Inches(0.4), subtitle, size=14, color=MUTED)


def connector_line(slide, x1, y1, x2, y2, color=TEAL_MID):
    """Simple thick line as connector using a thin rectangle."""
    # horizontal preferred
    if abs(y2 - y1) < abs(x2 - x1):
        left = min(x1, x2)
        top = y1 - Inches(0.03)
        w = abs(x2 - x1)
        h = Inches(0.06)
    else:
        left = x1 - Inches(0.03)
        top = min(y1, y2)
        w = Inches(0.06)
        h = abs(y2 - y1)
    r = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, w, h)
    shape_fill(r, color)
    return r


# ---------------------------------------------------------------------------
# Build PPTX
# ---------------------------------------------------------------------------

def build_pptx(path: Path) -> int:
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]
    slides = []

    # ========== 1 COVER ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, TEAL_DEEP)
    # decorative circles
    oval(s, Inches(-1.2), Inches(-1.5), Inches(4.5), Inches(4.5), TEAL)
    oval(s, Inches(11), Inches(4.5), Inches(3.5), Inches(3.5), TEAL)
    round_rect(s, Inches(0.8), Inches(2.0), Inches(8.5), Inches(0.12), TEAL2)
    txt(s, Inches(0.8), Inches(2.3), Inches(11), Inches(0.9), "DocSearch", size=52, bold=True, color=WHITE)
    txt(
        s,
        Inches(0.8),
        Inches(3.3),
        Inches(10),
        Inches(0.8),
        "Portal dokumen cerdas untuk organisasi",
        size=22,
        color=TEAL_SOFT,
    )
    txt(
        s,
        Inches(0.8),
        Inches(4.3),
        Inches(10),
        Inches(0.5),
        "Cloud  →  OCR  →  Cari  →  Tanya AI",
        size=16,
        color=TEAL_MID,
    )
    slides.append(s)

    # ========== 2 AGENDA ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Agenda singkat")
    agenda = [
        ("01", "Masalah & peluang"),
        ("02", "Nilai yang ditawarkan"),
        ("03", "Cara kerja & alur"),
        ("04", "Gambaran teknis & flow coding"),
        ("05", "Fitur untuk pengguna & admin"),
        ("06", "Infrastruktur & keamanan"),
        ("07", "Langkah selanjutnya"),
    ]
    for i, (num, label) in enumerate(agenda):
        col = i % 2
        row = i // 2
        left = Inches(0.7 + col * 6.2)
        top = Inches(1.7 + row * 1.15)
        round_rect(s, left, top, Inches(5.9), Inches(0.95), WHITE, TEAL_SOFT, 0.12)
        oval(s, left + Inches(0.25), top + Inches(0.22), Inches(0.5), Inches(0.5), TEAL)
        txt(s, left + Inches(0.25), top + Inches(0.3), Inches(0.5), Inches(0.4), num, size=12, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(1.0), top + Inches(0.3), Inches(4.5), Inches(0.45), label, size=18, bold=True, color=INK)
    slides.append(s)

    # ========== 3 PROBLEM ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Masalah di lapangan", "Dokumen ada, tapi sulit dimanfaatkan")
    problems = [
        (ROSE_SOFT, ROSE, "1", "Sulit dicari", "Nama file tidak mewakili isi.\nCari di cloud = tebak-tebakan."),
        (AMBER_SOFT, AMBER, "2", "Waktu terbuang", "Buka folder & PDF berulang.\nTim menunggu dokumen."),
        (SKY_SOFT, SKY, "3", "Belum siap AI", "Tanya isi dokumen masih\nmanual ke orang / baca sendiri."),
        (TEAL_SOFT, TEAL, "4", "Status tidak jelas", "Mana yang sudah di-OCR?\nMana yang kosong / rusak?"),
    ]
    for i, (bg, accent, num, title, body) in enumerate(problems):
        left = Inches(0.55 + i * 3.2)
        round_rect(s, left, Inches(1.85), Inches(3.0), Inches(4.5), bg, None, 0.08)
        oval(s, left + Inches(1.1), Inches(2.2), Inches(0.75), Inches(0.75), accent)
        txt(s, left + Inches(1.1), Inches(2.35), Inches(0.75), Inches(0.5), num, size=20, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.2), Inches(3.2), Inches(2.6), Inches(0.55), title, size=17, bold=True, color=INK, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.2), Inches(3.9), Inches(2.6), Inches(2.0), body, size=13, color=MUTED, align=PP_ALIGN.CENTER)
    slides.append(s)

    # ========== 4 SOLUTION ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Solusi DocSearch", "Satu portal untuk ambil, baca, cari, dan tanya dokumen")
    # big value strip
    round_rect(s, Inches(0.6), Inches(1.7), Inches(12.1), Inches(1.1), TEAL)
    txt(
        s,
        Inches(0.9),
        Inches(1.95),
        Inches(11.5),
        Inches(0.6),
        "Cloud organisasi  →  OCR otomatis  →  Indeks pintar  →  Search & Ask AI",
        size=18,
        bold=True,
        color=WHITE,
        align=PP_ALIGN.CENTER,
    )
    pillars = [
        ("Library", "Browse cloud\nlangsung di portal"),
        ("OCR", "PDF jadi teks\nyang bisa dicari"),
        ("Search", "Cari isi dokumen\nbukan hanya nama"),
        ("Ask AI", "Tanya jawaban\ndari dokumen"),
    ]
    for i, (t, b) in enumerate(pillars):
        left = Inches(0.6 + i * 3.15)
        round_rect(s, left, Inches(3.2), Inches(3.0), Inches(3.2), WHITE, TEAL_MID, 0.1)
        round_rect(s, left, Inches(3.2), Inches(3.0), Inches(0.7), TEAL if i % 2 == 0 else TEAL2)
        txt(s, left, Inches(3.35), Inches(3.0), Inches(0.45), t, size=16, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.2), Inches(4.3), Inches(2.6), Inches(1.6), b, size=15, color=INK, align=PP_ALIGN.CENTER)
    slides.append(s)

    # ========== 5 BEFORE / AFTER ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Sebelum vs sesudah")
    round_rect(s, Inches(0.55), Inches(1.7), Inches(5.9), Inches(4.8), ROSE_SOFT, None, 0.08)
    round_rect(s, Inches(6.85), Inches(1.7), Inches(5.9), Inches(4.8), TEAL_SOFT, None, 0.08)
    txt(s, Inches(0.8), Inches(2.0), Inches(5.4), Inches(0.5), "Sebelum", size=22, bold=True, color=ROSE)
    txt(s, Inches(7.1), Inches(2.0), Inches(5.4), Inches(0.5), "Dengan DocSearch", size=22, bold=True, color=TEAL)
    multilines(
        s,
        Inches(0.9),
        Inches(2.8),
        Inches(5.2),
        Inches(3.2),
        [
            "• Cari manual di cloud",
            "• Baca PDF satu per satu",
            "• Status OCR tidak diketahui",
            "• Tanya isi ke rekan / email",
            "• Risiko file kosong / rusak",
        ],
        size=16,
        color=INK,
        gap=12,
    )
    multilines(
        s,
        Inches(7.2),
        Inches(2.8),
        Inches(5.2),
        Inches(3.2),
        [
            "• Cari isi dokumen dalam detik",
            "• OCR & indeks otomatis",
            "• Status jelas di Library",
            "• Tanya AI langsung di portal",
            "• File 0 B & gagal terlihat",
        ],
        size=16,
        color=INK,
        gap=12,
    )
    slides.append(s)

    # ========== 6 FLOWCHART USER JOURNEY (clear) ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Alur pengguna", "Dari cloud sampai jawaban AI")

    steps = [
        ("1", "Login", "Masuk portal"),
        ("2", "Library", "Pilih folder\n& dokumen"),
        ("3", "Fetch", "Ambil & OCR"),
        ("4", "Siap", "Dokumen\nterindeks"),
        ("5", "Search", "Cari isi"),
        ("6", "Ask AI", "Tanya\njawaban"),
    ]
    y = Inches(2.4)
    for i, (num, title, body) in enumerate(steps):
        left = Inches(0.4 + i * 2.15)
        # card
        round_rect(s, left, y, Inches(1.95), Inches(3.5), WHITE, TEAL, 0.1)
        # number badge
        oval(s, left + Inches(0.6), y + Inches(0.25), Inches(0.7), Inches(0.7), TEAL)
        txt(s, left + Inches(0.6), y + Inches(0.38), Inches(0.7), Inches(0.5), num, size=18, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.1), y + Inches(1.2), Inches(1.75), Inches(0.45), title, size=15, bold=True, color=TEAL_DEEP, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.1), y + Inches(1.85), Inches(1.75), Inches(1.2), body, size=12, color=MUTED, align=PP_ALIGN.CENTER)
        if i < len(steps) - 1:
            arrow_right(s, left + Inches(1.95), y + Inches(1.5), Inches(0.22), Inches(0.28), TEAL2)
    slides.append(s)

    # ========== 7 FLOWCHART OCR PIPELINE ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Alur teknis dokumen", "Bagaimana file berubah menjadi pengetahuan")

    # Vertical-ish horizontal pipeline with clear labels
    pipeline = [
        (TEAL, "Cloud\nWebDAV", "Sumber PDF"),
        (TEAL2, "Portal &\nWorker", "Ambil file"),
        (SKY, "Mesin\nOCR", "Teks + meta"),
        (AMBER, "Indeks &\nEmbedding", "Siap dicari"),
        (TEAL_DEEP, "Search &\nAsk AI", "Hasil ke user"),
    ]
    for i, (color, title, note) in enumerate(pipeline):
        left = Inches(0.45 + i * 2.55)
        # big chevron-like card
        round_rect(s, left, Inches(2.0), Inches(2.35), Inches(2.6), color, None, 0.08)
        txt(s, left + Inches(0.1), Inches(2.4), Inches(2.15), Inches(1.2), title, size=16, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.1), Inches(3.8), Inches(2.15), Inches(0.5), note, size=12, color=TEAL_SOFT, align=PP_ALIGN.CENTER)
        if i < len(pipeline) - 1:
            arrow_right(s, left + Inches(2.35), Inches(3.05), Inches(0.22), Inches(0.3), TEAL_MID)

    # bottom status strip
    round_rect(s, Inches(0.55), Inches(5.1), Inches(12.2), Inches(1.4), WHITE, TEAL_MID, 0.08)
    txt(s, Inches(0.8), Inches(5.25), Inches(11.5), Inches(0.35), "Status file di sepanjang proses", size=13, bold=True, color=TEAL)
    statuses = ["Belum diambil", "Mengunduh", "OCR berjalan", "Siap", "Gagal / 0 B"]
    colors_s = [MUTED, SKY, AMBER, TEAL, ROSE]
    for i, (st, c) in enumerate(zip(statuses, colors_s)):
        left = Inches(0.9 + i * 2.4)
        oval(s, left, Inches(5.75), Inches(0.28), Inches(0.28), c)
        txt(s, left + Inches(0.4), Inches(5.72), Inches(1.9), Inches(0.35), st, size=12, color=INK)
    slides.append(s)

    # ========== 8 HIGH-LEVEL TECH ARCHITECTURE ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Gambaran besar teknis", "Komponen utama (tingkat tinggi)")

    # Layer 1 - users
    round_rect(s, Inches(4.5), Inches(1.55), Inches(4.3), Inches(0.85), TEAL)
    txt(s, Inches(4.5), Inches(1.7), Inches(4.3), Inches(0.55), "Pengguna (Browser)", size=15, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
    down_arrow(s, Inches(6.4), Inches(2.4), Inches(0.4), Inches(0.35), TEAL_MID)

    # Layer 2 - app
    round_rect(s, Inches(2.8), Inches(2.85), Inches(7.7), Inches(1.15), TEAL2)
    txt(s, Inches(2.8), Inches(2.95), Inches(7.7), Inches(0.4), "Portal Web DocSearch", size=16, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
    txt(s, Inches(2.8), Inches(3.4), Inches(7.7), Inches(0.4), "Login · Library · Search · Ask AI · Admin", size=12, color=TEAL_SOFT, align=PP_ALIGN.CENTER)
    down_arrow(s, Inches(6.4), Inches(4.05), Inches(0.4), Inches(0.3), TEAL_MID)

    # Layer 3 - 3 services
    services = [
        (0.7, TEAL_DEEP, "Worker Sync", "Ambil file dari\ncloud & antre OCR"),
        (4.75, SKY, "Mesin OCR", "Ubah PDF menjadi\nteks terstruktur"),
        (8.8, AMBER, "Layanan AI", "Embedding &\njawab pertanyaan"),
    ]
    for left, color, title, body in services:
        round_rect(s, Inches(left), Inches(4.45), Inches(3.7), Inches(1.9), color, None, 0.08)
        txt(s, Inches(left + 0.15), Inches(4.65), Inches(3.4), Inches(0.45), title, size=15, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        txt(s, Inches(left + 0.2), Inches(5.25), Inches(3.3), Inches(0.85), body, size=12, color=WHITE, align=PP_ALIGN.CENTER)
    slides.append(s)

    # ========== 9 TECH DATA / STORAGE ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Di balik portal", "Apa yang disimpan & dihubungkan")

    cards = [
        (TEAL, "Database", ["User & peran", "Status sync file", "Riwayat chat", "Audit aktivitas"]),
        (SKY, "Penyimpanan OCR", ["Hasil teks PDF", "Preview dokumen", "Metadata file"]),
        (AMBER, "Antre & cache", ["Job scan batch", "Proses paralel", "Status real-time"]),
        (TEAL2, "Cloud sumber", ["Folder organisasi", "PDF asli", "Akses per user"]),
    ]
    for i, (color, title, items) in enumerate(cards):
        left = Inches(0.55 + i * 3.2)
        round_rect(s, left, Inches(1.75), Inches(3.0), Inches(4.7), WHITE, color, 0.08)
        round_rect(s, left, Inches(1.75), Inches(3.0), Inches(0.85), color)
        txt(s, left, Inches(1.95), Inches(3.0), Inches(0.5), title, size=16, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        multilines(
            s,
            left + Inches(0.3),
            Inches(2.9),
            Inches(2.4),
            Inches(3.2),
            [f"• {x}" for x in items],
            size=14,
            color=INK,
            gap=14,
        )
    slides.append(s)

    # ========== 10 THREE ACTORS (CODING) ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Tiga aktor di balik kode", "Siapa mengerjakan apa saat scan & OCR")

    actors = [
        (TEAL, "01", "Portal Next.js", "app/", [
            "UI Library, Search, Ask AI",
            "API: browse, ingest, chat",
            "Catat job & status di DB app",
        ]),
        (SKY, "02", "sync-worker", "sync-worker/", [
            "Ambil antrian Redis / BullMQ",
            "Download PDF dari Nextcloud",
            "Reconcile OCR & embedding",
        ]),
        (AMBER, "03", "Paperless-ngx", "Docker service", [
            "Baca PDF (OCR)",
            "Simpan file + teks hasil",
            "Sumber full-text search",
        ]),
    ]
    for i, (color, num, title, folder, items) in enumerate(actors):
        left = Inches(0.5 + i * 4.25)
        round_rect(s, left, Inches(1.7), Inches(4.05), Inches(5.0), WHITE, color, 0.08)
        round_rect(s, left, Inches(1.7), Inches(4.05), Inches(1.55), color)
        txt(s, left + Inches(0.25), Inches(1.9), Inches(0.6), Inches(0.4), num, size=14, bold=True, color=TEAL_SOFT)
        txt(s, left + Inches(0.25), Inches(2.25), Inches(3.55), Inches(0.45), title, size=18, bold=True, color=WHITE)
        txt(s, left + Inches(0.25), Inches(2.75), Inches(3.55), Inches(0.35), folder, size=12, color=TEAL_SOFT)
        multilines(
            s,
            left + Inches(0.35),
            Inches(3.6),
            Inches(3.4),
            Inches(2.8),
            [f"• {x}" for x in items],
            size=14,
            color=INK,
            gap=16,
        )
        if i < 2:
            arrow_right(s, left + Inches(4.05), Inches(3.9), Inches(0.2), Inches(0.28), TEAL_MID)
    slides.append(s)

    # ========== 11 CODING FLOW STEPS ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Flow coding dokumen", "Dari klik Ambil sampai siap dicari & ditanya")

    flow_steps = [
        ("1", "Browse", "UI list folder\nWebDAV Nextcloud"),
        ("2", "Ingest", "POST /api/\ncloud/ingest"),
        ("3", "Antri", "scan_jobs +\nBullMQ Redis"),
        ("4", "Download", "Worker unduh\n→ consume"),
        ("5", "OCR", "Paperless\nbaca PDF"),
        ("6", "Cocokkan", "checksum →\nOCR_DONE"),
        ("7", "Siap AI", "embedding +\nSearch / Ask"),
    ]
    for i, (num, title, body) in enumerate(flow_steps):
        left = Inches(0.28 + i * 1.86)
        round_rect(s, left, Inches(1.85), Inches(1.72), Inches(4.55), WHITE, TEAL_MID, 0.1)
        oval(s, left + Inches(0.51), Inches(2.1), Inches(0.7), Inches(0.7), TEAL if i < 5 else TEAL_DEEP)
        txt(s, left + Inches(0.51), Inches(2.25), Inches(0.7), Inches(0.45), num, size=16, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.08), Inches(3.0), Inches(1.56), Inches(0.5), title, size=13, bold=True, color=TEAL_DEEP, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.08), Inches(3.6), Inches(1.56), Inches(2.2), body, size=11, color=MUTED, align=PP_ALIGN.CENTER)
        if i < len(flow_steps) - 1:
            arrow_right(s, left + Inches(1.72), Inches(3.85), Inches(0.16), Inches(0.24), TEAL2)

    round_rect(s, Inches(0.5), Inches(6.55), Inches(12.3), Inches(0.4), TEAL_SOFT)
    txt(
        s,
        Inches(0.7),
        Inches(6.58),
        Inches(12),
        Inches(0.35),
        "Satu kalimat: UI buat job → worker unduh → Paperless OCR → reconcile → Search / Ask AI",
        size=12,
        bold=True,
        color=TEAL,
        align=PP_ALIGN.CENTER,
    )
    slides.append(s)

    # ========== 12 STATUS + STORAGE ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Status file & tempat data", "sync_files + di mana hasil OCR tinggal")

    # Left: status chain
    round_rect(s, Inches(0.5), Inches(1.65), Inches(6.3), Inches(5.1), WHITE, TEAL_MID, 0.08)
    txt(s, Inches(0.75), Inches(1.85), Inches(5.8), Inches(0.4), "Status di tabel sync_files", size=16, bold=True, color=TEAL)
    statuses_flow = [
        ("DISCOVERED", MUTED, "File dipilih / ditemukan"),
        ("DOWNLOADING", SKY, "Sedang diunduh WebDAV"),
        ("QUEUED", TEAL2, "Masuk folder consume"),
        ("OCR_PENDING", AMBER, "Menunggu Paperless"),
        ("OCR_DONE", TEAL, "Siap search & Ask AI"),
    ]
    for i, (name, color, note) in enumerate(statuses_flow):
        top = Inches(2.4 + i * 0.8)
        oval(s, Inches(0.85), top + Inches(0.08), Inches(0.32), Inches(0.32), color)
        txt(s, Inches(1.35), top, Inches(2.6), Inches(0.4), name, size=13, bold=True, color=INK)
        txt(s, Inches(4.0), top, Inches(2.5), Inches(0.4), note, size=12, color=MUTED)
        if i < len(statuses_flow) - 1:
            connector_line(
                s,
                Inches(1.0),
                top + Inches(0.45),
                Inches(1.0),
                top + Inches(0.75),
                TEAL_MID,
            )

    # Right: where data lives
    round_rect(s, Inches(7.05), Inches(1.65), Inches(5.75), Inches(5.1), WHITE, TEAL, 0.08)
    txt(s, Inches(7.3), Inches(1.85), Inches(5.3), Inches(0.4), "Di mana data disimpan?", size=16, bold=True, color=TEAL)
    stores = [
        (TEAL2, "Nextcloud", "PDF asli (sumber)"),
        (SKY, "Paperless media + DB", "File olahan + teks OCR"),
        (AMBER, "Postgres DB app", "sync_files, scan_jobs, chat"),
        (TEAL_DEEP, "document_chunks", "Potongan teks + embedding AI"),
    ]
    for i, (color, title, body) in enumerate(stores):
        top = Inches(2.45 + i * 1.0)
        round_rect(s, Inches(7.35), top, Inches(5.2), Inches(0.85), color, None, 0.1)
        txt(s, Inches(7.55), top + Inches(0.12), Inches(4.8), Inches(0.32), title, size=13, bold=True, color=WHITE)
        txt(s, Inches(7.55), top + Inches(0.45), Inches(4.8), Inches(0.3), body, size=12, color=TEAL_SOFT)
    slides.append(s)

    # ========== 13 FEATURES USER ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Fitur untuk pengguna", "Yang dipakai sehari-hari")
    feats = [
        ("Ask AI", "Tanya dokumen dengan bahasa biasa, jawaban dari isi OCR."),
        ("Search", "Pencarian isi dokumen + ringkasan hasil."),
        ("Library", "Browse cloud, favorit folder, batch ambil & OCR."),
        ("Preview", "Baca PDF di panel yang bisa digeser lebarnya."),
        ("Recent", "Daftar hasil scan terbaru dengan size & tanggal."),
        ("Status jelas", "Pending, proses, siap, gagal, dan file 0 B."),
    ]
    for i, (t, b) in enumerate(feats):
        col = i % 3
        row = i // 3
        left = Inches(0.55 + col * 4.2)
        top = Inches(1.7 + row * 2.45)
        round_rect(s, left, top, Inches(4.0), Inches(2.2), WHITE, TEAL_SOFT, 0.1)
        round_rect(s, left, top, Inches(0.16), Inches(2.2), TEAL)
        txt(s, left + Inches(0.4), top + Inches(0.35), Inches(3.4), Inches(0.45), t, size=17, bold=True, color=TEAL)
        txt(s, left + Inches(0.4), top + Inches(0.95), Inches(3.4), Inches(1.0), b, size=13, color=MUTED)
    slides.append(s)

    # ========== 11 FEATURES ADMIN ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Fitur untuk admin", "Kontrol organisasi tanpa rumit")
    admin_feats = [
        ("User management", "Tambah & edit user lewat dialog.\nRole Admin / User, kredensial cloud."),
        ("Audit aktivitas", "Lihat pemakaian search & Ask AI.\nFilter waktu, estimasi biaya AI."),
        ("Auto scan", "Jadwal scan folder favorit.\nBisa dinyalakan / dimatikan."),
        ("Isolasi data", "Setiap user hanya dokumennya.\nAman untuk multi-pegawai."),
    ]
    for i, (t, b) in enumerate(admin_feats):
        col = i % 2
        row = i // 2
        left = Inches(0.6 + col * 6.3)
        top = Inches(1.7 + row * 2.45)
        filled = (i % 2) == (row % 2)
        if filled:
            round_rect(s, left, top, Inches(6.0), Inches(2.2), TEAL, None, 0.1)
            tc, bc = WHITE, TEAL_SOFT
        else:
            round_rect(s, left, top, Inches(6.0), Inches(2.2), WHITE, TEAL_MID, 0.1)
            tc, bc = TEAL, MUTED
        txt(s, left + Inches(0.4), top + Inches(0.4), Inches(5.2), Inches(0.5), t, size=18, bold=True, color=tc)
        txt(s, left + Inches(0.4), top + Inches(1.05), Inches(5.2), Inches(0.9), b, size=14, color=bc)
    slides.append(s)

    # ========== 12 INFRASTRUCTURE 8GB ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Infrastruktur yang direkomendasikan", "Satu server aplikasi, spek praktis")

    # Hero RAM callout
    round_rect(s, Inches(0.6), Inches(1.65), Inches(12.1), Inches(1.35), TEAL)
    txt(s, Inches(0.9), Inches(1.85), Inches(11.5), Inches(0.45), "Rekomendasi utama: RAM 8 GB", size=24, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
    txt(
        s,
        Inches(0.9),
        Inches(2.4),
        Inches(11.5),
        Inches(0.4),
        "Stabil untuk portal + OCR + antrean dalam satu mesin",
        size=14,
        color=TEAL_SOFT,
        align=PP_ALIGN.CENTER,
    )

    specs = [
        ("CPU", "4 vCPU", "Portal & proses OCR"),
        ("RAM", "8 GB", "Rekomendasi utama"),
        ("Disk", "100+ GB SSD", "Dokumen & indeks"),
        ("Akses", "HTTPS", "Portal aman di browser"),
    ]
    for i, (k, v, note) in enumerate(specs):
        left = Inches(0.6 + i * 3.15)
        round_rect(s, left, Inches(3.35), Inches(3.0), Inches(3.0), WHITE, TEAL_MID, 0.1)
        txt(s, left + Inches(0.15), Inches(3.6), Inches(2.7), Inches(0.35), k, size=12, color=MUTED, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.15), Inches(4.15), Inches(2.7), Inches(0.7), v, size=22, bold=True, color=TEAL, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.2), Inches(5.1), Inches(2.6), Inches(0.8), note, size=13, color=INK, align=PP_ALIGN.CENTER)
    slides.append(s)

    # ========== 13 INFRA LAYOUT DIAGRAM ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Tata letak di server", "Semua komponen dalam satu lingkungan")

    # Outer server box
    round_rect(s, Inches(0.7), Inches(1.7), Inches(11.9), Inches(4.9), WHITE, TEAL, 0.06)
    txt(s, Inches(0.95), Inches(1.9), Inches(11), Inches(0.4), "Server aplikasi (8 GB RAM · 4 vCPU · SSD)", size=14, bold=True, color=TEAL)

    # Internal boxes
    inner = [
        (1.1, 2.5, 3.4, 1.7, TEAL, "Portal Web"),
        (4.9, 2.5, 3.4, 1.7, TEAL2, "Worker Sync"),
        (8.7, 2.5, 3.4, 1.7, SKY, "Mesin OCR"),
        (1.1, 4.55, 3.4, 1.6, AMBER, "Database"),
        (4.9, 4.55, 3.4, 1.6, TEAL_DEEP, "Antre / Cache"),
        (8.7, 4.55, 3.4, 1.6, MUTED, "Penyimpanan file"),
    ]
    for l, t, w, h, c, label in inner:
        round_rect(s, Inches(l), Inches(t), Inches(w), Inches(h), c, None, 0.1)
        txt(s, Inches(l), Inches(t + h / 2 - 0.2), Inches(w), Inches(0.45), label, size=15, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
    slides.append(s)

    # ========== 14 SECURITY ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Keamanan untuk organisasi", "Cukup jelas untuk keputusan, tanpa detail berlebih")
    secs = [
        ("Login & peran", "Admin dan user terpisah.\nAkses sesuai wewenang."),
        ("Data per user", "Dokumen tidak bercampur.\nSiap multi-pegawai."),
        ("Kredensial cloud", "Akses cloud per orang.\nDisimpan terenkripsi."),
        ("Jejak aktivitas", "Admin bisa audit.\nPemakaian AI terpantau."),
    ]
    for i, (t, b) in enumerate(secs):
        left = Inches(0.55 + i * 3.2)
        round_rect(s, left, Inches(1.9), Inches(3.05), Inches(4.3), TEAL_DEEP if i % 2 == 0 else TEAL)
        oval(s, left + Inches(1.1), Inches(2.4), Inches(0.8), Inches(0.8), WHITE)
        txt(s, left + Inches(1.1), Inches(2.55), Inches(0.8), Inches(0.5), str(i + 1), size=18, bold=True, color=TEAL, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.2), Inches(3.5), Inches(2.65), Inches(0.7), t, size=16, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.25), Inches(4.4), Inches(2.55), Inches(1.4), b, size=13, color=TEAL_SOFT, align=PP_ALIGN.CENTER)
    slides.append(s)

    # ========== 15 VALUE / WHY ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Mengapa cocok untuk organisasi", "Ringkas & operasional")
    reasons = [
        ("Cepat dipakai", "User langsung browse cloud,\ntidak perlu pindah file manual."),
        ("Skala bertahap", "Mulai dari unit kecil,\nlalu perluas folder & user."),
        ("Biaya terkendali", "Satu server 8 GB.\nAI dipakai sesuai kebutuhan."),
        ("Transparan", "Status OCR & audit\nterlihat jelas."),
    ]
    for i, (t, b) in enumerate(reasons):
        left = Inches(0.55 + i * 3.2)
        round_rect(s, left, Inches(1.9), Inches(3.05), Inches(4.3), WHITE, TEAL_MID, 0.1)
        round_rect(s, left, Inches(1.9), Inches(3.05), Inches(1.0), TEAL)
        txt(s, left, Inches(2.15), Inches(3.05), Inches(0.55), t, size=16, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.25), Inches(3.4), Inches(2.55), Inches(2.2), b, size=14, color=INK, align=PP_ALIGN.CENTER)
    slides.append(s)

    # ========== 16 NEXT STEPS ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, CREAM)
    title_block(s, "Langkah selanjutnya", "Dari demo sampai pakai")
    steps_n = [
        ("1", "Demo", "Lihat alur Library,\nSearch, dan Ask AI."),
        ("2", "Pilot", "1 unit / beberapa user\n+ folder prioritas."),
        ("3", "Ukur", "Waktu cari dokumen\n& kepuasan user."),
        ("4", "Rollout", "Perluas user &\nfolder kerja."),
    ]
    for i, (num, title, body) in enumerate(steps_n):
        left = Inches(0.55 + i * 3.2)
        round_rect(s, left, Inches(1.9), Inches(3.05), Inches(4.3), WHITE, TEAL, 0.1)
        oval(s, left + Inches(1.1), Inches(2.3), Inches(0.8), Inches(0.8), TEAL)
        txt(s, left + Inches(1.1), Inches(2.45), Inches(0.8), Inches(0.55), num, size=20, bold=True, color=WHITE, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.2), Inches(3.4), Inches(2.65), Inches(0.5), title, size=18, bold=True, color=TEAL, align=PP_ALIGN.CENTER)
        txt(s, left + Inches(0.25), Inches(4.2), Inches(2.55), Inches(1.5), body, size=14, color=MUTED, align=PP_ALIGN.CENTER)
        if i < 3:
            arrow_right(s, left + Inches(3.05), Inches(3.8), Inches(0.18), Inches(0.28), TEAL_MID)
    slides.append(s)

    # ========== 17 CLOSING ==========
    s = prs.slides.add_slide(blank)
    set_bg(s, TEAL_DEEP)
    oval(s, Inches(-1), Inches(5), Inches(3), Inches(3), TEAL)
    oval(s, Inches(11.5), Inches(-0.8), Inches(3), Inches(3), TEAL)
    txt(s, Inches(0.9), Inches(2.2), Inches(11.5), Inches(1.2), "Dokumen organisasi\nsiap ditemukan dan ditanyakan.", size=32, bold=True, color=WHITE)
    txt(s, Inches(0.9), Inches(3.8), Inches(11), Inches(0.5), "Demo singkat  ·  Pilot unit  ·  Rollout bertahap", size=18, color=TEAL_MID)
    txt(s, Inches(0.9), Inches(5.0), Inches(11), Inches(0.45), "DocSearch", size=18, bold=True, color=WHITE)
    slides.append(s)

    total = len(slides)
    for i, slide in enumerate(slides):
        footer(slide, i + 1, total, light=(i == 0 or i == total - 1))

    prs.save(str(path))
    return total


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

def build_pdf(path: Path) -> None:
    doc = SimpleDocTemplate(
        str(path),
        pagesize=landscape(A4),
        leftMargin=1.5 * cm,
        rightMargin=1.5 * cm,
        topMargin=1.3 * cm,
        bottomMargin=1.1 * cm,
        title="DocSearch Presentasi",
        author="DocSearch",
    )
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=24, textColor=PDF_TEAL, spaceAfter=8)
    sub = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=12, textColor=PDF_MUTED, spaceAfter=12, leading=16)
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=11, textColor=PDF_INK, spaceAfter=6, leading=15)
    cover = ParagraphStyle("Cover", parent=styles["Title"], fontSize=34, textColor=PDF_TEAL, alignment=TA_CENTER, spaceAfter=14)
    cover_sub = ParagraphStyle("CS", parent=styles["Normal"], fontSize=15, textColor=PDF_MUTED, alignment=TA_CENTER, spaceAfter=8)
    center = ParagraphStyle("Ctr", parent=styles["Normal"], fontSize=11, textColor=PDF_INK, alignment=TA_CENTER, leading=14)

    story = []

    def card_row(items, bg=PDF_SOFT):
        cells = [Paragraph(f"<b>{t}</b><br/>{b}", center) for t, b in items]
        t = Table([cells], colWidths=[24 * cm / len(items)] * len(items))
        t.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), bg),
                    ("BOX", (0, 0), (-1, -1), 0.5, PDF_TEAL),
                    ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#A7D6CE")),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("TOPPADDING", (0, 0), (-1, -1), 14),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ]
            )
        )
        return t

    # 1
    story += [Spacer(1, 2.2 * cm), Paragraph("DocSearch", cover),
              Paragraph("Portal dokumen cerdas untuk organisasi", cover_sub),
              Paragraph("Cloud → OCR → Cari → Tanya AI", cover_sub), PageBreak()]
    # 2
    story += [Paragraph("Agenda singkat", h1)]
    for i, a in enumerate(["Masalah & peluang", "Nilai yang ditawarkan", "Cara kerja & alur", "Gambaran teknis & flow coding", "Fitur user & admin", "Infrastruktur & keamanan", "Langkah selanjutnya"], 1):
        story.append(Paragraph(f"<b>{i:02d}</b>  {a}", body))
    story.append(PageBreak())
    # 3
    story += [Paragraph("Masalah di lapangan", h1), Paragraph("Dokumen ada, tapi sulit dimanfaatkan", sub)]
    story.append(card_row([
        ("Sulit dicari", "Isi file tidak searchable"),
        ("Waktu terbuang", "Buka PDF berulang"),
        ("Belum siap AI", "Tanya masih manual"),
        ("Status tidak jelas", "OCR / file 0 B"),
    ]))
    story.append(PageBreak())
    # 4
    story += [Paragraph("Solusi DocSearch", h1),
              Paragraph("Cloud organisasi → OCR otomatis → Indeks pintar → Search & Ask AI", sub)]
    story.append(card_row([("Library", "Browse cloud"), ("OCR", "PDF jadi teks"), ("Search", "Cari isi"), ("Ask AI", "Tanya jawaban")]))
    story.append(PageBreak())
    # 5
    story += [Paragraph("Sebelum vs sesudah", h1)]
    ba = Table([[
        Paragraph("<b>Sebelum</b><br/><br/>• Cari manual<br/>• Baca PDF satu-satu<br/>• Status OCR tidak jelas<br/>• Tanya ke rekan", body),
        Paragraph("<b>Dengan DocSearch</b><br/><br/>• Cari isi dalam detik<br/>• OCR otomatis<br/>• Status jelas<br/>• Tanya AI di portal", body),
    ]], colWidths=[12 * cm, 12 * cm])
    ba.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#FEE2E2")),
        ("BACKGROUND", (1, 0), (1, 0), PDF_SOFT),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ]))
    story += [ba, PageBreak()]
    # 6 flow
    story += [Paragraph("Alur pengguna", h1)]
    story.append(card_row([
        ("1 Login", "Masuk portal"),
        ("2 Library", "Pilih dokumen"),
        ("3 Fetch", "Ambil & OCR"),
        ("4 Siap", "Terindeks"),
        ("5 Search", "Cari isi"),
        ("6 Ask AI", "Tanya jawaban"),
    ]))
    story.append(PageBreak())
    # 7 tech flow
    story += [Paragraph("Alur teknis dokumen", h1)]
    story.append(card_row([
        ("Cloud WebDAV", "Sumber PDF"),
        ("Portal & Worker", "Ambil file"),
        ("Mesin OCR", "Teks + meta"),
        ("Indeks", "Siap dicari"),
        ("Search & AI", "Hasil ke user"),
    ], bg=colors.HexColor("#D1FAE5")))
    story.append(Spacer(1, 0.5 * cm))
    story.append(Paragraph("Status: Belum diambil → Mengunduh → OCR berjalan → Siap / Gagal / 0 B", body))
    story.append(PageBreak())
    # 8 architecture
    story += [Paragraph("Gambaran besar teknis", h1), Paragraph("Komponen utama tingkat tinggi", sub)]
    story.append(Paragraph("<b>Pengguna (Browser)</b>", center))
    story.append(Paragraph("↓", center))
    story.append(Paragraph("<b>Portal Web DocSearch</b> — Login · Library · Search · Ask AI · Admin", center))
    story.append(Paragraph("↓", center))
    story.append(card_row([
        ("Worker Sync", "Ambil file & antre OCR"),
        ("Mesin OCR", "PDF → teks"),
        ("Layanan AI", "Embedding & jawaban"),
    ]))
    story.append(PageBreak())
    # 9 behind
    story += [Paragraph("Di balik portal", h1)]
    story.append(card_row([
        ("Database", "User, sync, chat, audit"),
        ("Penyimpanan OCR", "Teks & preview"),
        ("Antre & cache", "Job & status"),
        ("Cloud sumber", "PDF organisasi"),
    ]))
    story.append(PageBreak())
    # 10 three actors
    story += [Paragraph("Tiga aktor di balik kode", h1),
              Paragraph("Siapa mengerjakan apa saat scan & OCR", sub)]
    story.append(card_row([
        ("Portal Next.js (app/)", "UI + API ingest, search, chat"),
        ("sync-worker", "Download, antre, reconcile, embed"),
        ("Paperless-ngx", "OCR PDF → teks + file olahan"),
    ]))
    story.append(PageBreak())
    # 11 coding flow
    story += [Paragraph("Flow coding dokumen", h1),
              Paragraph("Dari klik Ambil sampai siap dicari & ditanya", sub)]
    story.append(card_row([
        ("1 Browse", "WebDAV list"),
        ("2 Ingest", "API + DB job"),
        ("3 Antri", "BullMQ Redis"),
        ("4 Download", "→ consume"),
        ("5 OCR", "Paperless"),
        ("6 Cocokkan", "checksum"),
        ("7 Siap AI", "Search / Ask"),
    ], bg=colors.HexColor("#D1FAE5")))
    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph(
        "<b>Satu kalimat:</b> UI buat job → worker unduh → Paperless OCR → reconcile → Search / Ask AI",
        body,
    ))
    story.append(PageBreak())
    # 12 status + storage
    story += [Paragraph("Status file & tempat data", h1)]
    story.append(Paragraph(
        "<b>Status sync_files:</b> DISCOVERED → DOWNLOADING → QUEUED → OCR_PENDING → OCR_DONE",
        body,
    ))
    story.append(Spacer(1, 0.3 * cm))
    story.append(card_row([
        ("Nextcloud", "PDF asli (sumber)"),
        ("Paperless media + DB", "File olahan + teks OCR"),
        ("Postgres DB app", "sync_files, jobs, chat"),
        ("document_chunks", "Teks + embedding AI"),
    ]))
    story.append(PageBreak())
    # 13 features
    story += [Paragraph("Fitur untuk pengguna", h1)]
    for t, b in [
        ("Ask AI", "Tanya dokumen bahasa biasa"),
        ("Search", "Pencarian isi + ringkasan"),
        ("Library", "Browse cloud & batch OCR"),
        ("Preview", "Panel PDF bisa digeser"),
        ("Recent", "Hasil scan terbaru"),
        ("Status jelas", "Pending / proses / siap / gagal / 0 B"),
    ]:
        story.append(Paragraph(f"<b>{t}</b> — {b}", body))
    story.append(PageBreak())
    # 14 admin
    story += [Paragraph("Fitur untuk admin", h1)]
    for t, b in [
        ("User management", "Tambah/edit user, role, kredensial cloud"),
        ("Audit aktivitas", "Pemakaian search & AI, filter waktu"),
        ("Auto scan", "Jadwal scan folder favorit"),
        ("Isolasi data", "Setiap user hanya dokumennya"),
    ]:
        story.append(Paragraph(f"<b>{t}</b> — {b}", body))
    story.append(PageBreak())
    # 15 infra
    story += [Paragraph("Infrastruktur yang direkomendasikan", h1),
              Paragraph("<b>Rekomendasi utama: RAM 8 GB</b> — stabil untuk portal + OCR + antrean", sub)]
    specs = Table([
        ["CPU", "RAM", "Disk", "Akses"],
        ["4 vCPU", "8 GB", "100+ GB SSD", "HTTPS"],
        ["Portal & OCR", "Rekomendasi utama", "Dokumen & indeks", "Portal aman"],
    ], colWidths=[6 * cm] * 4)
    specs.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PDF_TEAL),
        ("TEXTCOLOR", (0, 0), (-1, 0), PDF_WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 1), (-1, 1), PDF_SOFT),
        ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.5, PDF_MUTED),
    ]))
    story += [specs, PageBreak()]
    # 16 layout
    story += [Paragraph("Tata letak di server", h1),
              Paragraph("Server aplikasi (8 GB RAM · 4 vCPU · SSD)", sub)]
    story.append(card_row([
        ("Portal Web", "Worker Sync"),
        ("Mesin OCR", "Database"),
        ("Antre / Cache", "Penyimpanan file"),
    ]))
    story.append(PageBreak())
    # 17 security
    story += [Paragraph("Keamanan untuk organisasi", h1)]
    story.append(card_row([
        ("Login & peran", "Admin / user terpisah"),
        ("Data per user", "Tidak bercampur"),
        ("Kredensial cloud", "Terenkripsi"),
        ("Jejak aktivitas", "Audit admin"),
    ]))
    story.append(PageBreak())
    # 18 why
    story += [Paragraph("Mengapa cocok untuk organisasi", h1)]
    story.append(card_row([
        ("Cepat dipakai", "Browse cloud langsung"),
        ("Skala bertahap", "Mulai unit kecil"),
        ("Biaya terkendali", "Satu server 8 GB"),
        ("Transparan", "Status & audit jelas"),
    ]))
    story.append(PageBreak())
    # 19 next
    story += [Paragraph("Langkah selanjutnya", h1)]
    story.append(card_row([
        ("1 Demo", "Lihat alur utama"),
        ("2 Pilot", "Beberapa user"),
        ("3 Ukur", "Waktu & kepuasan"),
        ("4 Rollout", "Perluas pemakaian"),
    ]))
    story.append(PageBreak())
    # 20 close
    story += [Spacer(1, 2 * cm),
              Paragraph("Dokumen organisasi siap ditemukan dan ditanyakan.", cover),
              Paragraph("Demo singkat · Pilot unit · Rollout bertahap", cover_sub),
              Paragraph("DocSearch", cover_sub)]

    doc.build(story)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    pptx = OUT / "DocSearch-Bappenas-Presentasi.pptx"
    pdf = OUT / "DocSearch-Bappenas-Presentasi.pdf"
    n = build_pptx(pptx)
    build_pdf(pdf)
    print(f"Created: {pptx}")
    print(f"Created: {pdf}")
    print(f"Slides: {n}")


if __name__ == "__main__":
    main()
