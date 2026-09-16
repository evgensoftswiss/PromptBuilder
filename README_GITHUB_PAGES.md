# Prompt Builder 0.1.53 - GitHub Pages

Static GitHub Pages version using browser localStorage instead of the Node/Express backend.

## What changed
- API keys are stored per provider in browser `localStorage`.
- Presets are stored in `localStorage` (max 20).
- Builder state is stored in `localStorage`.
- Prompt templates are loaded from `prompt_templates.json` and edits are stored in `localStorage`.
- Provider configuration is loaded from `config_providers.json`.
- AI calls go directly from the browser to the selected provider.
- Vision model discovery is performed directly from the browser.

## GitHub Pages
Upload the contents of this folder to a GitHub repository and enable GitHub Pages from the repository settings. No Node.js or NGINX is required.

## Local preview
Because browsers restrict `fetch()` from `file://`, use any static server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Provider notes
Direct browser API calls depend on the provider allowing CORS from the website origin. If a provider blocks browser requests, GitHub Pages alone cannot bypass that restriction. Ollama also needs to allow requests from the browser origin.

## Security
Keys are stored in browser localStorage, per browser/profile. They are not encrypted at rest and are not written to repository files. Do not use this mode on a machine/browser you do not trust.
