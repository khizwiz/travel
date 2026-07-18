// Server-only helper for the AI gateway.
// Imported only from `.functions.ts` handler bodies.
//
// Primary provider: Anthropic's OpenAI-compatible endpoint (Claude models).
// Activate by setting ANTHROPIC_API_KEY as a deployment secret, e.g.:
//   npx wrangler secret put ANTHROPIC_API_KEY
// Falls back to the Lovable AI Gateway when running inside Lovable
// (LOVABLE_API_KEY present, ANTHROPIC_API_KEY absent).

export function lovableAiHeaders(): Record<string, string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anthropicKey}`,
    };
  }
  const key = process.env.LOVABLE_API_KEY;
  if (!key) {
    throw new Error("AI is not configured: set ANTHROPIC_API_KEY (or LOVABLE_API_KEY).");
  }
  return {
    "Content-Type": "application/json",
    "Lovable-API-Key": key,
    "X-Lovable-AIG-SDK": "raw-fetch",
  };
}

export const LOVABLE_AI_URL = process.env.ANTHROPIC_API_KEY
  ? "https://api.anthropic.com/v1/chat/completions"
  : "https://ai.gateway.lovable.dev/v1/chat/completions";
