import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createHash } from "crypto";
import { aiModel, aiUrl, lovableAiHeaders } from "./ai-gateway.server";

const LANG_NAMES: Record<string, string> = {
  tr: "Turkish",
  pl: "Polish",
  it: "Italian",
  en: "English",
};

function hash(s: string, target: string): string {
  return createHash("sha1").update(`${target}\u0001${s}`).digest("hex");
}

export const translateStrings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        strings: z.array(z.string().min(1).max(2000)).min(1).max(60),
        target: z.enum(["tr", "pl", "it", "en"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { strings, target } = data;
    if (target === "en") return { translated: strings };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Dedup + hash
    const uniq = Array.from(new Set(strings));
    const hashes = uniq.map((s) => hash(s, target));
    const hashToSource = new Map<string, string>();
    uniq.forEach((s, i) => hashToSource.set(hashes[i], s));

    // Lookup cache
    const { data: existing } = await supabaseAdmin
      .from("translations")
      .select("source_hash, translated")
      .eq("target_lang", target)
      .in("source_hash", hashes);

    const cache = new Map<string, string>();
    for (const row of existing ?? []) cache.set((row as any).source_hash, (row as any).translated);

    // Missing
    const missing = uniq.filter((_, i) => !cache.has(hashes[i]));

    if (missing.length > 0) {
      const langName = LANG_NAMES[target] ?? target;
      const prompt = `Translate each of the following short UI strings from English to ${langName}. Preserve punctuation, casing style, emoji, placeholders like {name} or %s, and line breaks. Return ONLY a JSON array of translated strings in the same order, no keys, no commentary.\n\nSTRINGS:\n${JSON.stringify(missing)}`;
      try {
        const r = await fetch(aiUrl(), {
          method: "POST",
          headers: lovableAiHeaders(),
          body: JSON.stringify({
            model: aiModel(),
            messages: [
              { role: "system", content: "You are a precise UI translator. Output valid JSON only." },
              { role: "user", content: prompt },
            ],
            temperature: 0.1,
          }),
        });
        if (r.ok) {
          const j: any = await r.json();
          let text: string = j.choices?.[0]?.message?.content ?? "";
          text = text.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
          const arr = JSON.parse(text);
          if (Array.isArray(arr) && arr.length === missing.length) {
            const rows = missing.map((src, i) => ({
              source_hash: hash(src, target),
              target_lang: target,
              source: src,
              translated: String(arr[i] ?? src),
            }));
            for (const row of rows) cache.set(row.source_hash, row.translated);
            await supabaseAdmin.from("translations").upsert(rows, { onConflict: "source_hash,target_lang" });
          }
        }
      } catch {
        // fall through — untranslated strings return as source
      }
    }

    // Map back to original input order
    const translated = strings.map((s) => cache.get(hash(s, target)) ?? s);
    return { translated };
  });
