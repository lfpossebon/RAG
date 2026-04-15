import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function embed(text: string): Promise<number[]> {
  const r = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return r.data[0].embedding;
}
