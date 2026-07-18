import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { lovableAiHeaders, LOVABLE_AI_URL } from "@/lib/ai-gateway.server";

export const DOCUMENT_KINDS = [
  "passport", "visa", "vehicle_reg", "insurance", "employer_letter",
  "ferry", "emergency", "other",
] as const;
export type DocumentKind = typeof DOCUMENT_KINDS[number];

/** Folders shown in the UI, each mapping to one or more `kind` values. */
export const DOCUMENT_FOLDERS = [
  { id: "identification", label: "Identification", kinds: ["passport", "visa"] as DocumentKind[] },
  { id: "insurance",      label: "Insurance",      kinds: ["insurance"] as DocumentKind[] },
  { id: "vehicle",        label: "Vehicle",        kinds: ["vehicle_reg", "employer_letter"] as DocumentKind[] },
  { id: "bookings",       label: "Bookings",       kinds: ["ferry"] as DocumentKind[] },
  { id: "emergency",      label: "Emergency",      kinds: ["emergency"] as DocumentKind[] },
  { id: "other",          label: "Other",          kinds: ["other"] as DocumentKind[] },
] as const;

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ tripId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("documents")
      .select("id, kind, title, storage_path, mime_type, size_bytes, expires_on, created_at")
      .eq("trip_id", data.tripId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    tripId: z.string().uuid(),
    kind: z.enum(DOCUMENT_KINDS),
    title: z.string().trim().min(1).max(200),
    storagePath: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().max(120).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("documents")
      .insert({
        trip_id: data.tripId,
        owner_id: context.userId,
        kind: data.kind,
        title: data.title,
        storage_path: data.storagePath,
        mime_type: data.mimeType ?? null,
        size_bytes: data.sizeBytes ?? null,
        expires_on: data.expiresOn ?? null,
      })
      .select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const updateDocumentKind = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    kind: z.enum(DOCUMENT_KINDS),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("documents").update({ kind: data.kind }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const replaceDocumentFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    storagePath: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().max(120).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    title: z.string().trim().min(1).max(200).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    // Grab the old path so we can delete the previous file from storage.
    const { data: existing } = await context.supabase
      .from("documents").select("storage_path").eq("id", data.id).maybeSingle();
    const patch = {
      storage_path: data.storagePath,
      mime_type: data.mimeType ?? null,
      size_bytes: data.sizeBytes ?? null,
      ...(data.title ? { title: data.title } : {}),
    };
    const { error } = await context.supabase.from("documents").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    if (existing?.storage_path && existing.storage_path !== data.storagePath) {
      await context.supabase.storage.from("documents").remove([existing.storage_path]);
    }
    return { ok: true };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: doc } = await context.supabase
      .from("documents").select("storage_path").eq("id", data.id).maybeSingle();
    if (doc?.storage_path) {
      await context.supabase.storage.from("documents").remove([doc.storage_path]);
    }
    const { error } = await context.supabase.from("documents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const signDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: doc, error } = await context.supabase
      .from("documents").select("storage_path").eq("id", data.id).maybeSingle();
    if (error || !doc) throw new Error("Not found");
    const { data: signed, error: sErr } = await context.supabase.storage
      .from("documents").createSignedUrl(doc.storage_path, 300);
    if (sErr || !signed) throw new Error(sErr?.message ?? "Sign failed");
    return { url: signed.signedUrl };
  });

/** Ask AI which document kind fits a filename + mime type. Falls back to "other" on any failure. */
export const suggestDocumentKind = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    filename: z.string().trim().min(1).max(300),
    mimeType: z.string().trim().max(120).optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    try {
      const res = await fetch(LOVABLE_AI_URL, {
        method: "POST",
        headers: lovableAiHeaders(),
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content:
                `You classify a travel document into one of these kinds: ${DOCUMENT_KINDS.join(", ")}. ` +
                `Respond with ONLY the kind, lowercase, no punctuation. If unsure, respond "other".`,
            },
            {
              role: "user",
              content: `Filename: ${data.filename}\nMime type: ${data.mimeType ?? "unknown"}`,
            },
          ],
        }),
      });
      if (!res.ok) return { kind: "other" as DocumentKind };
      const body = await res.json();
      const raw = String(body?.choices?.[0]?.message?.content ?? "").trim().toLowerCase();
      const match = DOCUMENT_KINDS.find((k) => raw === k || raw.includes(k));
      return { kind: (match ?? "other") as DocumentKind };
    } catch {
      return { kind: "other" as DocumentKind };
    }
  });
