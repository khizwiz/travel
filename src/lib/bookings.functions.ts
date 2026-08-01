import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { aiModel, aiUrl, lovableAiHeaders } from "./ai-gateway.server";

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
    if (!data.text && !data.imageDataUrl) {
      throw new Error("Provide booking text or an image.");
    }

    // Tell the model when the trip is.
    //
    // Booking documents routinely print "23 Jul" or "23/07" with no year, and
    // a model with no anchor invents one — which is how a hotel confirmation
    // became an itinerary day in 2020, four years outside the trip, where it
    // changed nothing and quietly looked like the import had failed.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tripDates } = await supabaseAdmin
      .from("trips")
      .select("starts_on, ends_on")
      .eq("slug", "eu-tripping-2026")
      .maybeSingle();
    const window =
      tripDates?.starts_on && tripDates?.ends_on
        ? `The trip runs ${tripDates.starts_on} to ${tripDates.ends_on}. Every date in this ` +
          `document falls in that range: if the document omits the year, or gives a ` +
          `day and month only, resolve it inside that range. Never emit a year ` +
          `outside it.`
        : "";

    const userContent: any[] = [
      {
        type: "text",
        text:
          "Extract the booking details from the following content. " +
          "Return ONLY the structured tool call. If a field is unknown, omit it. " +
          "Dates must be ISO 8601 (YYYY-MM-DD or full datetime). " +
          window,
      },
    ];
    if (data.text) {
      userContent.push({ type: "text", text: data.text });
    }
    if (data.imageDataUrl) {
      userContent.push({ type: "image_url", image_url: { url: data.imageDataUrl } });
    }

    const body = {
      model: aiModel(),
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

    const res = await fetch(aiUrl(), {
      method: "POST",
      headers: lovableAiHeaders(),
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

      // A well-formed date is not necessarily a believable one. This only
      // checked the shape, so a misread year sailed through and created an
      // itinerary day far outside the trip: the booking appeared to import
      // cleanly while changing nothing anyone would ever see. Refuse instead,
      // and say what was read, so it can be corrected rather than lost.
      const { data: tripWindow } = await supabase
        .from("trips")
        .select("starts_on, ends_on")
        .eq("id", upload.trip_id)
        .maybeSingle();
      const shiftDays = (iso: string, by: number) =>
        new Date(new Date(iso + "T00:00:00Z").getTime() + by * 86400000)
          .toISOString()
          .slice(0, 10);

      // A generous margin, on purpose.
      //
      // This exists to catch a misread *year* — an error of years, which is
      // what put a booking in 2020. It must not double as enforcement of the
      // exact itinerary bounds, because those are not reliable: the recorded
      // start has already proved to be two days later than the journey really
      // began, and a tight window would have refused a genuine booking from
      // the first morning. A month either side separates "wrong year" from
      // "the plan moved" without ever blocking a plausible document.
      const MARGIN_DAYS = 30;
      const lo = tripWindow?.starts_on
        ? shiftDays(tripWindow.starts_on as string, -MARGIN_DAYS)
        : null;
      const hi = tripWindow?.ends_on ? shiftDays(tripWindow.ends_on as string, MARGIN_DAYS) : null;
      if (rawDate && lo && hi && (rawDate < lo || rawDate > hi)) {
        throw new Error(
          `The date read from this booking (${rawDate}) is nowhere near the trip ` +
            `(${tripWindow!.starts_on} to ${tripWindow!.ends_on}) — most likely the ` +
            `document did not state a year. Nothing was changed. Check the year, or ` +
            `set the date by hand.`,
        );
      }

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

