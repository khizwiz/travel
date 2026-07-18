import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Live FX rates via frankfurter.app (ECB reference rates, free, no key).
export const getFxRates = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ base: z.string().length(3).default("EUR").optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const base = (data.base ?? "EUR").toUpperCase();
    try {
      const r = await fetch(`https://api.frankfurter.app/latest?from=${base}&to=USD,TRY,GBP`);
      if (!r.ok) return { base, rates: {} as Record<string, number>, error: "FX unavailable" as const };
      const j: any = await r.json();
      return { base, date: j.date as string, rates: j.rates as Record<string, number> };
    } catch {
      return { base, rates: {} as Record<string, number>, error: "FX unavailable" as const };
    }
  });
