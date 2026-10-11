import { GoogleGenAI, ApiError, ThinkingLevel } from "@google/genai";
import { sleep } from "./http";

export class GeminiQuotaError extends Error {}
export class GeminiUnavailableError extends Error {}

export interface GeminiResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export type GeminiCall = (args: { system: string; prompt: string; schema: object; task: string }) => Promise<GeminiResult>;

let client: GoogleGenAI | null = null;

export function geminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-3.8-flash";
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Structured-JSON call to Gemini Flash via the official Google Gen AI SDK.
 * Sequential by design; backs off on 429 / 5xx; raises GeminiQuotaError when the free-tier quota is exhausted.
 */
export const callGemini: GeminiCall = async ({ system, prompt, schema }) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiUnavailableError("GEMINI_API_KEY not set");
  client ??= new GoogleGenAI({ apiKey });
  const model = geminiModel();
  const delays = [2000, 6000, 15000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await client.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          temperature: 0.3,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const u = res.usageMetadata;
      return {
        text: res.text ?? "",
        inputTokens: u?.promptTokenCount ?? 0,
        outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
        model,
      };
    } catch (e) {
      lastErr = e;
      const status = e instanceof ApiError ? e.status : 0;
      const msg = e instanceof Error ? e.message : String(e);
      if (status === 429 || /RESOURCE_EXHAUSTED/i.test(msg)) {
        // per-day quota exhaustion will not recover within this request
        if (/per.?day|PerDay|daily/i.test(msg) || attempt === delays.length) throw new GeminiQuotaError("Gemini free-tier quota exhausted");
        await sleep(delays[attempt]);
        continue;
      }
      if (status >= 500 && attempt < delays.length) {
        await sleep(delays[attempt]);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
};
