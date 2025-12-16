# NeoCalc - AI-Powered Smart Calculator

A modern, document-based calculator powered by local LLM (llama.cpp). Write natural language math and get intelligent results.

![NeoCalc](https://img.shields.io/badge/Built%20with-Vite%2BReact-blue) ![PWA](https://img.shields.io/badge/PWA-Ready-green)

## Features

- **Natural Language Math** - Write "Rent: $1500 + Utilities: $200" and get results
- **AI-Powered Logic** - Complex expressions parsed by local LLM
- **Multi-File Support** - Create, save, and organize calculation documents
- **Offline First** - PWA with IndexedDB persistence
- **Debug Panel** - Monitor LLM requests and responses
- **Two UI Modes** - Classic (`/`) and NeoCalc (`/neo`)

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start local LLM server (required for AI features)
llama-server -m ./models/qwen2.5-7b-instruct-q4_k_m.gguf --port 8080
```

Then open [http://localhost:5173/neo](http://localhost:5173/neo)

## Project Structure

```
src/
├── App.jsx              # Legacy/Classic UI (untouched)
├── NeoCalcUI.jsx        # Main new UI component
├── main.jsx             # Router entry point
├── index.css            # Global Tailwind styles
├── components/          # React components
│   ├── DebugPanel.jsx   # LLM debug/monitoring panel
│   ├── InstallPrompt.jsx # PWA install prompt
│   └── SplashScreen.jsx # App loading screen
├── lib/
│   └── db.js            # IndexedDB operations (Dexie.js)
└── utils/               # Shared utilities
    ├── constants.js     # API URLs, safe functions, prompts
    ├── evaluator.js     # Local math evaluation engine
    └── formatters.js    # Value formatting functions

public/
├── manifest.json        # PWA manifest
├── sw.js                # Service worker
└── icons/               # App icons
```

## Architecture

### Two-Pass Evaluation

1. **Local Engine** - Fast, offline evaluation of basic math
2. **AI Engine** - LLM-based interpretation for complex expressions

Priority: Local results always take precedence over AI results.

### Data Flow

```
User Input → Local Evaluator → Display Results
         └→ LLM API (debounced) → Merge with Local → Update Display
```

### Persistence

- **IndexedDB** (via Dexie.js) for files, settings, and logs
- **Service Worker** for offline caching (PWA)

## Development

```bash
# Development with hot reload
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Lint
npm run lint
```

## Routes

| Path | Description |
|------|-------------|
| `/` | Classic/Legacy UI (App.jsx) |
| `/neo` | New NeoCalc UI with full features |

## LLM Setup

NeoCalc uses a local LLM server. Recommended: Qwen 2.5 7B Instruct Q4_K_M

```bash
# Download llama.cpp (if not installed)
brew install llama.cpp

# Download a model (example)
# Place .gguf file in ./models/

# Start server
llama-server -m ./models/qwen2.5-7b-instruct-q4_k_m.gguf --port 8080
```

## Tech Stack

- **Frontend**: React 18, Vite 7
- **Styling**: Tailwind CSS v4
- **Icons**: Lucide React
- **Database**: IndexedDB (Dexie.js)
- **LLM**: llama.cpp (local server)

## License

MIT
