# RAG - Assistente Pessoal

Sistema pessoal de RAG (Retrieval-Augmented Generation) com duas frentes:
- **PWA** (`pwa/`): Assistente executivo acessível no celular — pergunta, resposta com citações, ingestão por foto
- **Workflows n8n** (`workflows/`): Bots Telegram originais (captura e consulta)

Ambos usam a mesma base Supabase pgvector com ~89K chunks.

## Estrutura

```
pwa/                                 # Next.js 14 App Router (deploy Vercel)
workflows/
└── RAG_Captura_Organizacao.json     # Telegram + Vision AI + Supabase
```

## PWA — Stack

- Next.js 14 (App Router)
- Anthropic API (Claude Sonnet) para chat e Vision
- OpenAI `text-embedding-3-small` para embeddings
- Supabase pgvector (`match_documents` RPC)
- Auth simples por header `x-app-password`

Ver `pwa/.env.example` para as variáveis necessárias.

## Workflows

### RAG_Captura_Organizacao
Fluxo principal de ingestão de conhecimento:
1. Recebe imagem via Telegram
2. Extrai informações com Vision AI (GPT-4o)
3. Classifica conteúdo: qualitativo / quantitativo / misto
4. Agente RAG sugere organização baseada no mapa de conhecimento
5. Envia para aprovação humana via inline keyboard
6. Salva rascunho no Supabase e gera embedding ao aprovar

## Como importar no n8n

1. Abra o n8n
2. **Workflows → Import from file**
3. Selecione o `.json` desejado

## Histórico de alterações

| Data | Arquivo | Descrição |
|------|---------|-----------|
| 2026-03-06 | RAG_Captura_Organizacao.json | Versão inicial com correções: mime_type dinâmico, fix quantitativo sem documento, guard Supabase, resposta imediata ao callback Telegram, conflito de posição de nodes resolvido |

## Credenciais

O arquivo JSON usa placeholders para as credenciais sensíveis:

| Placeholder | O que substituir |
|---|---|
| `YOUR_SUPABASE_API_KEY` | API Key do Supabase (anon ou service_role) |
| `YOUR_SUPABASE_PROJECT_ID` | ID do projeto no Supabase |
| `YOUR_TELEGRAM_BOT_TOKEN` | Token do bot no BotFather |

As credenciais de OpenAI e Telegram são gerenciadas pelo n8n internamente via **Credentials** e não precisam ser alteradas no JSON.
