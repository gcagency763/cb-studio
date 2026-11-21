"use client";

import { useState } from "react";
import { api, type Voice } from "@/lib/api";
import { Modal, ReferencePicker } from "@/components/create";
import { useToast } from "@/components/Toasts";

/** Cadastro de voz clonada com autorização da pessoa — usado em Áudio e em Clone. */
export function NewVoiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (v: Voice) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [ref, setRef] = useState<string | null>(null);
  const [consentName, setConsentName] = useState("");
  const [consentOk, setConsentOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim() || !ref || !consentName.trim() || !consentOk) return toast("Preencha nome, áudio e a autorização", "bad");
    setBusy(true);
    try {
      const v = await api<Voice>("/voices", { method: "POST", body: JSON.stringify({ name: name.trim(), referenceUrl: ref, consentName: consentName.trim(), consentNote: "Autorização confirmada no CB Studio" }) });
      toast(`Voz "${v.name}" salva`, "ok");
      onCreated(v);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Nova voz" onClose={onClose}>
      <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
        <div className="field">
          <label htmlFor="vn">Nome da voz</label>
          <input id="vn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Cirilo — narração" />
        </div>
        <ReferencePicker kind="audio" label="Áudio de referência (10–30 s, sem música de fundo)" value={ref} onChange={setRef} accept="audio/*" hint="mp3 ou wav, até 10 MB" />
        <div className="field">
          <label htmlFor="cn">Quem autorizou o uso da voz</label>
          <input id="cn" className="input" value={consentName} onChange={(e) => setConsentName(e.target.value)} placeholder="Nome completo da pessoa dona da voz" />
        </div>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12.5, color: "var(--ink-2)" }}>
          <input type="checkbox" checked={consentOk} onChange={(e) => setConsentOk(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Confirmo que essa pessoa autorizou a G2 Educação a clonar e usar a voz dela em vídeos. Vozes de terceiros sem autorização não podem ser cadastradas.</span>
        </label>
        <button className="btn primary" disabled={busy} onClick={save}>
          {busy ? "Salvando…" : "Salvar voz"}
        </button>
      </div>
    </Modal>
  );
}
