export function Footer() {
  return (
    <footer className="mt-auto border-t border-slate-200/80 bg-white/60 py-6">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 text-center sm:flex-row sm:px-6 sm:text-left">
        <p className="text-xs text-slate-500">
          DocSearch Bappenas · Portal OCR & Pencarian Dokumen
        </p>
        <p className="text-xs text-slate-400">
          Data disimpan di server organisasi · Internal use only
        </p>
      </div>
    </footer>
  );
}
