export * from "./types.js";
export * from "./catalog.js";
export { BytePlusProvider, RESERVE_FUND_MODELS, type BytePlusConfig } from "./byteplus/index.js";
export { FalProvider, type FalConfig } from "./fal/index.js";
export { SeedAudioProvider, type SeedAudioConfig } from "./seedaudio/index.js";
export { ElevenLabsProvider, type ElevenLabsConfig } from "./elevenlabs/index.js";
export { GpuProvider, type GpuConfig } from "./gpu/index.js";

import { BytePlusProvider } from "./byteplus/index.js";
import { FalProvider } from "./fal/index.js";
import { SeedAudioProvider } from "./seedaudio/index.js";
import { ElevenLabsProvider } from "./elevenlabs/index.js";
import { GpuProvider } from "./gpu/index.js";
import type { Provider } from "./types.js";

/**
 * Monta o registro de provedores a partir das variáveis de ambiente.
 * Só instancia o que tiver chave — assim o app sobe só com BytePlus.
 */
export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): Record<string, Provider> {
  const out: Record<string, Provider> = {};
  if (env.ARK_API_KEY) {
    out.byteplus = new BytePlusProvider({
      apiKey: env.ARK_API_KEY,
      baseUrl: env.ARK_BASE_URL,
      videoModel: env.ARK_VIDEO_MODEL,
      videoModelFast: env.ARK_VIDEO_MODEL_FAST,
      imageModel: env.ARK_IMAGE_MODEL,
      allowReserveFund: env.ARK_ALLOW_SEEDANCE_2 === "true",
    });
  }
  const speechKey = env.SEED_SPEECH_API_KEY || env.ARK_API_KEY;
  if (speechKey) out.seedaudio = new SeedAudioProvider({ apiKey: speechKey, baseUrl: env.SEED_SPEECH_BASE_URL });
  if (env.FAL_KEY) out.fal = new FalProvider({ apiKey: env.FAL_KEY });
  if (env.ELEVENLABS_API_KEY) out.elevenlabs = new ElevenLabsProvider({ apiKey: env.ELEVENLABS_API_KEY, model: env.ELEVENLABS_MODEL, defaultVoiceId: env.ELEVENLABS_VOICE_ID });
  if ((env.G2_GPU_URL || env.G2_GPU_H3_URL) && env.G2_GPU_TOKEN) {
    out.gpu = new GpuProvider({
      url: env.G2_GPU_URL,
      h3Url: env.G2_GPU_H3_URL,
      h3UsdPerHour: env.G2_GPU_H3_USD_PER_HOUR ? Number(env.G2_GPU_H3_USD_PER_HOUR) : undefined,
      h3SecPerClip: env.G2_GPU_H3_SEC ? Number(env.G2_GPU_H3_SEC) : undefined,
      token: env.G2_GPU_TOKEN,
      usdPerHour: env.G2_GPU_USD_PER_HOUR ? Number(env.G2_GPU_USD_PER_HOUR) : undefined,
      secPerClip720: env.G2_GPU_SEC_720 ? Number(env.G2_GPU_SEC_720) : undefined,
      secPerClip480: env.G2_GPU_SEC_480 ? Number(env.G2_GPU_SEC_480) : undefined,
    });
  }
  return out;
}
