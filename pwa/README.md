# PWA Assistente Executivo

PWA (instalável no celular) que substitui os bots Telegram:
- **Consulta** (RAG via pgvector + Claude)
- **Captura** (foto → Vision → rascunho → aprovação)

## Setup local

```bash
cd "/Users/possebon/Desktop/Projeto Assistente/pwa"
npm install
cp .env.example .env.local
# preencha .env.local com as 4 keys
npm run dev
# abre http://localhost:3000
```

## Envs necessárias (.env.local)

| Var | Onde pegar |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | já preenchida no `.env.example` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `OPENAI_API_KEY` | platform.openai.com → API Keys |
| `APP_PASSWORD` | invente uma senha (só vc usa o app) |

## Schema Supabase necessário

Tabela `documentos`:
- `id` uuid pk
- `titulo` text, `resumo` text, `conteudo` text
- `categoria` text, `fonte` text
- `metadata` jsonb
- `embedding` vector(1536)
- `status` text ('rascunho' | 'ativo' | 'rejeitado')
- `created_at` timestamptz default now()

Função `match_documents` (já está no sticky note do workflow n8n).

## Deploy Vercel

```bash
cd pwa
vercel
# cole as envs no dashboard Vercel
```

No celular: abra a URL no Safari/Chrome → "Adicionar à Tela de Início" → vira app.

## Endpoints API

| Rota | Método | Função |
|---|---|---|
| `/api/ask` | POST | pergunta → busca semântica → Claude |
| `/api/ingest` | POST | foto base64 → Vision → rascunho |
| `/api/pending` | GET | lista rascunhos |
| `/api/approve` | POST | aprova/rejeita rascunho |
| `/api/briefing` | GET | resumo executivo do dia |

Todos exigem header `x-app-password`.
