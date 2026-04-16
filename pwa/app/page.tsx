"use client";

import { useEffect, useRef, useState, ReactNode } from "react";

type Msg = { role: "user" | "assistant"; content: string; sources?: any[] };

/* Renderiza **negrito** e quebras de linha sem dependência extra */
function Md({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const parts = line.split(/(\*\*.*?\*\*)/g);
        return (
          <div key={i} className={line === "" ? "h-2" : ""}>
            {parts.map((p, j) =>
              p.startsWith("**") && p.endsWith("**") ? (
                <strong key={j} className="font-semibold">
                  {p.slice(2, -2)}
                </strong>
              ) : (
                <span key={j}>{p}</span>
              )
            )}
          </div>
        );
      })}
    </>
  );
}

export default function Home() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<any[]>([]);
  const [showPending, setShowPending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  function headers() {
    return { "Content-Type": "application/json" };
  }

  async function send() {
    if (!input.trim() || busy) return;
    const q = input.trim();
    setInput("");
    const newMsgs: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(newMsgs);
    setBusy(true);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          question: q,
          history: newMsgs.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "erro");
      setMsgs([...newMsgs, { role: "assistant", content: j.answer, sources: j.sources }]);
    } catch (e: any) {
      setMsgs([...newMsgs, { role: "assistant", content: `Erro: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    const base64 = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res((r.result as string).split(",")[1]);
      r.readAsDataURL(file);
    });
    setMsgs((m) => [...m, { role: "user", content: `Enviando imagem (${file.name})...` }]);
    try {
      const r = await fetch("/api/ingest", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "erro");
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content: `Rascunho salvo: **${j.parsed.titulo}**\nCategoria: ${j.parsed.categoria}\n\n${j.parsed.resumo}\n\nAprovar na aba Pendentes.`,
        },
      ]);
      loadPending();
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: `Erro: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function loadPending() {
    const r = await fetch("/api/pending", { headers: headers() });
    const j = await r.json();
    if (r.ok) setPending(j.docs || []);
  }

  async function decide(id: string, action: "approve" | "reject") {
    await fetch("/api/approve", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ id, action }),
    });
    loadPending();
  }

  async function briefing() {
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: "/briefing" }]);
    const r = await fetch("/api/briefing", { headers: headers() });
    const j = await r.json();
    setMsgs((m) => [
      ...m,
      { role: "assistant", content: r.ok ? j.briefing : `Erro: ${j.error}` },
    ]);
    setBusy(false);
  }

  return (
    <div className="mx-auto flex h-[100dvh] max-w-2xl flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h1 className="font-semibold">Assistente</h1>
        <div className="flex gap-2 text-sm">
          <button onClick={briefing} className="rounded bg-zinc-800 px-2 py-1">
            Briefing
          </button>
          <button
            onClick={() => {
              setShowPending((s) => !s);
              if (!showPending) loadPending();
            }}
            className="rounded bg-zinc-800 px-2 py-1"
          >
            Pendentes {pending.length > 0 ? `(${pending.length})` : ""}
          </button>
        </div>
      </header>

      {showPending && (
        <div className="border-b border-zinc-800 p-3 space-y-2">
          {pending.length === 0 && <div className="text-sm text-zinc-500">Sem rascunhos.</div>}
          {pending.map((p) => (
            <div key={p.id} className="rounded bg-zinc-900 p-3 text-sm">
              <div className="font-medium">{p.titulo}</div>
              <div className="text-zinc-400">{p.resumo}</div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => decide(p.id, "approve")} className="rounded bg-emerald-700 px-2 py-1 text-xs">
                  Aprovar
                </button>
                <button onClick={() => decide(p.id, "reject")} className="rounded bg-rose-700 px-2 py-1 text-xs">
                  Rejeitar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-4 space-y-3">
        {msgs.length === 0 && (
          <div className="text-sm text-zinc-500">
            Faca uma pergunta ou envie uma foto pelo botao Arquivo.
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
              m.role === "user"
                ? "ml-auto bg-emerald-700"
                : "mr-auto bg-zinc-800"
            }`}
          >
            <Md text={m.content} />
            {m.sources && m.sources.length > 0 && (
              <div className="mt-2 text-xs text-zinc-400">
                Fontes: {m.sources.map((s, j) => `[${j + 1}] ${s.titulo}`).join(" | ")}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="text-sm text-zinc-500">pensando...</div>}
        <div ref={endRef} />
      </main>

      <footer className="flex items-center gap-2 border-t border-zinc-800 p-3">
        <label className="flex cursor-pointer items-center rounded bg-zinc-800 px-3 py-2 text-sm active:bg-zinc-700">
          Arquivo
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </label>
        <input
          className="flex-1 rounded bg-zinc-900 px-3 py-2 outline-none"
          placeholder="Pergunte algo..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={send} className="rounded bg-emerald-600 px-3 py-2">Enviar</button>
      </footer>
    </div>
  );
}
