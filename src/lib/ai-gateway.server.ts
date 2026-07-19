// Server-only AI gateway helper. Imported only from server code.
//
// The provider is chosen lazily, per request, by whichever key is configured
// (first match wins):
//   1. ANTHROPIC_API_KEY -> Anthropic (Claude), OpenAI-compatible endpoint
//   2. GEMINI_API_KEY    -> Google AI Studio (Gemini FREE tier), OpenAI-compatible
//   3. LOVABLE_API_KEY   -> Lovable AI Gateway (present when running inside Lovable)
//
// Cloudflare setup (either key):
//   npx wrangler secret put GEMINI_API_KEY --name khizwiz-travel      (free)
//   npx wrangler secret put ANTHROPIC_API_KEY --name khizwiz-travel   (paid)

function provider(): "anthropic" | "gemini" | "lovable" | null {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.LOVABLE_API_KEY) return "lovable";
  return null;
}

export function aiUrl(): string {
  switch (provider()) {
    case "anthropic":
      return "https://api.anthropic.com/v1/chat/completions";
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    default:
      return "https://ai.gateway.lovable.dev/v1/chat/completions";
  }
}

export function aiModel(): string {
  // Override without a redeploy: npx wrangler secret/var AI_MODEL.
  // (gemini-2.5-flash was retired for new API users mid-2026 -> gemini-3.5-flash.)
  const override = process.env.AI_MODEL;
  if (override) return override;
  switch (provider()) {
    case "anthropic":
      return "claude-haiku-4-5";
    case "gemini":
      return "gemini-3.5-flash";
    default:
      return "google/gemini-3.5-flash";
  }
}

// Shared chat call with self-healing model fallback: when Google retires the
// configured model for this API key (404), retry once on the rolling alias.
export async function aiChat(payload: Record<string, unknown>): Promise<Response> {
  const call = (model: string) =>
    fetch(aiUrl(), {
      method: "POST",
      headers: lovableAiHeaders(),
      body: JSON.stringify({ model, ...payload }),
    });
  let res = await call(aiModel());
  if (res.status === 404 && provider() === "gemini") {
    const body = await res.clone().text().catch(() => "");
    if (/model/i.test(body)) res = await call("gemini-flash-latest");
  }
  return res;
}

export function lovableAiHeaders(): Record<string, string> {
  switch (provider()) {
    case "anthropic":
      return { "Content-Type": "application/json", Authorization: `Bearer ${process.env.ANTHROPIC_API_KEY}` };
    case "gemini":
      return { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GEMINI_API_KEY}` };
    case "lovable":
      return {
        "Content-Type": "application/json",
        "Lovable-API-Key": process.env.LOVABLE_API_KEY as string,
        "X-Lovable-AIG-SDK": "raw-fetch",
      };
    default:
      throw new Error(
        "AI is not configured: set GEMINI_API_KEY (free), ANTHROPIC_API_KEY, or LOVABLE_API_KEY.",
      );
  }
}
