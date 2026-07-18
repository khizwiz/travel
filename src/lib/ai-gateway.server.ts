// Server-only helper for the Lovable AI Gateway.
// Imported only from `.functions.ts` handler bodies.
export function lovableAiHeaders() {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY is not configured");
  return {
    "Content-Type": "application/json",
    "Lovable-API-Key": key,
    "X-Lovable-AIG-SDK": "raw-fetch",
  };
}

export const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
