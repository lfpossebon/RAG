import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { id, action } = await req.json();
  if (!id || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "id e action (approve|reject) obrigatórios" }, { status: 400 });
  }

  const novoStatus = action === "approve" ? "ativo" : "arquivo";
  const { error } = await supabaseAdmin
    .from("documentos")
    .update({ status: novoStatus })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status: novoStatus });
}
