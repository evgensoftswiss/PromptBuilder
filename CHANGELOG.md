# Changelog

Version source of truth: `version` in `package.json` (shown in the app header).
Bump rules: patch (x.y.Z) for fixes, minor (x.Y.0) for features/behavior changes, major for breaking changes.
Every change set must bump the version and add an entry here.

## 2.0.1
- Clearer startup error when the page is opened without a web server (file://).

## 2.0.0
- The app is now GitHub Pages only: Node server, launchers (`start.*`, `launcher.html`), encrypted key storage and old exports removed. Data and API keys live in browser localStorage; `README.md` describes deployment.
- Builder: "AI suggestions" (Style / Composition from reference analysis) with "Apply AI suggestions" (Composition is set; Style is added to Clarification).
- Builder: "Template: …" line under Generate; recommendations (rating, context, evaluation) come from the actually selected template, which is now also used for generation.
- Builder: Section, Category and AI Tool are built from built-in and user templates (new Section field).
- `config.json` no longer embedded in `index.html`; `config_providers.json` is a plain tracked file.

## 1.46.0
- Templates tab: full editor (filters, add/duplicate/delete/save, effectiveness stars, syntax highlighting); built-in templates are read-only, user templates are stored in `user_templates.json` (or localStorage on GitHub Pages).
- Settings: Export/Import user data (without API keys), app version in the header.
- GitHub Pages support: shared `core.js` (server + browser) and `static-api.js` fetch shim emulating `/api/*` in the browser (localStorage for presets, templates and API keys). Added `.nojekyll`.
- Server refactored to use `core.js`; relative `./` URLs everywhere.

## 1.45.2
- Automatic retry (up to 2 extra attempts) when the model returns an empty response; the error is shown only if all attempts fail.

## 1.45.1
- Fixed silent empty result: when the model returns no text (e.g. reasoning model out of tokens, refusal), an explicit error with finish_reason is shown instead of an empty field. Array-style message content is supported. max_tokens raised to 8192.

## 1.45.0
- Final Prompt: when the result is JSON, a Visual / Text switch appears. The visual editor (new `json-editor.js`) shows fields as forms: text inputs, number inputs, Yes/No switches, color pickers for hex values, chips for lists, collapsible groups for nested objects and list items, "+ Add field" / "+ Add item" and remove buttons, Expand/Collapse all. Every edit rewrites the text as pretty JSON, so Copy buttons, presets and saved state keep working.
- Slightly invalid JSON (unquoted values such as `auto`, trailing commas) is auto-fixed in the editor with a notice and an "Apply fix" button. Non-JSON prompts are unaffected. The chosen view is remembered.

## 1.44.0
- Configure: Category, AI Tool, Theme, Composition and Dimensions are now searchable comboboxes, identical to the Preset field (type to filter, case-insensitive; arrows/Enter/Esc supported). Heart saves the typed value; trash removes a saved one.
- Removed the "Custom" option from Theme.
- All UI text is English: "Clarification" field (was "Уточнение"), Rating & Recommendations block; the saved list is now "Saved Clarification variants…".
- Per-field limits of saved custom values (config `maxCustom`): Theme 50, Category 20, Dimensions 20, Clarification 20, AI Tool 10, Composition 10; the oldest is dropped when full (default 20).

## 1.43.4
- UI: identical dropdown arrow and field look for all selects and the Preset field.

## 1.43.3
- UI: all dropdowns (Configure, Settings) use the same small triangle arrow as the Preset field.

## 1.43.2
- UI: "+" on all add/save-value buttons replaced with a heart (♡).

## 1.43.1
- UI: removed the duplicate "Save to My Prompts" button; presets are saved with "+" next to the Preset field.

## 1.43.0
- UI: Preset block returned under "Generate Prompt" (original order); saving a preset now uses a separate "+" button next to the delete button, like other fields.

## 1.42.0
- UI: Preset block restyled to match other Configure fields (label, same height/radius, icon delete button) and moved above the action buttons.
- Configure: the "Уточнение" textarea can store saved variants (select + "+" / trash), persisted in localStorage `pb-custom-clarification-v1`.
- Limit of 8 saved custom values for ALL fields; when full, the oldest is dropped.

## 1.41.0
- Configure: every select field (Category, AI Tool, Theme, Composition, Dimensions) now accepts user-added values via "+" (saved per field in localStorage `pb-custom-<field>-v1`, removable with the trash button, restored from presets).
- Custom AI Tool falls back to the first configured prompt template on the server; "Open in…" only copies the prompt when the tool has no link.
- UI/UX: new design layer in `styles.css` (tokens, unified controls, focus rings, buttons, cards, sticky blurred header, responsive tweaks).

## 1.40.0
- Configure: removed the Style field (and `{style}` from all AI Tool templates).
- Configure: Theme list expanded to 31 items (sports, casino/promo, popular holidays such as New Year, Christmas, Valentine's Day, Easter, Halloween, Thanksgiving, Chinese New Year, Ramadan / Eid, etc.).
- Configure: Composition is now "No character", "Character right", "Character left", "Character center" (default: Character right); templates use "Character placement".
- Configure: Dimensions supports custom sizes ("W x H"), saved in localStorage (`pb-custom-dimensions-v1`) and removable.
- Configure: new "Уточнение" textarea after Dimensions for extra requirements; sent to the AI and used by the mock prompt.
- Presets/state saved with removed options are loaded safely.

## 1.39.0
- Feature: final prompt generation ("Generate Prompt") now forbids UI and text information in the result (system and user parts of the request).

## 1.38.0
- Fix: reference analysis and prompt generation now use the stored encrypted API key and provider default Base URL on the server (previously failed with "No cookie auth credentials found" after the key field was cleared).
- Fix: OpenAI-compatible requests send `max_tokens: 4096` to avoid provider credit errors caused by large default limits.
- Improve: provider error messages are shown in full (nested details and HTTP status).
- Feature: reference analysis prompt now forbids UI and text information in the result.
- Chore: git repository initialized; `/api/status` reports the version from `package.json`.

## 1.37.0
- Baseline before version tracking in git.
