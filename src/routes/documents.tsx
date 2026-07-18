import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Eye, FileText, FolderOpen, Loader2, Lock, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getDefaultTrip } from "@/lib/access.functions";
import {
  createDocument, deleteDocument, listDocuments, replaceDocumentFile, signDocumentUrl,
  suggestDocumentKind, updateDocumentKind, DOCUMENT_FOLDERS, DOCUMENT_KINDS, type DocumentKind,
} from "@/lib/documents.functions";
import { OwnerOnly } from "@/components/OwnerOnly";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/documents")({
  head: () => ({ meta: [{ title: "Documents — Tripping" }] }),
  component: () => (
    <OwnerOnly page="Documents">
      <DocumentsPage />
    </OwnerOnly>
  ),
});

function fmtBytes(n: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function folderIdForKind(kind: string): string {
  const f = DOCUMENT_FOLDERS.find((f) => (f.kinds as readonly string[]).includes(kind));
  return f?.id ?? "other";
}

const KIND_LABEL: Record<DocumentKind, string> = {
  passport: "Passport", visa: "Visa", vehicle_reg: "Vehicle registration",
  insurance: "Insurance", employer_letter: "Employer letter",
  ferry: "Ferry / booking", emergency: "Emergency", other: "Other",
};

function DocumentsPage() {
  const { user, isOwner, loading } = useAuth();
  const fetchTrip = useServerFn(getDefaultTrip);
  const fetchList = useServerFn(listDocuments);
  const doSign = useServerFn(signDocumentUrl);
  const doDelete = useServerFn(deleteDocument);
  const doCreate = useServerFn(createDocument);
  const doSuggest = useServerFn(suggestDocumentKind);
  const doUpdateKind = useServerFn(updateDocumentKind);
  const doReplace = useServerFn(replaceDocumentFile);

  const [tripId, setTripId] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<{ id: string; suggestedKind: DocumentKind; title: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTargetIdRef = useRef<string | null>(null);

  useEffect(() => { if (isOwner) fetchTrip().then((t) => t && setTripId(t.id)); }, [fetchTrip, isOwner]);
  useEffect(() => { if (tripId) refresh(); }, [tripId]);
  async function refresh() {
    if (!tripId) return;
    setRows(await fetchList({ data: { tripId } }));
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const d of DOCUMENT_FOLDERS) c[d.id] = 0;
    for (const r of rows) c[folderIdForKind(r.kind)] = (c[folderIdForKind(r.kind)] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (activeFolder === "all") return rows;
    return rows.filter((r) => folderIdForKind(r.kind) === activeFolder);
  }, [rows, activeFolder]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!user || !isOwner) {
    return (
      <div className="space-y-4">
        <header><h1 className="font-display text-3xl">Documents</h1></header>
        <div className="card-elev p-6 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-2 font-medium">Owner-only vault</div>
          <p className="mt-1 text-sm text-muted-foreground">Travel documents are not exposed to passengers or public visitors.</p>
        </div>
      </div>
    );
  }

  const onOpen = async (id: string) => {
    setBusyId(id);
    try {
      const { url } = await doSign({ data: { id } });
      window.open(url, "_blank", "noopener");
    } finally { setBusyId(null); }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Delete this document?")) return;
    await doDelete({ data: { id } });
    refresh();
  };

  const onReplaceClick = (id: string) => {
    replaceTargetIdRef.current = id;
    replaceRef.current?.click();
  };
  const onReplaceFile = async (file: File | null) => {
    const id = replaceTargetIdRef.current;
    replaceTargetIdRef.current = null;
    if (!file || !id || !tripId) return;
    if (file.size > 25 * 1024 * 1024) { setErr(`${file.name}: max 25 MB`); return; }
    setBusyId(id);
    try {
      const path = `${user!.id}/${tripId}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file, {
        upsert: false, contentType: file.type || "application/octet-stream",
      });
      if (upErr) throw new Error(upErr.message);
      await doReplace({ data: {
        id, storagePath: path, mimeType: file.type || undefined,
        sizeBytes: file.size, title: file.name,
      }});
      refresh();
    } catch (e: any) { setErr(e?.message ?? "Replace failed"); }
    finally {
      setBusyId(null);
      if (replaceRef.current) replaceRef.current.value = "";
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || !tripId) return;
    setErr(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: max 25 MB`);
        const path = `${user!.id}/${tripId}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("documents").upload(path, file, {
          upsert: false, contentType: file.type || "application/octet-stream",
        });
        if (upErr) throw new Error(upErr.message);
        // AI-suggest the kind, then create the row with that suggestion.
        let suggestedKind: DocumentKind = "other";
        try {
          const s = await doSuggest({ data: { filename: file.name, mimeType: file.type || undefined } });
          suggestedKind = s.kind;
        } catch { /* fallback to other */ }
        const { id } = await doCreate({ data: {
          tripId, kind: suggestedKind, title: file.name,
          storagePath: path, mimeType: file.type || undefined, sizeBytes: file.size,
        }});
        // Prompt user to confirm/override AI suggestion.
        setPendingKind({ id, suggestedKind, title: file.name });
      }
      refresh();
      if (inputRef.current) inputRef.current.value = "";
    } catch (e: any) { setErr(e?.message ?? "Upload failed"); }
    finally { setUploading(false); }
  };

  const onSetKind = async (id: string, kind: DocumentKind) => {
    await doUpdateKind({ data: { id, kind } });
    setPendingKind(null);
    refresh();
  };

  const FOLDER_TABS = [
    { id: "all", label: "All" },
    ...DOCUMENT_FOLDERS.map((f) => ({ id: f.id, label: f.label })),
  ];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-3xl">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Private file vault. AI sorts uploads into folders automatically — confirm or change the folder after each upload.
        </p>
      </header>

      <label
        className="card-elev flex cursor-pointer flex-col items-center justify-center gap-2 p-8 text-center transition hover:border-primary/40"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
        {uploading ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <Upload className="h-6 w-6 text-primary" />}
        <div className="text-sm font-medium">
          {uploading ? "Uploading & sorting…" : "Tap to upload or drop files here"}
        </div>
        <div className="text-xs text-muted-foreground">Any file type · up to 25 MB · AI picks the folder</div>
      </label>

      <input
        ref={replaceRef}
        type="file"
        className="hidden"
        onChange={(e) => onReplaceFile(e.target.files?.[0] ?? null)}
      />

      {err && <div className="text-sm text-red-600">{err}</div>}

      {pendingKind && (
        <div className="card-elev border-l-4 border-l-primary p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5" /> AI suggestion
          </div>
          <div className="mt-1 text-sm">
            <span className="font-medium">{pendingKind.title}</span> — AI thinks this is{" "}
            <span className="font-semibold">{KIND_LABEL[pendingKind.suggestedKind]}</span>. Confirm or move it:
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {DOCUMENT_KINDS.map((k) => (
              <button
                key={k}
                onClick={() => onSetKind(pendingKind.id, k)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                  k === pendingKind.suggestedKind
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <button
            onClick={() => setPendingKind(null)}
            className="mt-3 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Skip — keep AI suggestion
          </button>
        </div>
      )}

      {/* Folder tabs */}
      <div className="flex flex-wrap gap-1.5">
        {FOLDER_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveFolder(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
              activeFolder === t.id
                ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--cream)]"
                : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t.label}
            <span className="text-[10px] opacity-70">{counts[t.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <ul className="space-y-2">
        {filtered.map((d) => (
          <li key={d.id} className="card-elev flex items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{d.title}</div>
                <div className="text-xs text-muted-foreground">
                  <select
                    value={d.kind}
                    onChange={(e) => doUpdateKind({ data: { id: d.id, kind: e.target.value as DocumentKind } }).then(refresh)}
                    className="mr-1 rounded border border-border bg-card px-1 py-0.5 text-[11px]"
                  >
                    {DOCUMENT_KINDS.map((k) => (
                      <option key={k} value={k}>{KIND_LABEL[k]}</option>
                    ))}
                  </select>
                  {d.mime_type ?? "file"}
                  {d.size_bytes ? ` · ${fmtBytes(d.size_bytes)}` : ""}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button onClick={() => onReplaceClick(d.id)} disabled={busyId === d.id}
                className="rounded-md border border-border bg-card p-1.5 hover:bg-muted"
                aria-label="Replace file" title="Replace file">
                {busyId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
              <button onClick={() => onOpen(d.id)} disabled={busyId === d.id}
                className="rounded-md border border-border bg-card p-1.5 hover:bg-muted"
                aria-label="Preview">
                {busyId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              </button>
              <button onClick={() => onDelete(d.id)}
                className="rounded-md border border-border bg-card p-1.5 text-destructive hover:bg-destructive/10"
                aria-label="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="card-elev p-6 text-center text-sm text-muted-foreground">
            {activeFolder === "all"
              ? "No files yet. Upload passports, visas, vehicle papers or anything else you might want handy on the road."
              : "Nothing in this folder yet."}
          </li>
        )}
      </ul>
    </div>
  );
}
