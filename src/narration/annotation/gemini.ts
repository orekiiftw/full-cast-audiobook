import { GoogleGenAI } from "@google/genai";
import { DEFAULT_TEXT_MODEL } from "../../lib/constants";

const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL;
const ANNOTATION_TIMEOUT_MS = 120_000;

let sharedClient: { apiKey: string; client: GoogleGenAI } | null = null;

export async function requestAnnotation(prompt: string): Promise<string> {
  const client = geminiClient();
  console.log(`🤖 Invoking Gemini annotation model for segment...`);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ANNOTATION_TIMEOUT_MS);
  try {
    const response = await client.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        abortSignal: abort.signal,
      },
    });
    return response.text ?? "";
  } catch (error) {
    if (abort.signal.aborted) {
      throw new Error(`Gemini annotation timed out after ${ANNOTATION_TIMEOUT_MS / 1000}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function geminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set.");
  }
  if (!sharedClient || sharedClient.apiKey !== apiKey) {
    sharedClient = { apiKey, client: new GoogleGenAI({ apiKey }) };
  }
  return sharedClient.client;
}
