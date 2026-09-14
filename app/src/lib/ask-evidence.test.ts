import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEvidenceFromChunks,
  filterCitationsByEvidence,
  mergeEvidence,
  parseEvidenceMarkers,
} from "./ask-evidence";

describe("ask-evidence", () => {
  it("builds sequential evidence ids", () => {
    const ev = buildEvidenceFromChunks([
      {
        docId: 1,
        title: "Dokumen A",
        fileName: "a.pdf",
        page: 2,
        content: "Ini cuplikan cukup panjang untuk lolos filter minimum.",
      },
      {
        docId: 2,
        title: "Dokumen B",
        fileName: "b.pdf",
        page: 1,
        content: "Cuplikan kedua juga harus cukup panjang untuk bukti.",
      },
    ]);
    assert.equal(ev[0]?.id, "S1");
    assert.equal(ev[1]?.id, "S2");
  });

  it("mergeEvidence renumbers without colliding", () => {
    const base = buildEvidenceFromChunks([
      {
        docId: 1,
        title: "A",
        fileName: "a.pdf",
        page: 1,
        content: "Bukti awal yang panjang genug untuk menjadi evidence item.",
      },
    ]);
    const extra = buildEvidenceFromChunks([
      {
        docId: 2,
        title: "B",
        fileName: "b.pdf",
        page: 3,
        content: "Bukti tambahan dari tool yang juga cukup panjang isinya.",
      },
    ]);
    const merged = mergeEvidence(base, extra);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.id, "S1");
    assert.equal(merged[1]?.id, "S2");
    assert.equal(merged[1]?.docId, 2);
  });

  it("filters citations by [Sn] markers", () => {
    const evidence = buildEvidenceFromChunks([
      {
        docId: 10,
        title: "Undangan Rapat Sumut",
        fileName: "und.pdf",
        page: 1,
        content: "Agenda rapat adalah koordinasi satu data bencana daerah.",
      },
      {
        docId: 20,
        title: "Materi Konpers",
        fileName: "mat.pdf",
        page: 4,
        content: "Jumlah korban banjir dan longsor dilaporkan secara resmi.",
      },
    ]);
    const answer =
      "Agenda utamanya koordinasi satu data [S1]. Korban dilaporkan di materi [S2].";
    const cites = filterCitationsByEvidence(answer, evidence, []);
    assert.equal(cites.length, 2);
    assert.equal(cites[0]?.id, 10);
    assert.equal(cites[1]?.id, 20);
    assert.deepEqual(parseEvidenceMarkers(answer).sort(), ["S1", "S2"]);
  });
});
