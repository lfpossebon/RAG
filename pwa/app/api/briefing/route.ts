import { NextRequest, NextResponse } from "next/server";
import { anthropic } from "@/lib/llm";
import { supabaseAdmin } from "@/lib/supabase";
import { checkAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: docs } = await supabaseAdmin
    .from("documentos")
    .select("titulo,resumo,categoria,created_at")
    .eq("status", "ativo")
    .order("created_at", { ascending: false })
    .limit(20);

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    system:
      "Você é um Chief of Staff preparando um briefing executivo diário. Use este formato:\n\n1️⃣ DESTAQUES PRINCIPAIS\n2️⃣ MÉTRICAS-CHAVE\n3️⃣ PONTOS DE ATENÇÃO\n\nSeja conciso, acionável. Máximo 600 palavras.",
    messages: [
      {
        role: "user",
        content: `Documentos recentes:\n${JSON.stringify(docs ?? [], null, 2)}\n\nMonte o briefing.`,
      },
    ],
  });

  const briefing = msg.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");

  return NextResponse.json({ briefing, total: docs?.length ?? 0 });
}
