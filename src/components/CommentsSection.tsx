import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, Send } from "lucide-react";
import {
  addAuthedComment,
  addPublicComment,
  listPublicComments,
} from "@/lib/comments.functions";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

interface Props {
  postId: string | null;
}

export function CommentsSection({ postId }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const { user } = useAuth();
  const fetchComments = useServerFn(listPublicComments);
  const addAnon = useServerFn(addPublicComment);
  const addAuth = useServerFn(addAuthedComment);

  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState("");
  const [name, setName] = useState("");

  const q = useQuery({
    queryKey: ["comments", postId],
    queryFn: () => fetchComments({ data: { postId: postId! } }),
    enabled: !!postId && expanded,
    staleTime: 30_000,
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!postId) return;
      if (user) {
        await addAuth({ data: { postId, body } });
      } else {
        await addAnon({
          data: { postId, body, visitorLabel: name.trim() || "Visitor" },
        });
      }
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["comments", postId] });
    },
  });

  if (!postId) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">{t("comments.disabled")}</p>
    );
  }

  const count = q.data?.length ?? 0;

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <MessageCircle className="h-3.5 w-3.5" />
        {expanded ? t("comments.hide") : t("comments.show")}
        {count > 0 && <span className="text-muted-foreground">({count})</span>}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {q.isLoading && (
            <p className="text-xs text-muted-foreground">{t("comments.loading")}</p>
          )}
          {!q.isLoading && (q.data?.length ?? 0) === 0 && (
            <p className="text-xs text-muted-foreground">{t("comments.empty")}</p>
          )}
          <ul className="space-y-2">
            {(q.data ?? []).map((c) => (
              <li key={c.id} className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                <div className="text-[11px] font-semibold text-muted-foreground">
                  {c.author_name ?? c.visitor_label ?? t("comments.visitor")} ·{" "}
                  {new Date(c.created_at).toLocaleDateString()}
                </div>
                <div className="mt-0.5 whitespace-pre-wrap">{c.body}</div>
              </li>
            ))}
          </ul>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!body.trim()) return;
              submit.mutate();
            }}
            className="space-y-2"
          >
            {!user && (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder={t("comments.your_name")}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={1000}
                placeholder={
                  user ? t("comments.placeholder_auth") : t("comments.placeholder_anon")
                }
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={submit.isPending || !body.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {submit.isPending ? t("comments.sending") : t("comments.post")}
              </button>
            </div>
            {submit.isError && (
              <p className="text-xs text-destructive">{t("comments.error")}</p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
