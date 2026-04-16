import { NextRequest, NextResponse } from "next/server";
import { anthropic, embed } from "@/lib/llm";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {

  const { question, history = [] } = await req.json();
  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "question obrigatório" }, { status: 400 });
  }

  // 1) Embedding e busca semantica
  const queryEmbedding = await embed(question);
  const { data: docs, error } = await supabaseAdmin.rpc("match_documents", {
    query_embedding: queryEmbedding,
    match_threshold: 0.5,
    match_count: 8,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 2) Monta contexto
  const contexto = (docs ?? [])
    .map(
      (d: any, i: number) =>
        `[${i + 1}] ${d.titulo} (${d.categoria}, similaridade=${d.similarity.toFixed(3)})\n${d.resumo}\n---\n${d.conteudo}`
    )
    .join("\n\n");

  const systemPrompt = `Você é um assistente executivo pessoal do usuário. Responda em português do Brasil, de forma objetiva e acionável.
Use APENAS informações do contexto fornecido. Se não houver evidência suficiente, diga que não encontrou.
Cite as fontes pelo número [N] quando aplicável.`;

  // 3) Chama Claude
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1200,
    system: systemPrompt,
    messages: [
      ...history.slice(-6),
      {
        role: "user",
        content: `Pergunta: ${question}\n\nContexto recuperado:\n${contexto || "(nenhum documento relevante encontrado)"}`,
      },
    ],
  });

  const answer = msg.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");

  return NextResponse.json({
    answer,
    sources: (docs ?? []).map((d: any) => ({
      id: d.id,
      titulo: d.titulo,
      categoria: d.categoria,
      similarity: d.similarity,
    })),
  });
}
