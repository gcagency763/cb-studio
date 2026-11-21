"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; text: string; tone?: "ok" | "bad" };
const Ctx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, tone?: Toast["tone"]) => {
    const id = ++seq.current;
    setItems((l) => [...l, { id, text, tone }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), tone === "bad" ? 9000 : 4000);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

/* ───────────────────────── confirm (modal próprio, sem window.confirm) ───────────────────────── */

type ConfirmReq = { text: string; okLabel?: string; resolve: (ok: boolean) => void };
const ConfirmCtx = createContext<(text: string, okLabel?: string) => Promise<boolean>>(async () => true);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const ask = useCallback((text: string, okLabel?: string) => new Promise<boolean>((resolve) => setReq({ text, okLabel, resolve })), []);
  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {req && (
        <div className="modal-bg" onClick={() => close(false)} role="dialog" aria-modal="true" data-confirm="open">
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, gap: 16 }}>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5 }}>{req.text}</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => close(false)} data-confirm="cancel">
                Cancelar
              </button>
              <button className="btn primary" onClick={() => close(true)} data-confirm="ok" autoFocus>
                {req.okLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);
