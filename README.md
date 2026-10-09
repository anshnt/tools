# Tools

**Every everyday tool, right in your browser.** 470 free tools for PDFs, images, video and audio, Excel and data, text, calculators, developer work, security, students, careers, India forms and AI.

**Live site: https://anshnt.github.io/tools/**

- **Private by design.** Most tools run entirely on your device. Files are never uploaded.
- **No sign-up, no install.** Open a tool and use it, on phone or desktop, in light or dark mode.
- **Fast to find.** Search from anywhere with `Ctrl K` (or `/`), favorite tools, and pick up recent ones.
- **Drop any file.** Drop or paste a file anywhere and pick what to do with it; the tool opens with your file loaded.
- **Install it.** Add Tools to your home screen or dock; tools you have used keep working offline.

Tools are marked by how they run:

| Badge | Meaning |
|---|---|
| On-device | Runs fully in your browser. |
| On-device AI | Downloads an ML model once (OCR, Whisper speech-to-text, background removal) and runs it locally. |
| Online | Calls a public, key-free web service for lookups (DNS, exchange rates, IFSC...). |
| AI | Uses Claude (Anthropic) or Gemini (Google) with your own API key, stored only in your browser. |

## Categories

PDF · Image · Video & Audio · Text & Writing · Excel & Data · Calculators · Developer · Security · Web & Internet · Files · Screen & Browser · Work & Career · Student · Everyday Life · India · AI

## Development

No build step. Serve the folder and open it:

```bash
python -m http.server 8000
```

Then visit http://localhost:8000. Before pushing, run:

```bash
node scripts/check.mjs
```

How tools are structured and the rules every tool follows are in [docs/TOOLS.md](docs/TOOLS.md). Each pack under `packs/` owns its tools and catalog entries; the shell lives in `index.html` and `assets/`, shared helpers in `lib/`.

GitHub Pages serves `main` directly.

## License

MIT
