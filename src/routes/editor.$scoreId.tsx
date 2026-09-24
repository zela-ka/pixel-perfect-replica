import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  applySyllables,
  collectSyllables,
  parseXml,
  scoreWarnings,
  serializeXml,
  type Syllable,
} from "@/lib/musicxml";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

import { convertPage } from "@/lib/omr-client";
import { continuationContext, mergePages } from "@/lib/musicxml";

export const Route = createFileRoute("/editor/$scoreId")({
  head: () => ({
    meta: [
      { title: "Score Editor — edit lyrics and export MusicXML" },
      {
        name: "description",
        content:
          "View your converted score, replace lyric syllables without touching the notes, and download MusicXML or a printable PDF.",
      },
      { property: "og:title", content: "Score Editor — edit lyrics and export MusicXML" },
      {
        property: "og:description",
        content: "Edit the lyrics of your converted sheet music and export MusicXML.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EditorPage,
});

function EditorPage() {
  const { scoreId } = Route.useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["score", scoreId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scores")
        .select("id, filename, original_musicxml, edited_musicxml, warnings, page_xml, page_images, page_count")
        .eq("id", scoreId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("This score could not be found.");
      return data;
    },
  });

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading your score…</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "This score could not be found."}
        </p>
        <Link to="/" className="text-sm underline">
          Start again
        </Link>
      </main>
    );
  }

  return (
    <PagedEditor
      scoreId={scoreId}
      filename={data.filename}
      initialPages={data.page_xml.length ? data.page_xml : [data.edited_musicxml || data.original_musicxml]}
      images={data.page_images}
      pageCount={Math.max(data.page_count, data.page_xml.length, 1)}
    />
  );
}

