import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, Send, Trash2 } from "lucide-react";
import {
  deletePushSubscription,
  getVapidPublicKey,
  listMyPushSubscriptions,
  savePushSubscription,
  sendTestPushToMe,
} from "@/lib/push.functions";
import {
  ensureServiceWorker,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-client";

export function NotificationsPanel() {
  const qc = useQueryClient();
  const getKey = useServerFn(getVapidPublicKey);
  const saveSub = useServerFn(savePushSubscription);
  const deleteSub = useServerFn(deletePushSubscription);
  const listSubs = useServerFn(listMyPushSubscriptions);
  const sendTest = useServerFn(sendTestPushToMe);

  const [supported, setSupported] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setSupported(isPushSupported());
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
    if (isPushSupported()) {
      ensureServiceWorker().catch(() => {});
    }
  }, []);

  const subs = useQuery({
    queryKey: ["push-subs"],
    queryFn: () => listSubs(),
  });

  const enable = useMutation({
    mutationFn: async () => {
      const { publicKey } = await getKey();
      const sub = await subscribeToPush(publicKey);
      if (!sub) throw new Error("Permission denied or subscribe failed");
      await saveSub({
        data: { ...sub, label: navigator.userAgent.slice(0, 80) },
      });
    },
    onSuccess: () => {
      setPerm(Notification.permission);
      setMsg("Notifications enabled on this device.");
      qc.invalidateQueries({ queryKey: ["push-subs"] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const disable = useMutation({
    mutationFn: async () => {
      const endpoint = await unsubscribeFromPush();
      if (endpoint) await deleteSub({ data: { endpoint } });
    },
    onSuccess: () => {
      setMsg("Notifications disabled on this device.");
      qc.invalidateQueries({ queryKey: ["push-subs"] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const test = useMutation({
    mutationFn: () =>
      sendTest({
        data: { title: "Tripping", body: "Test push — you're wired up 🎒", url: "/" },
      }),
    onSuccess: (r) => setMsg(`Sent to ${r.sent} device(s).`),
    onError: (e: Error) => setMsg(e.message),
  });

  async function handleRemove(endpoint: string) {
    setBusy(true);
    try {
      await deleteSub({ data: { endpoint } });
      qc.invalidateQueries({ queryKey: ["push-subs"] });
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Push notifications aren't supported in this browser. On iPhone, add Tripping to your Home
        Screen and open it from there to enable notifications.
      </p>
    );
  }

  const list = subs.data ?? [];

  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => enable.mutate()}
          disabled={enable.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
        >
          <Bell className="h-4 w-4" />
          {enable.isPending ? "Enabling…" : "Enable on this device"}
        </button>
        <button
          onClick={() => disable.mutate()}
          disabled={disable.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <BellOff className="h-4 w-4" />
          Disable
        </button>
        <button
          onClick={() => test.mutate()}
          disabled={test.isPending || list.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          Send test
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Permission: <span className="font-medium">{perm}</span>
      </p>

      {msg && <p className="rounded-md bg-muted px-2 py-1 text-xs">{msg}</p>}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Registered devices
        </h3>
        {list.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">No devices yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {list.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-2 rounded-md border border-border/60 bg-card/60 px-2 py-1.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.label ?? "Unknown device"}</div>
                  <div className="text-muted-foreground">
                    Added {new Date(s.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(s.endpoint)}
                  disabled={busy}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
