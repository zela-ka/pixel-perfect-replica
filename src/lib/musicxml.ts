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

/** Context passed to the recogniser so the next page continues this one. */
export function continuationContext(xml: string) {
  const doc = parseXml(xml);
  const partList = doc.getElementsByTagName("part-list")[0];
  const parts = Array.from(doc.getElementsByTagName("part"));
  let maxMeasure = 0;
  const attrs: string[] = [];
  parts.forEach((part) => {
    const measures = Array.from(part.getElementsByTagName("measure"));
    measures.forEach((m) => {
      const n = parseInt(m.getAttribute("number") ?? "", 10);
      if (!Number.isNaN(n)) maxMeasure = Math.max(maxMeasure, n);
    });
    maxMeasure = Math.max(maxMeasure, measures.length);
    const allAttrs = part.getElementsByTagName("attributes");
    const last = allAttrs[allAttrs.length - 1];
    if (last) attrs.push(`${part.getAttribute("id")}: ${new XMLSerializer().serializeToString(last)}`);
  });
  return {
    partList: partList ? new XMLSerializer().serializeToString(partList) : "",
    firstMeasure: maxMeasure + 1,
    lastAttributes: attrs.join("\n").slice(0, 19_000),
  };
}

/**
 * Joins page documents into one score: measures of each page are appended to
 * the matching part (by position) of the first page. Notes are copied verbatim;
 * only measure numbers are renumbered so they run continuously.
 */
export function mergePages(xmls: string[]): { xml: string; warnings: string[] } {
  const warnings: string[] = [];
  if (xmls.length === 0) throw new Error("There are no converted pages yet.");
  const base = parseXml(xmls[0]!);
  const baseParts = Array.from(base.getElementsByTagName("part"));
  xmls.slice(1).forEach((xml, i) => {
    const doc = parseXml(xml);
    const parts = Array.from(doc.getElementsByTagName("part"));
    if (parts.length !== baseParts.length) {
      warnings.push(
        `Page ${i + 2} has ${parts.length} staves but page 1 has ${baseParts.length}; please check the joined score.`,
      );
    }
    parts.forEach((part, p) => {
      const target = baseParts[p];
      if (!target) return;
      Array.from(part.children)
        .filter((el) => el.tagName === "measure")
        .forEach((m) => target.appendChild(base.importNode(m, true)));
    });
  });
  baseParts.forEach((part) => {
    let n = 1;
    Array.from(part.children)
      .filter((el) => el.tagName === "measure")
      .forEach((m) => {
        if (m.getAttribute("implicit") === "yes" && n === 1) m.setAttribute("number", "0");
        else m.setAttribute("number", String(n++));
      });
  });
  return { xml: serializeXml(base), warnings };
}