function PagedEditor({
  scoreId,
  filename,
  initialPages,
  images,
  pageCount,
}: {
  scoreId: string;
  filename: string;
  initialPages: string[];
  images: string[];
  pageCount: number;
}) {
  const convert = convertPage;
  const [pages, setPages] = useState<string[]>(initialPages);
  const [current, setCurrent] = useState(initialPages.length - 1);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const drafts = useRef<Record<number, string>>({});

  function collected(): string[] {
    return pages.map((xml, i) => drafts.current[i] ?? xml);
  }

  async function persist(next: string[]) {
    const merged = mergePages(next);
    const { error } = await supabase
      .from("scores")
      .update({ page_xml: next, edited_musicxml: merged.xml })
      .eq("id", scoreId);
    if (error) throw new Error(error.message);
    return merged;
  }

  async function save() {
    const next = collected();
    setPages(next);
    await persist(next);
  }

  async function approveAndContinue() {
    setConvertError(null);
    setConverting(true);
    try {
      const next = collected();
      drafts.current = {};
      setPages(next);
      await persist(next);
      const pageNumber = next.length + 1;
      const image = images[pageNumber - 1];
      if (!image) throw new Error("The image for the next page is missing. Please upload again.");
      const { musicxml } = await convert({
        data: {
          filename,
          image,
          pageNumber,
          totalPages: pageCount,
          context: continuationContext(next[next.length - 1]!),
        },
      });
      parseXml(musicxml);
      const withNew = [...next, musicxml];
      setPages(withNew);
      await persist(withNew);
      setCurrent(withNew.length - 1);
      toast.success(`Page ${pageNumber} is ready to review.`);
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : "Converting the next page failed.");
    } finally {
      setConverting(false);
    }
  }

  function exportMerged() {
    return mergePages(collected());
  }

  const remaining = pageCount - pages.length;

  return (
    <div>
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pt-6 sm:px-8">
        <span className="mr-2 text-xs uppercase tracking-widest text-muted-foreground">Pages</span>
        {Array.from({ length: pageCount }, (_, i) => (
          <Button
            key={i}
            size="sm"
            variant={i === current ? "default" : "outline"}
            disabled={i >= pages.length}
            onClick={() => setCurrent(i)}
          >
            {i + 1}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {remaining > 0 ? (
            <Button onClick={approveAndContinue} disabled={converting}>
              {converting
                ? `Converting page ${pages.length + 1}…`
                : `Approve & convert page ${pages.length + 1}`}
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">All {pageCount} pages converted</span>
          )}
        </div>
      </nav>
      {convertError && (
        <p className="mx-auto mt-3 max-w-6xl px-4 text-sm text-destructive sm:px-8">{convertError}</p>
      )}
      <Editor
        key={`${current}-${pages.length}`}
        filename={filename}
        pageLabel={`Page ${current + 1} of ${pageCount}` + (remaining > 0 ? ` · ${pages.length} converted` : "")}
        xml={drafts.current[current] ?? pages[current] ?? ""}
        onDraft={(xml) => {
          drafts.current[current] = xml;
        }}
        onSave={save}
        getExport={exportMerged}
      />
    </div>
  );
}

function Editor({
  filename,
  pageLabel,
  xml,
  onDraft,
  onSave,
  getExport,
}: {
  filename: string;
  pageLabel: string;
  xml: string;
  onDraft: (xml: string) => void;
  onSave: () => Promise<void>;
  getExport: () => { xml: string; warnings: string[] };
}) {
  const doc = useMemo(() => parseXml(xml), [xml]);
  const [syllables, setSyllables] = useState<Syllable[]>(() => collectSyllables(doc));
  const [currentXml, setCurrentXml] = useState(xml);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const warnings = useMemo(() => scoreWarnings(doc), [doc]);

  const container = useRef<HTMLDivElement>(null);
  const osmd = useRef<import("opensheetmusicdisplay").OpenSheetMusicDisplay | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
      if (cancelled || !container.current) return;
      if (!osmd.current) {
        osmd.current = new OpenSheetMusicDisplay(container.current, {
          autoResize: true,
          backend: "svg",
          drawTitle: true,
});
      }
      try {
        await osmd.current.load(currentXml);
        if (!cancelled) osmd.current.render();
      } catch {
        if (!cancelled) setRenderError("The recognised notation could not be displayed.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentXml]);

  function updateSyllable(index: number, text: string) {
    setSyllables((prev) => {
      const next = prev.map((s, i) => (i === index ? { ...s, text } : s));
      const d = parseXml(currentXml);
      applySyllables(d, next);
      onDraft(serializeXml(d));
      return next;
    });
    setDirty(true);
  }

  function buildXml(): string {
    const next = parseXml(currentXml);
    applySyllables(next, syllables);
    return serializeXml(next);
  }

  function applyToScore() {
    const next = buildXml();
    setCurrentXml(next);
    onDraft(next);
    return next;
  }

  async function save() {
    setSaving(true);
    try {
      applyToScore();
      await onSave();
      setDirty(false);
      toast.success("Your lyric changes are saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  }

  function download() {
    applyToScore();
    const merged = getExport();
    merged.warnings.forEach((w) => toast.warning(w));
    const next = merged.xml;
    const blob = new Blob([next], { type: "application/vnd.recordare.musicxml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename.replace(/\.pdf$/i, "") + ".musicxml";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    applyToScore();
    const merged = getExport();
    if (osmd.current) {
      await osmd.current.load(merged.xml);
      osmd.current.render();
    }
    setTimeout(() => {
      window.print();
      setCurrentXml(buildXml() + " ");
    }, 300);
  }

  const groups = useMemo(() => {
    const map = new Map<string, { index: number; syllable: Syllable }[]>();
    syllables.forEach((syllable, index) => {
      const list = map.get(syllable.partName) ?? [];
      list.push({ index, syllable });
      map.set(syllable.partName, list);
    });
    return Array.from(map.entries());
  }, [syllables]);

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl">Score Editor</h1>
          <p className="text-sm text-muted-foreground">{filename} · {pageLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" asChild>
            <Link to="/">New upload</Link>
          </Button>
          <Button variant="outline" onClick={save} disabled={saving}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
          <Button onClick={download}>Download MusicXML (all pages)</Button>
          <Button variant="secondary" onClick={exportPdf}>
            Export PDF
          </Button>
        </div>
      </header>

      {(warnings.length > 0 || renderError) && (
        <div className="mx-auto mt-6 max-w-6xl rounded-md border border-accent bg-accent/40 px-4 py-3 text-sm">
          {warnings.join(" ")} Some parts of this sheet may not have been recognised accurately.
          Please review the converted score before downloading.
          {renderError ? ` ${renderError}` : ""}
        </div>
      )}


      <div className="mx-auto mt-6 grid max-w-6xl gap-6 lg:grid-cols-[1fr_22rem]">
        <div id="score-print" className="score-sheet overflow-x-auto p-4">
          <div ref={container} />
        </div>

        <aside className="score-sheet h-fit p-4">
          <h2 className="text-xl">Lyrics</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Replace any syllable. The notes, rhythm and staves stay exactly as recognised.
          </p>
          {groups.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              No lyrics were recognised on this score.
            </p>
          )}
          <div className="mt-4 max-h-[70vh] space-y-6 overflow-y-auto pr-1">
            {groups.map(([partName, items]) => (
              <div key={partName}>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {partName}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {items.map(({ index, syllable }) => (
                    <Input
                      key={syllable.key}
                      value={syllable.text}
                      aria-label={`Syllable in measure ${syllable.measure}`}
                      onChange={(e) => updateSyllable(index, e.target.value)}
                      className="h-8 text-sm"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {dirty && (
            <Button variant="outline" className="mt-4 w-full" onClick={() => applyToScore()}>
              Update notation preview
            </Button>
          )}
        </aside>
      </div>
    </main>
  );
}
