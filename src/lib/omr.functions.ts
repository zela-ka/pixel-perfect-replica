import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const inputSchema = z.object({
  filename: z.string().min(1).max(200),
  pages: z.array(z.string().startsWith("data:image/")).min(1).max(8),
});

const SYSTEM_PROMPT = `You are an optical music recognition engine.
You receive images of printed sheet music pages (often SATB choir music).
Return ONE complete, valid MusicXML 3.1 score-partwise document that reproduces
what is printed, as faithfully as you can.

Rules:
- Output ONLY the XML. No markdown fences, no commentary.
- Start with <?xml version="1.0" encoding="UTF-8"?> and a score-partwise root.
- Include a part-list with one score-part per printed staff/voice
  (e.g. Soprano, Alto, Tenor, Bass) using their printed names.
- Preserve clefs, key signatures, time signatures, measure structure, note
  pitches, durations, rests, ties, slurs and dynamics where legible.
- Attach lyrics with <lyric number="1"><syllabic>..</syllabic><text>..</text></lyric>
  on the notes that carry them, using single/begin/middle/end syllabic values.
- Continue measure numbering across the supplied pages so the result is one score.
- If part of a page is illegible, still produce valid measures for what you can read.`;

export const convertPagesToMusicXml = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI conversion is not configured.");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3.1-pro-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Transcribe these ${data.pages.length} page(s) of "${data.filename}" into one MusicXML document.`,
              },
              ...data.pages.map((url) => ({
                type: "image_url" as const,
                image_url: { url },
              })),
            ],
          },
        ],
      }),
    });

    if (response.status === 429) {
      throw new Error("Too many conversions right now. Please try again in a moment.");
    }
    if (response.status === 402) {
      throw new Error("AI credits are exhausted. Please top up to keep converting.");
    }
    if (!response.ok) {
      throw new Error(`Recognition failed (${response.status}). Please try again.`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = payload.choices?.[0]?.message?.content ?? "";
    const cleaned = raw
      .replace(/^```(?:xml)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    const start = cleaned.indexOf("<?xml");
    const xml = start > 0 ? cleaned.slice(start) : cleaned;

    if (!xml.includes("<score-partwise")) {
      throw new Error(
        "No music notation could be recognised on these pages. Try a clearer or higher-resolution PDF.",
      );
    }

    return { musicxml: xml };
  });
