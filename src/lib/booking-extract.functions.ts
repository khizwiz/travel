// AI-powered booking extraction for the Open Planning page.
// Accepts a small uploaded file (PDF / image / text) and returns structured
// accommodation fields the planning form can pre-fill. Owner-only.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { LOVABLE_AI_URL, lovableAiHeaders } from "./ai-gateway.server";

const MAX_BYTES = 8 * 1024 * 1024; // ~8MB after base64 overhead → matches 6MB raw payload

const Input = z.object({
  fileDataUrl: z.string().startsWith("data:").max(MAX_BYTES),
  filename: z.string().trim().max(200).optional(),
});

const SCHEMA = {
  type: "object",
  properties: {
    hotelName: { type: "string", description: "Hotel or property name" },
    city: { type: "string", description: "City or town only" },
    area: { type: "string", description: "Neighbourhood / district (optional)" },
    address: { type: "string", description: "Street address (optional)" },
    checkIn: { type: "string", description: "ISO date YYYY-MM-DD" },
    checkOut: { type: "string", description: "ISO date YYYY-MM-DD" },
    bookingRef: { type: "string", description: "Confirmation / booking number" },
    priceTotal: { type: "number", description: "Total price as a plain number" },
    currency: { type: "string", description: "ISO 4217 like EUR, USD, TRY" },
    notes: { type: "string", description: "Anything noteworthy (cancellation, breakfast, etc.)" },
  },
  required: ["hotelName"],
  additionalProperties: false,
} as const;

function mimeFromDataUrl(url: string): string {
  const m = url.match(/^data:([^;,]+)[;,]/);
  return m ? m[1] : "application/octet-stream";
}

export const extractAccommodation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const mime = mimeFromDataUrl(data.fileDataUrl);
    const isPdf = mime === "application/pdf";
    const isImage = mime.startsWith("image/");
    const isText = mime.startsWith("text/");
    if (!isPdf && !isImage && !isText) {
      throw new Error(
        `Unsupported file type: ${mime}. Upload a PDF, image, or text/HTML file.`,
      );
    }

    const userContent: any[] = [
      {
        type: "text",
        text:
          "Extract the hotel/accommodation booking from the attached file. " +
          "Use the structured tool call. Omit unknown fields. " +
          "Dates must be ISO 8601 (YYYY-MM-DD).",
      },
    ];
    if (isImage) {
      userContent.push({ type: "image_url", image_url: { url: data.fileDataUrl } });
    } else if (isPdf) {
      userContent.push({
        type: "file",
        file: { filename: data.filename ?? "booking.pdf", file_data: data.fileDataUrl },
      });
    } else if (isText) {
      // Decode base64 text inline; small enough to fit in context.
      const base64 = data.fileDataUrl.split(",")[1] ?? "";
      const text = Buffer.from(base64, "base64").toString("utf8").slice(0, 60_000);
      userContent.push({ type: "text", text: `--- FILE START ---\n${text}\n--- FILE END ---` });
    }

    const body = {
      model: "claude-haiku-4-5",
      messages: [
        {
          role: "system",
          content:
            "You parse hotel and accommodation bookings (PDF, email, screenshot) " +
            "into a strict JSON shape. Never invent fields.",
        },
        { role: "user", content: userContent },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "save_accommodation",
            description: "Save the extracted accommodation booking",
            parameters: SCHEMA,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "save_accommodation" } },
    };

    const res = await fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: lovableAiHeaders(),
      body: JSON.stringify(body),
    });

    if (res.status === 429) throw new Error("AI rate limit reached. Try again in a minute.");
    if (res.status === 402)
      throw new Error("AI credits exhausted. Top up in workspace billing.");
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`AI extraction failed (${res.status}): ${t.slice(0, 200)}`);
    }
    const json = (await res.json()) as any;
    const call = json?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) throw new Error("AI returned no fields.");
    let parsed: any;
    try {
      parsed = JSON.parse(call.function.arguments);
    } catch {
      throw new Error("AI returned invalid JSON.");
    }
    return { parsed };
  });
