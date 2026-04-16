import { NextRequest, NextResponse } from "next/server";
import { anthropic, embed } from "@/lib/llm";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 90;

const VISION_PROMPT = `Analise esta imagem e extraia as informações seguindo RIGOROSAMENTE este formato JSON:

{
  "tipo": "qualitativo" | "quantitativo" | "misto",
  "fonte": "nome do documento/relatorio/sistema de origem",
  "data_referencia": "YYYY-MM-DD (use dia 01 se so tiver mes/ano)",
  "doc_id": "slug identificador da SERIE do documento (ex: rob_mensal, despesas_mensal, perda_esperada, captacao_bradesco). Use snake_case. MESMO documento recorrente em meses diferentes deve ter MESMO doc_id",
  "periodicidade": "mensal" | "trimestral" | "semestral" | "anual" | "unico",
  "categoria": "captacao" | "investimentos" | "credito" | "seguros" | "resultado" | "mercado" | "regulatorio" | "estrategia" | "outro",
  "titulo": "titulo curto descritivo",
  "resumo": "resumo executivo de 1-2 frases",
  "contexto_qualitativo": "texto corrido com analises, contextos, explicacoes (null se nao houver)",
  "dados_numericos": [
    { "metrica": "snake_case", "area": "area", "valor": 0, "unidade": "reais|milhoes|bilhoes|percentual|quantidade|outro", "periodo": "YYYY-MM", "contexto": "breve contexto" }
  ],
  "texto_extraido": "transcricao completa do texto visivel"
}

REGRAS CRITICAS:
- doc_id: abstraia o mes/ano do titulo. Ex: "Relatorio ROB Janeiro 2026" e "Relatorio ROB Fevereiro 2026" devem ter MESMO doc_id "rob_mensal". NAO inclua data no doc_id.
- data_referencia: identifique o mes/ano que o relatorio se refere, NAO a data em que foi criado. Sempre formato YYYY-MM-DD (use 01 como dia).
- Se for puro texto/analise: tipo="qualitativo", dados_numericos=[]
- Se for tabela sem narrativa: tipo="quantitativo", contexto_qualitativo=null
- Normalize valores (150 milhoes = 150000000), snake_case em metricas, datas ISO
- Responda APENAS JSON valido, sem markdown.`;

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, mimeType = "image/jpeg", contexto = "" } = await req.json();
    if (!imageBase64) return NextResponse.json({ error: "imageBase64 obrigatório" }, { status: 400 });

    // Remove qualquer prefixo data:URL e whitespace, garante so chars validos base64
    let cleanB64 = String(imageBase64)
      .replace(/^data:[^;]+;base64,/, "")
      .replace(/\s+/g, "");

    if (!/^[A-Za-z0-9+/]+=*$/.test(cleanB64)) {
      const badChar = cleanB64.split("").find((c) => !/[A-Za-z0-9+/=]/.test(c));
      console.error("[ingest] base64 invalido, char:", badChar?.charCodeAt(0));
      return NextResponse.json(
        { error: `base64 contem char invalido (code ${badChar?.charCodeAt(0)})` },
        { status: 400 }
      );
    }

    // Inspeciona magic bytes pra detectar o formato real
    const firstBytes = Buffer.from(cleanB64.slice(0, 32), "base64");
    let detectedType = mimeType;
    if (firstBytes[0] === 0xff && firstBytes[1] === 0xd8) detectedType = "image/jpeg";
    else if (firstBytes[0] === 0x89 && firstBytes[1] === 0x50) detectedType = "image/png";
    else if (firstBytes[0] === 0x47 && firstBytes[1] === 0x49) detectedType = "image/gif";
    else if (firstBytes[0] === 0x52 && firstBytes[1] === 0x49) detectedType = "image/webp";

    const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const safeType = validTypes.includes(detectedType) ? detectedType : "image/jpeg";

    console.log(
      `[ingest] base64 len: ${cleanB64.length}, magic: ${firstBytes
        .slice(0, 4)
        .toString("hex")}, claimed: ${mimeType}, detected: ${detectedType}, using: ${safeType}`
    );

    // 1) Vision via Claude
    const vision = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: safeType, data: cleanB64 } },
            { type: "text", text: `${VISION_PROMPT}\n\nContexto do usuário: ${contexto || "Nenhum"}` },
          ],
        },
      ],
    });

    console.log("[ingest] vision OK");

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

    console.log("[ingest] parsed:", parsed.titulo);

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

    console.log("[ingest] embedding OK, dims:", embedding.length);

    // 3) Grava como rascunho
    // Normaliza data_referencia (aceita "YYYY-MM" ou "YYYY-MM-DD")
    let dataRef: string | null = null;
    if (parsed.data_referencia && typeof parsed.data_referencia === "string") {
      const d = parsed.data_referencia.trim();
      if (/^\d{4}-\d{2}$/.test(d)) dataRef = `${d}-01`;
      else if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dataRef = d;
    }

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
        doc_id: parsed.doc_id || null,
        data_referencia: dataRef,
        tipo_conteudo: parsed.tipo || null,
      })
      .select()
      .single();

    if (error) {
      console.error("[ingest] supabase error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[ingest] salvo:", data.id);
    return NextResponse.json({ documento: data, parsed });
  } catch (e: any) {
    console.error("[ingest] error:", e.message, e.status, JSON.stringify(e.error || {}));
    return NextResponse.json(
      { error: e.message || "erro desconhecido" },
      { status: e.status || 500 }
    );
  }
}
