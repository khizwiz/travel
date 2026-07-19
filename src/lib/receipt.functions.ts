import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { aiChat } from "./ai-gateway.server";

const CURRENCIES = [
  "EUR", "USD", "TRY", "BGN", "RON", "HUF", "CZK", "PLN", "CHF", "RSD", "BAM", "MKD", "ALL",
] as const;

const SYSTEM = `You read a photo of a purchase receipt from a European road trip and extract the payment.
Return STRICT JSON only, no prose:
{
  "amount": <number, the FINAL total actually paid>,
  "currency": "<3-letter ISO code, e.g. EUR, RSD, BGN, TRY, HUF>",
  "category": "fuel" | "accommodation" | "ferry" | "food" | "activities" | "tolls" | "misc",
  "description": "<short merchant/what, e.g. 'OMV fuel, Nis' — max 60 chars>",
  "date": "<YYYY-MM-DD if visible on the receipt, else null>"
}
Rules: prefer the grand total (after tax/discounts). If the currency symbol is ambiguous, infer from language/country hints on the receipt. If you cannot read a total at all, return {"amount": null}.`;

/** Any signed-in traveller can scan a receipt photo; AI extracts the payment. */
export const extractReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      // Downscaled JPEG data URL from the client (kept well under worker limits).
      imageDataUrl: z.string().startsWith("data:image/").max(1_500_000),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const r = await aiChat({
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the payment from this receipt. JSON only." },
              { type: "image_url", image_url: { url: data.imageDataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      });
      if (r.status === 429) return { error: "Rate limited — try again in a moment." };
      if (!r.ok) {
        const t = await r.text();
        return { error: `AI error (${r.status}): ${t.slice(0, 160)}` };
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
      const amount = Number(parsed?.amount);
      if (!parsed || !isFinite(amount) || amount <= 0) {
        return { error: "Couldn't read a total from that photo — try a sharper shot." };
      }
      const cur = String(parsed.currency ?? "EUR").toUpperCase();
      const currency = (CURRENCIES as readonly string[]).includes(cur) ? cur : "EUR";
      const cats = ["fuel", "accommodation", "ferry", "food", "activities", "tolls", "misc"];
      const category = cats.includes(parsed.category) ? parsed.category : "misc";
      const date = typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
        ? parsed.date
        : null;
      return {
        amount: Math.round(amount * 100) / 100,
        currency,
        category,
        description: String(parsed.description ?? "").slice(0, 60) || null,
        date,
        currencyNote: cur !== currency ? `Receipt currency ${cur} not supported — verify amount.` : null,
      };
    } catch (e: any) {
      return { error: e?.message ?? "Receipt scan failed" };
    }
  });
