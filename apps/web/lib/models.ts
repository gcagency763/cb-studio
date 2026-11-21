"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import type { ModelOption } from "@/components/create";

export type Res = "480p" | "720p" | "1080p";
export type CatalogModel = {
  id: string;
  name: string;
  provider: "byteplus" | "fal" | "seedaudio" | "elevenlabs" | "gpu";
  kind: "image" | "video" | "audio" | "avatar" | "upscale" | "lipsync" | "sfx";
  badges: { text: string; tone?: "top" | "free" | "locked" }[];
  note?: string;
  price: { perSec?: Partial<Record<Res, number>>; perImage?: number; perMin?: number; perMp?: number };
  resolutions?: Res[];
  durations?: number[];
  needsFirstFrame?: boolean;
  nativeAudio?: boolean;
  gate?: "fal" | "reserve" | "elevenlabs" | "gpu";
  endFrame?: boolean;
  audioRef?: boolean;
  tip?: string;
  free?: string;
  locked?: string;
};

let cache: CatalogModel[] | null = null;
let inflight: Promise<CatalogModel[]> | null = null;

export function loadModels(): Promise<CatalogModel[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= api<{ models: CatalogModel[] }>("/models").then((r) => (cache = r.models));
  return inflight;
}

/** modelos de um tipo, já no formato do ModelCard; travados vêm por último */
export function useModels(kind: CatalogModel["kind"]) {
  const [models, setModels] = useState<CatalogModel[]>([]);
  useEffect(() => {
    loadModels()
      .then((all) => setModels(all.filter((m) => m.kind === kind).sort((a, b) => Number(!!a.locked) - Number(!!b.locked))))
      .catch(() => {});
  }, [kind]);
  return models;
}

export const toOption = (m: CatalogModel): ModelOption => ({ id: m.id, name: m.name, provider: m.provider, badges: m.badges, note: m.note, locked: m.locked });

/** estimativa local (a API confirma antes de gerar) */
export function estimateVideoUsd(m: CatalogModel | undefined, res: Res, sec: number, audio = false) {
  if (!m) return 0;
  let per = m.price.perSec?.[res] ?? m.price.perSec?.["1080p"] ?? 0;
  if (audio && m.nativeAudio && m.id !== "kling-4.0") per *= m.id === "kling-3.0" ? 1.5 : 2;
  return +(per * sec).toFixed(3);
}
