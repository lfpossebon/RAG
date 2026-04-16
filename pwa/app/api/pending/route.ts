import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { data, error } = await supabaseAdmin
    .from("documentos")
    .select("id,titulo,resumo,categoria,fonte,metadata,created_at")
    .eq("status", "rascunho")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ docs: data });
}
