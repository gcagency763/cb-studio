import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env.js";

export const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const GENERATION_QUEUE = "generation";

export interface GenerationJobData {
  jobId: string; // id na nossa tabela jobs
  provider: string; // "byteplus" | "fal"
  request: import("@g2/providers").GenerationRequest;
}

export const generationQueue = new Queue<GenerationJobData>(GENERATION_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});

export const RENDER_QUEUE = "render";

export interface RenderJobData {
  jobId: string;
  scenes: import("./render.js").RenderScene[];
  options: import("./render.js").RenderOptions;
}

export const renderQueue = new Queue<RenderJobData>(RENDER_QUEUE, {
  connection: redis,
  defaultJobOptions: { attempts: 1, removeOnComplete: 200, removeOnFail: 500 },
});

export const EDIT_QUEUE = "edit";

/** transcrição, legenda e cortes de vídeo gravado — tudo local (CPU), um por vez */
export type EditJobData =
  | { jobId: string; task: "transcribe"; videoUrl: string }
  | { jobId: string; task: "caption"; videoUrl: string; transcriptUrl?: string; options: import("./edit.js").CaptionOptions }
  | { jobId: string; task: "cuts"; videoUrl: string; transcriptUrl?: string; options: import("./edit.js").CutsOptions }
  | { jobId: string; task: "recreate"; videoUrl: string; transcriptUrl?: string; theme: string; style?: string; scenes?: number; projectId?: string; audience?: string; tone?: string; context?: string; voiceId?: string | null }
  | { jobId: string; task: "batch"; campaignId: string; scenes?: number; style?: string; audience?: string; tone?: string }
  | { jobId: string; task: "dub"; videoUrl: string; transcriptUrl?: string; options: import("./dub.js").DubOptions }
  | { jobId: string; task: "cut"; videoUrl: string; transcriptUrl?: string; start: number; end: number; title?: string; options: import("./edit.js").CutsOptions }
  | { jobId: string; task: "carousel"; options: import("./carousel.js").CarouselOptions }
  | { jobId: string; task: "extend"; sourceJobId: string; options: import("./extend.js").ExtendOptions }
  | { jobId: string; task: "upscale-video"; sourceJobId: string; options: { to?: "1080p" | "4k"; fps60?: boolean } }
  | { jobId: string; task: "still"; imageUrl: string; options: import("./extend.js").StillOptions };

export const editQueue = new Queue<EditJobData>(EDIT_QUEUE, {
  connection: redis,
  defaultJobOptions: { attempts: 1, removeOnComplete: 200, removeOnFail: 500 },
});
