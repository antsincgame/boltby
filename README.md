<div align="center">

<br>

```
 ★═══════════════════════════════════════════════════════════════════★
 ║                                                                   ║
 ║          ◈  N I T . V I B E C O D I N G . B Y  ◈                 ║
 ║          Belarusian AI-Powered Web Development                    ║
 ║                                                                   ║
 ║          ✦  Built in Belarus  ✦                                   ║
 ║                                                                   ║
 ★═══════════════════════════════════════════════════════════════════★
```

<br>

<img src="https://img.shields.io/badge/School-vibecoding.by-gold?style=for-the-badge" alt="vibecoding.by"/>
<img src="https://img.shields.io/badge/Instructor-Dmitry_Orlov-blueviolet?style=for-the-badge" alt="Dmitry Orlov"/>
<img src="https://img.shields.io/badge/Stack-Remix_+_React_+_PocketBase-00f5ff?style=for-the-badge" alt="Stack"/>
<img src="https://img.shields.io/badge/Made_in-Belarus_🇧🇾-red?style=for-the-badge" alt="Belarus"/>

<br>

<img src="https://img.shields.io/badge/PocketBase-Local_Backend-00ff88?style=flat-square&logo=sqlite" alt="PocketBase"/>
<img src="https://img.shields.io/badge/Ollama-Local_LLM-8b5cf6?style=flat-square" alt="Ollama"/>
<img src="https://img.shields.io/badge/LM_Studio-Auto--Launch-f4a836?style=flat-square" alt="LM Studio"/>
<img src="https://img.shields.io/badge/Offline--First-No_Internet_Required-ff00ff?style=flat-square" alt="Offline"/>

<br><br>

**A Belarusian AI assistant for full-stack web development — entirely in the browser.**

