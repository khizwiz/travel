import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { aiModel, aiUrl, lovableAiHeaders } from "./ai-gateway.server";

const SYSTEM = `You are a road-trip local scout for a family driving a Mitsubishi L200 across Europe (Istanbul → across Europe → back).
Given a GPS coordinate, return interesting things to see and do within 50 km, focused on:
- Brutalist / raw-concrete / socialist-modernist architecture (the driver is obsessed with brutalism)
- Unusual monuments, abandoned/soviet-era buildings, striking bridges, dams, radio towers
- Bars & cafes with character (dive bars, rooftops, historic bars — not chains)
- Sightseeing (viewpoints, historic centres, museums, natural spots) kid-friendly when possible
- One or two food picks worth the detour

Return STRICT JSON only, no prose. Shape:
{
  "area": "<nearest well-known place name>",
  "picks": [
    { "kind": "brutalist" | "sight" | "bar" | "food" | "kids",
      "name": "<name>",
      "where": "<city / district>",
      "why": "<one short sentence, why it's worth it>",
      "approx_km": <number, straight-line km from the given point> }
  ],
  "next_stop": {
    "name": "<a sensible next overnight town within ~200 km along a typical route>",
    "why": "<one short sentence>"
  }
}
Aim for 6–8 picks, spread across kinds. Be concrete (real place names). If you're unsure, omit rather than invent.`;

export type NearbyPick = {
  kind: "brutalist" | "sight" | "bar" | "food" | "kids";
  name: string;
  where: string;
  why: string;
  approx_km: number;
};

export const getNearbySuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        cityHint: z.string().max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const userMsg =
        `GPS: ${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}` +
        (data.cityHint ? ` (near ${data.cityHint})` : "") +
        `. Return suggestions as JSON only.`;
      const r = await fetch(aiUrl(), {
        method: "POST",
        headers: lovableAiHeaders(),
        body: JSON.stringify({
          model: aiModel(),
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userMsg },
          ],
          response_format: { type: "json_object" },
          temperature: 0.6,
        }),
      });
      if (r.status === 429) return { error: "Rate limited — try again in a moment." };
      if (r.status === 402) return { error: "AI credits exhausted." };
      if (!r.ok) {
        const t = await r.text();
        return { error: `AI error (${r.status}): ${t.slice(0, 200)}` };
      }
      const j: any = await r.json();
      const text: string = j.choices?.[0]?.message?.content ?? "";
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      }
      if (!parsed) return { error: "Couldn't parse AI response." };
      const picks: NearbyPick[] = Array.isArray(parsed.picks)
        ? parsed.picks
            .filter((p: any) => p && p.name && p.kind)
            .slice(0, 12)
            .map((p: any) => ({
              kind: p.kind,
              name: String(p.name).slice(0, 120),
              where: String(p.where ?? "").slice(0, 120),
              why: String(p.why ?? "").slice(0, 240),
              approx_km: Number(p.approx_km ?? 0),
            }))
        : [];
      return {
        area: String(parsed.area ?? data.cityHint ?? ""),
        picks,
        next_stop: parsed.next_stop
          ? {
              name: String(parsed.next_stop.name ?? "").slice(0, 120),
              why: String(parsed.next_stop.why ?? "").slice(0, 240),
            }
          : null,
      };
    } catch (e: any) {
      return { error: e?.message ?? "Nearby suggestions failed" };
    }
  });
