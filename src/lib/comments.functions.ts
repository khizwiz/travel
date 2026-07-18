import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const postIdInput = z.object({ postId: z.string().uuid() });

export interface PublicComment {
  id: string;
  post_id: string;
  body: string;
  author_id: string | null;
  visitor_label: string | null;
  author_name: string | null;
  created_at: string;
}

/** Public: list active comments for a post. */
export const listPublicComments = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => postIdInput.parse(d))
  .handler(async ({ data }): Promise<PublicComment[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Confirm the post is public + active before returning any comments.
    const { data: post } = await supabaseAdmin
      .from("posts")
      .select("id, visibility, status")
      .eq("id", data.postId)
      .maybeSingle();
    if (!post || post.visibility !== "public" || post.status !== "active") return [];
    const { data: rows, error } = await supabaseAdmin
      .from("comments")
      .select("id, post_id, body, author_id, visitor_label, created_at")
      .eq("post_id", data.postId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    const authorIds = Array.from(
      new Set((rows ?? []).map((r) => r.author_id).filter((v): v is string => !!v)),
    );
    const nameFor: Record<string, string> = {};
    if (authorIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, display_name")
        .in("id", authorIds);
      for (const p of profs ?? []) nameFor[p.id] = p.display_name ?? "Traveller";
    }
    return (rows ?? []).map((r) => ({
      ...r,
      author_name: r.author_id ? (nameFor[r.author_id] ?? "Traveller") : null,
    }));
  });

const addAnonInput = z.object({
  postId: z.string().uuid(),
  body: z.string().trim().min(1).max(1000),
  visitorLabel: z.string().trim().min(1).max(40),
});

/** Public: anonymous visitor posts a comment on a public post. */
export const addPublicComment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => addAnonInput.parse(d))
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await sb.from("comments").insert({
      post_id: data.postId,
      body: data.body,
      visitor_label: data.visitorLabel,
      status: "active",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const addAuthInput = z.object({
  postId: z.string().uuid(),
  body: z.string().trim().min(1).max(1000),
});

/** Authenticated: signed-in comment (uses profile display_name). */
export const addAuthedComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => addAuthInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("comments").insert({
      post_id: data.postId,
      body: data.body,
      author_id: context.userId,
      status: "active",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
