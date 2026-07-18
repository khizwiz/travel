import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { verifyAdminPassword, verifyAdminToken } from "./admin-auth.functions";

const STORAGE_KEY = "et_admin_token_v1";

export type AdminRole = "owner" | "crew";

interface AdminAuthCtx {
  isAdmin: boolean;
  role: AdminRole | null;
  loading: boolean;
  signIn: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AdminAuthCtx>({
  isAdmin: false,
  role: null,
  loading: true,
  signIn: async () => {},
  signOut: async () => {},
});

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<AdminRole | null>(null);
  const [loading, setLoading] = useState(true);
  const verifyPwd = useServerFn(verifyAdminPassword);
  const verifyTok = useServerFn(verifyAdminToken);

  useEffect(() => {
    let alive = true;
    if (typeof window === "undefined") {
      setLoading(false);
      return;
    }
    const token = window.localStorage.getItem(STORAGE_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    verifyTok({ data: { token } })
      .then((r) => {
        if (!alive) return;
        if (r.valid) setRole(r.role ?? "owner");
        else window.localStorage.removeItem(STORAGE_KEY);
      })
      .catch(() => {
        if (alive) window.localStorage.removeItem(STORAGE_KEY);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [verifyTok]);

  const signIn = useCallback(
    async (password: string) => {
      const { token, supabaseEmail, role: r } = await verifyPwd({ data: { password } });
      const { error } = await supabase.auth.signInWithPassword({
        email: supabaseEmail,
        password,
      });
      if (error) throw new Error(`Backend sign-in failed: ${error.message}`);
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, token);
      setRole(r);
    },
    [verifyPwd],
  );

  const signOut = useCallback(async () => {
    if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
    await supabase.auth.signOut().catch(() => {});
    setRole(null);
  }, []);

  return (
    <Ctx.Provider value={{ isAdmin: role !== null, role, loading, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAdminAuth() {
  return useContext(Ctx);
}

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}
