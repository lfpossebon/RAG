import { NextRequest, NextResponse } from "next/server";
import { anthropic, embed } from "@/lib/llm";
import { supabaseAdmin } from "@/lib/supabase";
import { checkAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

const VISION_PROMPT = `Analise esta imagem e extraia as informações seguindo RIGOROSAMENTE este formato JSON:

{
  "tipo": "qualitativo" | "quantitativo" | "misto",
  "fonte": "nome do documento/relatorio/sistema de origem",
  "data_referencia": "YYYY-MM ou YYYY-MM-DD se disponivel",
  "categoria": "captacao" | "investimentos" | "credito" | "seguros" | "resultado" | "mercado" | "regulatorio" | "estrategia" | "outro",
  "titulo": "titulo curto descritivo",
  "resumo": "resumo executivo de 1-2 frases",
  "contexto_qualitativo": "texto corrido com analises, contextos, explicacoes (null se nao houver)",
  "dados_numericos": [
    { "metrica": "snake_case", "area": "area", "valor": 0, "unidade": "reais|milhoes|bilhoes|percentual|quantidade|outro", "periodo": "YYYY-MM", "contexto": "breve contexto" }
  ],
  "texto_extraido": "transcricao completa do texto visivel"
}

REGRAS:
- Se for puro texto/analise: tipo="qualitativo", dados_numericos=[]
- Se for tabela sem narrativa: tipo="quantitativo", contexto_qualitativo=null
- Normalize valores (150 milhoes = 150000000), snake_case em metricas, datas ISO
- Responda APENAS JSON válido, sem markdown.`;

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { imageBase64, mimeType = "image/jpeg", contexto = "" } = await req.json();
  if (!imageBase64) return NextResponse.json({ error: "imageBase64 obrigatório" }, { status: 400 });

  // 1) Vision via Claude
  const vision = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: imageBase64 } },
          { type: "text", text: `${VISION_PROMPT}\n\nContexto do usuário: ${contexto || "Nenhum"}` },
        ],
      },
    ],
  });

  const raw = vision.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim()
    .replace(/^```json\s*|\s*```$/g, "");

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "vision JSON inválido", raw }, { status: 422 });
  }

  // 2) Texto para embedding
  const textoParaEmbedding = [
    parsed.titulo,
    parsed.resumo,
    parsed.contexto_qualitativo,
    parsed.texto_extraido,
  ]
    .filter(Boolean)
    .join("\n\n");

  const embedding = await embed(textoParaEmbedding);

  // 3) Grava como rascunho
  const { data, error } = await supabaseAdmin
    .from("documentos")
    .insert({
      titulo: parsed.titulo || "(sem título)",
      resumo: parsed.resumo || "",
      conteudo: textoParaEmbedding,
      categoria: parsed.categoria || "outro",
      fonte: parsed.fonte || "upload",
      metadata: parsed,
      embedding,
      status: "rascunho",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ documento: data, parsed });
}
