import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["hotel", "ferry", "flight", "activity", "insurance", "vehicle", "aff", "other"],
    },
    title: { type: "string" },
    location: { type: "string" },
    check_in: { type: "string", description: "ISO date or datetime" },
    check_out: { type: "string", description: "ISO date or datetime" },
    confirmation: { type: "string" },
    price_eur: { type: "number" },
    notes: { type: "string" },
  },
  required: ["type", "title"],
  additionalProperties: false,
};

const Input = z.object({
  text: z.string().min(1).max(40000).optional(),
  imageDataUrl: z.string().startsWith("data:").max(8_000_000).optional(),
  filename: z.string().max(200).optional(),
});

export const extractBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI gateway not configured");

    if (!data.text && !data.imageDataUrl) {
      throw new Error("Provide booking text or an image.");
    }

    const userContent: any[] = [
      {
        type: "text",
        text:
          "Extract the booking details from the following content. " +
          "Return ONLY the structured tool call. If a field is unknown, omit it. " +
          "Dates must be ISO 8601 (YYYY-MM-DD or full datetime).",
      },
    ];
    if (data.text) {
      userContent.push({ type: "text", text: data.text });
    }
    if (data.imageDataUrl) {
      userContent.push({ type: "image_url", image_url: { url: data.imageDataUrl } });
    }

    const body = {
      model: "claude-haiku-4-5",
      messages: [
        {
          role: "system",
          content:
            "You parse travel bookings (hotel, ferry, flight, activity, insurance, vehicle, skydiving) " +
            "from emails, PDFs and screenshots into a strict JSON shape.",
        },
        { role: "user", content: userContent },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "save_booking",
            description: "Save the extracted booking",
            parameters: EXTRACT_SCHEMA,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "save_booking" } },
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "raw-fetch",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) throw new Error("AI rate limit reached. Try again shortly.");
    if (res.status === 402)
      throw new Error("AI credits exhausted. Add credits in workspace billing.");
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`AI extraction failed (${res.status}): ${t.slice(0, 200)}`);
    }

    const json = (await res.json()) as any;
    const call = json?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) throw new Error("AI returned no booking data.");

    let parsed: any;
    try {
      parsed = JSON.parse(call.function.arguments);
    } catch {
      throw new Error("AI returned invalid JSON.");
    }

    // Persist pending upload
    const { data: trip, error: tripErr } = await context.supabase
      .from("trips")
      .select("id")
      .eq("slug", "eu-tripping-2026")
      .maybeSingle();
    if (tripErr || !trip) throw new Error("Trip not found");

    const { error } = await context.supabase.from("booking_uploads").insert({
      trip_id: trip.id,
      file_path: data.filename ?? null,
      source_kind: data.imageDataUrl ? "image" : "text",
      booking_type: parsed?.type ?? null,
      raw_text: data.text ?? null,
      parsed_json: parsed,
      suggested_changes: parsed,
      status: "pending",
      uploaded_by: context.userId,
    });


    if (error) throw new Error(`Failed to save: ${error.message}`);

    return { parsed };
  });

const ListInput = z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() });
export const listBookingUploads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const q = context.supabase
      .from("booking_uploads")
      .select("id, parsed_json, status, created_at, file_path")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data.status) q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

const DecisionInput = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
});
export const decideBookingUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DecisionInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Load the upload so we can auto-append on approval.
    const { data: upload, error: loadErr } = await supabase
      .from("booking_uploads")
      .select("id, trip_id, parsed_json")
      .eq("id", data.id)
      .single();
    if (loadErr || !upload) throw new Error(loadErr?.message ?? "Not found");

    const { error } = await supabase
      .from("booking_uploads")
      .update({
        status: data.decision,
        approved_by: context.userId,
        applied_at: data.decision === "approved" ? new Date().toISOString() : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    // On approval, auto-append to the itinerary.
    if (data.decision === "approved") {
      const parsed = (upload.parsed_json ?? {}) as {
        type?: string;
        title?: string;
        location?: string;
        check_in?: string;
        check_out?: string;
        confirmation?: string;
        price_eur?: number;
        notes?: string;
      };
      const rawDate = (parsed.check_in ?? parsed.check_out ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        // Find or create the itinerary day.
        const { data: existingDay } = await supabase
          .from("itinerary_days")
          .select("id")
          .eq("trip_id", upload.trip_id)
          .eq("day_date", rawDate)
          .maybeSingle();

        let dayId = existingDay?.id as string | undefined;
        if (!dayId) {
          const { data: newDay, error: dayErr } = await supabase
            .from("itinerary_days")
            .insert({
              trip_id: upload.trip_id,
              day_date: rawDate,
              title: parsed.title ?? parsed.location ?? "Booking",
              summary_public: parsed.location ?? null,
              day_kind: "destination",
            })
            .select("id")
            .single();
          if (dayErr) throw new Error(dayErr.message);
          dayId = newDay.id;
        }

        // Hotel-type bookings become an accommodation row on that day.
        if (parsed.type === "hotel" && dayId) {
          const { data: existingAcc } = await supabase
            .from("accommodations")
            .select("id")
            .eq("day_id", dayId)
            .maybeSingle();
          const payload = {
            day_id: dayId,
            name: parsed.title ?? "Hotel",
            area_public: parsed.location ?? null,
            check_in: parsed.check_in?.slice(0, 10) ?? null,
            check_out: parsed.check_out?.slice(0, 10) ?? null,
            booking_ref: parsed.confirmation ?? null,
            cost: parsed.price_eur ?? null,
            currency: "EUR",
            notes: parsed.notes ?? null,
            missing: false,
          };
          if (existingAcc?.id) {
            await supabase.from("accommodations").update(payload).eq("id", existingAcc.id);
          } else {
            await supabase.from("accommodations").insert(payload);
          }
        }
      }
    }

    return { ok: true };
  });

