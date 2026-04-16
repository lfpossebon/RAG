"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string; sources?: any[] };

const STORAGE_KEY = "chat-history";

function loadMsgs(): Msg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMsgs(msgs: Msg[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-100)));
  } catch {}
}

/* Renderiza **negrito** e quebras de linha sem dependencia extra */
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

  // Carrega historico do localStorage na montagem
  useEffect(() => {
    setMsgs(loadMsgs());
  }, []);

  // Salva historico a cada mudanca
  useEffect(() => {
    if (msgs.length > 0) saveMsgs(msgs);
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  function headers() {
    return { "Content-Type": "application/json" };
  }

  function clearChat() {
    setMsgs([]);
    localStorage.removeItem(STORAGE_KEY);
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

  // Converte qualquer imagem para JPEG base64 via canvas, redimensiona se grande
  // Evita erro de pattern na API Anthropic e reduz payload
  function toJpegBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // Redimensiona mantendo proporcao, max 1600px no lado maior
        const MAX = 1600;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) {
            h = Math.round((h * MAX) / w);
            w = MAX;
          } else {
            w = Math.round((w * MAX) / h);
            h = MAX;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas error"));
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        const b64 = dataUrl.split(",")[1];
        if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64.slice(0, 100))) {
          return reject(new Error("base64 invalido"));
        }
        resolve(b64);
      };
      img.onerror = () => reject(new Error("imagem invalida (formato nao suportado pelo navegador)"));
      img.src = URL.createObjectURL(file);
    });
  }

  async function uploadMany(files: File[]) {
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: `Enviando ${files.length} imagem(ns)...` }]);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const base64 = await toJpegBase64(file);
        setMsgs((m) => [...m, { role: "assistant", content: `Processando ${i + 1}/${files.length}: ${file.name}...` }]);
        const r = await fetch("/api/ingest", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ imageBase64: base64, mimeType: "image/jpeg" }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "erro");
        setMsgs((m) => [
          ...m,
          {
            role: "assistant",
            content: `${i + 1}/${files.length} salvo: **${j.parsed.titulo}**\nCategoria: ${j.parsed.categoria}\n${j.parsed.resumo}`,
          },
        ]);
      } catch (e: any) {
        setMsgs((m) => [...m, { role: "assistant", content: `Erro em ${file.name}: ${e.message}` }]);
      }
    }
    loadPending();
    setBusy(false);
  }

  async function loadPending() {
    try {
      const r = await fetch("/api/pending", { headers: headers() });
      const j = await r.json();
      if (r.ok) setPending(j.docs || []);
    } catch {}
  }

  async function decide(id: string, action: "approve" | "reject") {
    // Remove da lista imediatamente (feedback instantaneo)
    setPending((prev) => prev.filter((p) => p.id !== id));
    try {
      const r = await fetch("/api/approve", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ id, action }),
      });
      if (!r.ok) {
        const j = await r.json();
        // Se falhou, recarrega a lista real
        loadPending();
        setMsgs((m) => [...m, { role: "assistant", content: `Erro ao ${action === "approve" ? "aprovar" : "rejeitar"}: ${j.error}` }]);
      }
    } catch (e: any) {
      loadPending();
      setMsgs((m) => [...m, { role: "assistant", content: `Erro: ${e.message}` }]);
    }
  }

  async function briefing() {
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: "/briefing" }]);
    try {
      const r = await fetch("/api/briefing", { headers: headers() });
      const j = await r.json();
      setMsgs((m) => [
        ...m,
        { role: "assistant", content: r.ok ? j.briefing : `Erro: ${j.error}` },
      ]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "assistant", content: `Erro: ${e.message}` }]);
    }
    setBusy(false);
  }

  return (
    <div className="mx-auto flex h-[100dvh] max-w-2xl flex-col overscroll-none">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="font-semibold">Assistente</h1>
          {msgs.length > 0 && (
            <button onClick={clearChat} className="text-xs text-zinc-500 hover:text-zinc-300">
              Limpar
            </button>
          )}
        </div>
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

      {showPending ? (
        <main className="flex-1 overflow-y-auto p-3 space-y-3 overscroll-contain">
          {pending.length === 0 && <div className="text-sm text-zinc-500">Sem rascunhos.</div>}
          {pending.map((p) => (
            <div key={p.id} className="rounded-xl bg-zinc-900 p-4 text-sm">
              <div className="font-semibold text-base">{p.titulo}</div>
              <div className="mt-1 text-zinc-400">{p.resumo}</div>
              <div className="mt-1 text-xs text-zinc-500">{p.categoria}</div>
              <div className="mt-3 flex gap-3">
                <button
                  onClick={() => decide(p.id, "approve")}
                  className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium active:bg-emerald-600"
                >
                  Aprovar
                </button>
                <button
                  onClick={() => decide(p.id, "reject")}
                  className="flex-1 rounded-lg bg-rose-700 px-3 py-2 text-sm font-medium active:bg-rose-600"
                >
                  Rejeitar
                </button>
              </div>
            </div>
          ))}
        </main>
      ) : (
      <main className="flex-1 overflow-y-auto p-4 space-y-3 overscroll-contain">
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
      )}

      <footer className="flex items-center gap-2 border-t border-zinc-800 p-3">
        <label className="flex cursor-pointer items-center rounded bg-zinc-800 px-3 py-2 text-sm active:bg-zinc-700">
          Arquivo
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) uploadMany(Array.from(files));
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
