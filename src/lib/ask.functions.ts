import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LOVABLE_AI_URL, lovableAiHeaders } from "./ai-gateway.server";

const SYSTEM = `You are "Ask Tripping", the in-app assistant for the Tripping road-trip journal.
Trip: Istanbul â†’ across Europe â†’ back to Istanbul, Julyâ€“August 2026, driven by Khizar (with Simona and their son Fez for parts).
Behave as an in-app search + travel helper:
- If the user's question is about the trip itself (dates, cities, bookings, hotels, vehicle, checklist, missing info), answer strictly from the APP CONTEXT provided below. Do not invent details that aren't there. If the answer isn't in the context, say so plainly.
- For general travel questions (things to do, food, kids activities, comparisons) you may answer from general knowledge, keeping it practical and current-season.
- Keep answers concise (3â€“6 sentences unless asked). Never invent booking references or exact private addresses.`;

export const askTripping = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        question: z.string().trim().min(2).max(1000),
        context: z.string().trim().max(8000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const messages = [
        { role: "system", content: SYSTEM },
        ...(data.context ? [{ role: "system", content: `APP CONTEXT:\n${data.context}` }] : []),
        { role: "user", content: data.question },
      ];
      const r = await fetch(LOVABLE_AI_URL, {
        method: "POST",
        headers: lovableAiHeaders(),
        body: JSON.stringify({
          model: "claude-haiku-4-5",
          messages,
          temperature: 0.4,
        }),
      });
      if (r.status === 429) return { error: "Rate limited â€” try again in a moment." };
      if (r.status === 402) return { error: "AI credits exhausted." };
      if (!r.ok) {
        const t = await r.text();
        return { error: `AI error (${r.status}): ${t.slice(0, 200)}` };
      }
      const j: any = await r.json();
      const answer = j.choices?.[0]?.message?.content?.trim() ?? "";
      return { answer };
    } catch (e: any) {
      return { error: e?.message ?? "Ask Tripping failed" };
    }
  });
