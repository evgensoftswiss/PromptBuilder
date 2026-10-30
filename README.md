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

### Option 1: npm (recommended)
```
npm install
npm start
```
Serves on http://localhost:3000.

### Option 2: Python
```
python -m http.server 3000
```
Open http://localhost:3000 in your browser.

### Option 3: Windows batch file
Double-click `start.bat` to launch the server on http://localhost:3000. Works with Python installed.

### Option 3: Other static servers
- `npx serve . -l 3000`
- `npx http-server . -p 3000`
- Any static file server on port 3000

**Important:** Do not open `index.html` directly via `file://` - the app uses ES modules and fetch API which require a web server.

## Files
`index.html`, `app.js`, `styles.css`, `json-editor.js`, `static-api.js`, `core.js`, `config.json`, `config_providers.json`, `prompt_templates.json`.

Version history: [CHANGELOG.md](CHANGELOG.md).
