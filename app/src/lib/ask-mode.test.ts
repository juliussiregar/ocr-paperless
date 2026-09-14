import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeFactQuestion,
  stickyFocusStillRelevant,
  wantsFreshArchiveSearch,
  wantsFocusExpand,
  isThinOcrChars,
  softenAnalyzeWithoutFocus,
  parseAskMode,
} from "./ask-mode";

describe("ask-mode", () => {
  it("parseAskMode defaults to auto", () => {
    assert.equal(parseAskMode(undefined), "auto");
    assert.equal(parseAskMode("detail"), "detail");
  });

  it("detects fact questions", () => {
    assert.equal(looksLikeFactQuestion("berapa anggaran program ini?"), true);
    assert.equal(looksLikeFactQuestion("siapa yang hadir di rapat?"), true);
    assert.equal(looksLikeFactQuestion("ringkas dokumen ini"), false);
  });

  it("fresh archive search for list-like asks", () => {
    assert.equal(wantsFreshArchiveSearch("cari undangan rapat"), true);
    assert.equal(wantsFreshArchiveSearch("berapa anggarannya?"), false);
    assert.equal(wantsFreshArchiveSearch("apa saja", "list"), true);
  });

  it("keeps sticky on short anaphora follow-ups", () => {
    assert.equal(
      stickyFocusStillRelevant("berapa anggarannya?", [
        "Undangan Rapat Sumut",
      ]),
      true
    );
    assert.equal(
      stickyFocusStillRelevant("jelaskan lebih detail", ["Notulen Rapat Sumut"]),
      true
    );
    assert.equal(
      stickyFocusStillRelevant("siapa yang hadir?", ["MAT Konpers BNPB"]),
      true
    );
  });

  it("breaks sticky on stopword-only questions", () => {
    assert.equal(
      stickyFocusStillRelevant("yang dan atau", ["Undangan Rapat Sumut"]),
      false
    );
  });

  it("breaks sticky on topic shift", () => {
    assert.equal(
      stickyFocusStillRelevant(
        "peta zona rawan bencana aceh timur lengkap",
        ["Undangan Rapat Koordinasi Satu Data Sumatera"]
      ),
      false
    );
  });

  it("expands focus for compare/related", () => {
    assert.equal(wantsFocusExpand("bandingkan kedua dokumen"), true);
    assert.equal(wantsFocusExpand("apa isinya"), false);
  });

  it("detects thin OCR", () => {
    assert.equal(isThinOcrChars(50), true);
    assert.equal(isThinOcrChars(5000), false);
  });

  it("softens analyze without focus", () => {
    assert.equal(softenAnalyzeWithoutFocus("analyze", false), "detail");
    assert.equal(softenAnalyzeWithoutFocus("analyze", true), "analyze");
  });
});