> Fork of [bolt.diy](https://github.com/stackblitz-labs/bolt.diy), enhanced at [vibecoding.by](https://vibecoding.by) school.
> Local-first. Offline-capable. Fully autonomous.

</div>

---

<div align="center">

### ◈ Navigation ◈

[Features](#-features) · [Architecture](#-architecture) · [Quick Start](#-quick-start) · [PocketBase](#-pocketbase) · [Local Models](#-local-models) · [What We Built](#-what-we-built) · [Project Structure](#-project-structure)

</div>

---

## ✦ About

**nit.vibecoding.by** is an AI-powered environment for full-stack web development right in your browser. Describe what you want — the neural network generates a complete application: HTML, CSS, JavaScript, React, Node.js, database and all.

The key differentiator of this fork is **full autonomy**. Everything runs locally, without internet: local LLMs via Ollama/LM Studio, local PocketBase database, automatic setup on first launch.

This project is developed as part of the educational program at **[vibecoding.by](https://vibecoding.by)** — a Belarusian school of AI-assisted development, led by instructor **Dmitry Orlov**.

---

## ⚡ Features

<table>
<tr>
<td width="50%">

### 🧠 Neural Networks
- Support for **15+ LLM providers**
- **Local models** — Ollama, LM Studio
- Cloud — OpenAI, Anthropic, Gemini, Groq, DeepSeek, Mistral, xAI, Cohere, Perplexity, OpenRouter, HuggingFace
- **Prompt enhancement** via AI
- Real-time code streaming

</td>
<td width="50%">

### 🗄️ Backend
- **PocketBase** — local DB (SQLite + REST API)
- Auto-download and auto-launch
- Auto-creation of superuser
- Auto-generation of `pb-setup.js` for collections
- Works **completely offline**

</td>
</tr>
<tr>
<td>

### 🛠️ Development
- Full-stack web app generation from text
- Integrated terminal
- Code version rollback
- Git clone and project import
- Image attachments in prompts
- Export project as ZIP

</td>
<td>

### 🚀 Deployment
- Deploy to **Netlify** from the UI
- Publish to **GitHub**
- Docker containerization
- WebContainer — in-browser runtime

</td>
</tr>
</table>

---

## 🔮 Architecture

```mermaid
graph TB
    subgraph user [User]
        Browser["Browser"]
    end

    subgraph app [nit.vibecoding.by — Remix + React]
        Chat["Chat Interface"]
        Prompts["System Prompts"]
        Parser["Message Parser"]
        ActionRunner["Action Runner"]
    end

    subgraph llm [LLM Providers]
        Local["Local"]
        Cloud["Cloud"]
        Ollama["Ollama :11434"]
        LMStudio["LM Studio :1234"]
        OpenAI["OpenAI / Anthropic / Gemini ..."]
    end

    subgraph runtime [Runtime Environment]
        WebContainer["WebContainer"]
        NodeJS["Node.js + npm + Vite"]
    end

    subgraph backend [Local Backend]
        PocketBase["PocketBase :8090"]
        SQLite["SQLite"]
        AdminPanel["Admin Panel"]
        RestAPI["REST API"]
    end

    Browser --> Chat
    Chat --> Prompts
    Prompts --> Parser
    Parser --> ActionRunner

    ActionRunner --> WebContainer
    WebContainer --> NodeJS

    Chat --> Local
    Chat --> Cloud
    Local --> Ollama
    Local --> LMStudio
    Cloud --> OpenAI

    ActionRunner --> PocketBase
    PocketBase --> SQLite
    PocketBase --> AdminPanel
    PocketBase --> RestAPI
```

---

## 🚀 Quick Start

### Requirements

| Component | Version | Link |
|-----------|---------|------|
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org/) |
| **pnpm** | Latest | Installed via command below |

### Installation

```bash
# Clone the repository
git clone https://github.com/antsincgame/nit.vibecoding.by.git
cd nit.vibecoding.by

# Install package manager
npm install -g pnpm

# Install dependencies
pnpm install

# Launch (PocketBase downloads automatically)
pnpm run dev
```

### What Happens on First Launch

The `pre-start.cjs` script automatically:

```
 1. ◈ Downloads PocketBase (if not installed)
 2. ◈ Creates superuser (admin@bolt.local)
 3. ◈ Saves credentials to .env.local
 4. ◈ Starts PocketBase on port 8090
 5. ◈ Launches LM Studio (if installed)
 6. ◈ Starts dev server on port 5173
```

Open **http://localhost:5173** in your browser.

---

## 🗄️ PocketBase

PocketBase is a local open-source backend. Single binary, SQLite inside, REST API, admin panel, authentication, real-time subscriptions.

| Component | Address |
|-----------|---------|
| REST API | `http://localhost:8090/api/` |
| Admin Panel | `http://localhost:8090/_/` |
| Superuser | `admin@bolt.local` / `boltadmin2024` |

### How It Works

When you ask the AI to create an app with a database, it automatically:

1. Generates a **`pb-setup.js`** file — a script that creates collections via the PocketBase API
2. Adds a launch script to `package.json`: `"dev": "node pb-setup.js && vite"`
3. Generates application code using the **PocketBase SDK**

Collections are created automatically on first run — no manual configuration needed.

<details>
<summary><b>Example of generated pb-setup.js</b></summary>

```javascript
const PB_URL = process.env.VITE_POCKETBASE_URL || 'http://localhost:8090';

async function setup() {
  // Authenticate as superuser
  const auth = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: 'admin@bolt.local', password: 'boltadmin2024' }),
  });
  const { token } = await auth.json();
  const headers = { 'Content-Type': 'application/json', Authorization: token };

  // Check existing collections
  const existing = await fetch(`${PB_URL}/api/collections`, { headers });
  const { items } = await existing.json();
  const names = items.map((c) => c.name);

  // Define collections
  const collections = [
    {
      name: 'posts',
      type: 'base',
      schema: [
        { name: 'title', type: 'text', required: true },
        { name: 'content', type: 'editor' },
        { name: 'user', type: 'relation', options: { collectionId: '_pb_users_auth_', maxSelect: 1 } },
      ],
    },
  ];

  // Create missing collections
  for (const col of collections) {
    if (names.includes(col.name)) continue;
    await fetch(`${PB_URL}/api/collections`, {
      method: 'POST',
      headers,
      body: JSON.stringify(col),
    });
  }
}

setup().catch(() => console.log('PocketBase not available, skipping setup'));
```

</details>

---

## 🧠 Local Models

To work without internet, install one of the local LLM platforms:

### Ollama

```bash
# Install (Linux/macOS)
curl -fsSL https://ollama.ai/install.sh | sh

# Download recommended model
ollama pull qwen2.5-coder:14b
```

Ollama starts automatically. Available at `http://localhost:11434`.

### LM Studio

1. Download from [lmstudio.ai](https://lmstudio.ai/)
2. Load a model (recommended: **Qwen 2.5 Coder 14B**)
3. The app automatically launches LM Studio on startup

### API Keys (for cloud providers)

1. Open the interface
2. Select a provider from the dropdown
3. Click the pencil icon next to the key field
4. Enter your API key

> For local models, **no API keys** are needed.

---

## 🐳 Docker

```bash
# Build
docker build . --target bolt-ai-development

# Run
docker compose --profile development up
```

---

## 📋 Scripts

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start dev server |
| `pnpm run build` | Build the project |
| `pnpm run preview` | Build + local preview |
| `pnpm test` | Run tests (Vitest) |
| `pnpm run typecheck` | TypeScript type checking |
| `pnpm run lint:fix` | Auto-fix linter errors |

---

## ✅ What We Built

### Migration to PocketBase

| Task | Status |
|------|--------|
| Full removal of Supabase (5 files, ~2000 lines) | Done |
| New store `pocketbase.ts` with health-check | Done |
| New API route `api.pocketbase.ts` with SSRF protection | Done |
| Auto-download of PocketBase binary | Done |
| Auto-creation of superuser on first launch | Done |
| Updated 4 system prompts for PocketBase | Done |
| LLM instructions for `pb-setup.js` generation | Done |

### Security

| Task | Status |
|------|--------|
| SSRF vulnerability fix in API route | Done |
| Whitelist of allowed API paths | Done |
| HTTP method validation | Done |
| Race condition protection in health-check | Done |
| Unhandled promise rejection fix | Done |

### Performance Optimization

| Task | Status |
|------|--------|
| `AssistantMessage.tsx` — O(n^2) to O(n) via Map | Done |
| `Chat.client.tsx` — memoization with useCallback/useMemo | Done |
| `Messages.client.tsx` — stable keys (messageId) | Done |
| Type fix in `message-parser.ts` | Done |
| Removed debug logging from production | Done |
| Auto-launch configuration for LM Studio | Done |

### LLM Auto-Correction Engine

| Task | Status |
|------|--------|
| 45+ package name corrections (`@lucide/icons-react` → `lucide-react`, etc.) | Done |
| Auto-remove phantom packages (`@types/lucide-react`, `@shadcn/components`) | Done |
| `repairTruncatedJson` — fix LLM-truncated `package.json` | Done |
| `fixViteConfig` — ensure React plugin in Vite config | Done |
| `fixSourceImports` — fix default vs named imports (PocketBase, axios) | Done |
| `sanitizeNpmCommand` — clean bad packages from `npm install` commands | Done |
| Auto-retry `npm install` on 404 errors with package fix | Done |
| PocketBase `.catch()` auto-wrapper for unhandled async calls | Done |

### GPU Resource Management

| Task | Status |
|------|--------|
| Sequential model swapping (Ollama ↔ LM Studio) | Done |
| VRAM verification before loading new models | Done |
| Auto-unload of previous model before loading new one | Done |
| Fallback to Ollama when LM Studio fails | Done |
| Smart model fallback (prefer code-capable models) | Done |
| Verify model is actually loaded, not just cached | Done |

### Smart Prompt System

| Task | Status |
|------|--------|
| 3-tier prompt selection (default / optimized / compact) by context size | Done |
| Full PocketBase project example in prompts (pb-setup.js, .env, CRUD) | Done |
| Auto-continue on unclosed `<boltArtifact>` tags | Done |
| Dynamic token budget with 4096 minimum output | Done |
| Enhanced CONTINUE_PROMPT for proper tag closing | Done |
| `Promise.race` timeout fix in `select-context.ts` | Done |

---

## 🧠 Recommended Models

| Model | Size | VRAM | Use Case |
|-------|------|------|----------|
| `qwen2.5-coder:7b-instruct` | 4.4 GB | 6 GB | Simple sites, quick prototypes |
| `qwen2.5-coder:14b-instruct` | 8.9 GB | 12 GB | Full-stack apps (recommended) |
| `deepseek-coder-v2:16b` | 8.3 GB | 10 GB | Complex projects with reasoning |
| `qwen3:8b` | 5.0 GB | 7 GB | General purpose, multilingual |

> For 8 GB VRAM GPUs, use `qwen2.5-coder:7b-instruct` with `DEFAULT_NUM_CTX=16384`.

---

## 📁 Project Structure

```
nit.vibecoding.by/
│
├── app/
│   ├── components/           React components
│   │   ├── @settings/        Settings, connections, diagnostics
│   │   └── chat/             Chat, messages, alerts
│   │
│   ├── lib/
│   │   ├── .server/llm/      Server-side LLM streaming logic
│   │   ├── common/prompts/   System prompts (4 variants)
│   │   ├── hooks/            React hooks
│   │   ├── modules/llm/      LLM providers (15+)
│   │   ├── persistence/      Chat storage (IndexedDB)
│   │   ├── runtime/          Message parser, action runner
│   │   └── stores/           Nano-stores (pocketbase, workbench)
│   │
│   ├── routes/               API endpoints
│   │   ├── api.chat.ts       Main chat endpoint
│   │   ├── api.enhancer.ts   Prompt enhancement
│   │   └── api.pocketbase.ts PocketBase proxy
│   │
│   └── types/                TypeScript types
│
├── pre-start.cjs             Auto-launch PocketBase + LM Studio
├── .env.local                API keys (not committed!)
└── package.json
```

---

## 📜 License

Source code is distributed under the **MIT** license.

WebContainers API requires a [separate license](https://webcontainers.io/enterprise) for commercial use.

---

<div align="center">

<br>

```
★═══════════════════════════════════════════════════════════════════★
║                                                                   ║
║   A project by vibecoding.by                                      ║
║   Instructor: Dmitry Orlov                                        ║
║   Made in Belarus 🇧🇾                                              ║
║                                                                   ║
★═══════════════════════════════════════════════════════════════════★
```

<br>

<img src="https://img.shields.io/badge/vibecoding.by-Belarusian_AI_School-gold?style=for-the-badge" alt="vibecoding.by"/>

<br><br>

*Built with AI. Perfected with soul.*

</div>
