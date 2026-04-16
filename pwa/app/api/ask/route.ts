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
    match_count: 10,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 1b) Enriquece com doc_id e data_referencia (match_documents nao retorna esses campos)
  const ids = (docs ?? []).map((d: any) => d.id);
  let extras: Record<string, { doc_id: string | null; data_referencia: string | null }> = {};
  if (ids.length > 0) {
    const { data: extraData } = await supabaseAdmin
      .from("documentos")
      .select("id, doc_id, data_referencia")
      .in("id", ids);
    for (const row of extraData ?? []) {
      extras[row.id] = { doc_id: row.doc_id, data_referencia: row.data_referencia };
    }
  }

  const enriched = (docs ?? []).map((d: any) => ({
    ...d,
    doc_id: extras[d.id]?.doc_id ?? null,
    data_referencia: extras[d.id]?.data_referencia ?? null,
  }));

  // 2) Monta contexto com metadados de serie e data
  const contexto = enriched
    .map((d: any, i: number) => {
      const meta = [
        `categoria=${d.categoria}`,
        d.doc_id ? `serie=${d.doc_id}` : null,
        d.data_referencia ? `data_ref=${d.data_referencia}` : null,
        `similaridade=${d.similarity.toFixed(3)}`,
      ]
        .filter(Boolean)
        .join(", ");
      return `[${i + 1}] ${d.titulo} (${meta})\n${d.resumo}\n---\n${d.conteudo}`;
    })
    .join("\n\n");

  const hoje = new Date().toISOString().slice(0, 10);

  const systemPrompt = `Você é um assistente executivo pessoal do usuário. Responda em português do Brasil, de forma objetiva e acionável.
Hoje é ${hoje}.

REGRAS DE USO DO CONTEXTO:
- Use APENAS informações dos documentos fornecidos. Se não houver evidência suficiente, diga que não encontrou.
- Cite as fontes pelo número [N].
- Cada documento tem metadados entre parênteses: serie (doc_id), data_ref (mes de referencia), similaridade.
- Se multiplos documentos tiverem a MESMA serie (mesmo doc_id) e datas diferentes, eles sao versoes historicas do MESMO relatorio.
- Por padrao, quando a pergunta nao especifica periodo (ex: "qual o ROB?", "como esta a captacao?"), responda com o documento da serie MAIS RECENTE (maior data_ref) e mencione a data de referencia.
- Se a pergunta pedir explicitamente historico/evolucao/comparativo (ex: "evolucao mensal", "compare jan vs fev", "como tem evoluido"), use TODOS os documentos da serie ordenados por data.
- Se a pergunta especificar um periodo (ex: "ROB de janeiro"), use apenas o documento com data_ref daquele periodo.
- Sempre mencione a data de referencia quando responder com um relatorio mensal.`;

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
    sources: enriched.map((d: any) => ({
      id: d.id,
      titulo: d.titulo,
      categoria: d.categoria,
      similarity: d.similarity,
      doc_id: d.doc_id,
      data_referencia: d.data_referencia,
    })),
  });
}
