# Prompt Builder

Static web app (no server) that builds prompts for AI image generation. It is designed to run on **GitHub Pages**.

## Deploy
1. Push the folder contents to a GitHub repository.
2. Settings → Pages → deploy from the branch root (`.nojekyll` is included).
3. Open the published page.

## How it works
- All data stays in the browser's localStorage: presets, user templates, Builder state, custom field values, provider and API keys. Use Settings → Export / Import to move it between browsers (API keys are not exported).
- AI providers are called directly from the page, so the provider must allow browser (CORS) requests.
- `static-api.js` emulates the former `./api/*` endpoints in the browser; shared provider logic is in `core.js`.
- Builder **Section / Category / AI Tool** come from `prompt_templates.json` plus user templates; the selected template is used for generation.

## Run locally
```
npm start
```
This serves the folder on http://localhost:3000 with a plain static server. Any static server works.

## Files
`index.html`, `app.js`, `styles.css`, `json-editor.js`, `static-api.js`, `core.js`, `config.json`, `config_providers.json`, `prompt_templates.json`.

Version history: [CHANGELOG.md](CHANGELOG.md).
