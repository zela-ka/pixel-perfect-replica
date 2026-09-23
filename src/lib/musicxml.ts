export type Syllable = {
  /** stable path: partIndex.noteIndex.lyricIndex */
  key: string;
  partIndex: number;
  partName: string;
  measure: string;
  text: string;
  syllabic: string;
};

export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("The score file could not be read.");
  }
  return doc;
}

export function serializeXml(doc: Document): string {
  return new XMLSerializer().serializeToString(doc);
}

export function collectSyllables(doc: Document): Syllable[] {
  const parts = Array.from(doc.getElementsByTagName("part"));
  const names = new Map<string, string>();
  Array.from(doc.getElementsByTagName("score-part")).forEach((sp) => {
    const id = sp.getAttribute("id") ?? "";
    names.set(id, sp.getElementsByTagName("part-name")[0]?.textContent?.trim() || id);
  });

  const out: Syllable[] = [];
  parts.forEach((part, partIndex) => {
    const partName = names.get(part.getAttribute("id") ?? "") ?? `Part ${partIndex + 1}`;
    Array.from(part.getElementsByTagName("measure")).forEach((measure) => {
      const measureNo = measure.getAttribute("number") ?? "";
      Array.from(measure.getElementsByTagName("lyric")).forEach((lyric, lyricIndex) => {
        const textEl = lyric.getElementsByTagName("text")[0];
        if (!textEl) return;
        out.push({
          key: `${partIndex}|${measureNo}|${out.length}|${lyricIndex}`,
          partIndex,
          partName,
          measure: measureNo,
          text: textEl.textContent ?? "",
          syllabic: lyric.getElementsByTagName("syllabic")[0]?.textContent ?? "single",
        });
      });
    });
  });
  return out;
}

/** Writes syllable texts back in document order; notation is never touched. */
export function applySyllables(doc: Document, syllables: Syllable[]): Document {
  const parts = Array.from(doc.getElementsByTagName("part"));
  let cursor = 0;
  parts.forEach((part) => {
    Array.from(part.getElementsByTagName("measure")).forEach((measure) => {
      Array.from(measure.getElementsByTagName("lyric")).forEach((lyric) => {
        const textEl = lyric.getElementsByTagName("text")[0];
        if (!textEl) return;
        const next = syllables[cursor++];
        if (next) textEl.textContent = next.text;
      });
    });
  });
  return doc;
}

export function scoreWarnings(doc: Document): string[] {
  const warnings: string[] = [];
  const parts = doc.getElementsByTagName("part").length;
  const measures = doc.getElementsByTagName("measure").length;
  const lyrics = doc.getElementsByTagName("lyric").length;
  if (parts === 0 || measures === 0) warnings.push("No usable staves were recognised.");
  if (lyrics === 0) warnings.push("No lyrics were recognised on this score.");
  return warnings;
}
