# Add Builder Result to Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a button that saves the current Final Prompt and Builder settings as a user template.

**Architecture:** Reuse the current user-template model and `persistUserTemplates()` flow. Build metadata from the current Builder values, save the Final Prompt as `prompt_template`, and store the values and reference description in `context`.

**Tech Stack:** HTML, CSS, vanilla JavaScript, existing `/api/user-templates` persistence.

**Spec:** `docs/superpowers/specs/2026-10-30-add-builder-template-design.md`

## Global Constraints

- Keep built-in templates read-only.
- Save generated Final Prompt as `prompt_template` and Builder values plus reference description as `context`.
- Use current AI Tool and Category; derive Section from the matching template or fall back to Category.
- Keep the user on Builder if the prompt is empty or persistence fails.

## Review Focus

- Empty Final Prompt: show a clear status and do not create a record.
- Duplicate template names: use the existing `nextTemplateName()` convention.
- Persistence failure: do not navigate away or present success.
- Multiple clicks: prevent duplicate submissions while saving.
- No matching built-in template: save using Category as Section.

---

### Task 1: Save a Builder Result as a User Template

**Files:**
- Modify: `index.html` — add the prominent button below the AI launch button.
- Modify: `styles.css` — style it as a large blue full-width action.
- Modify: `app.js` — create, persist, and open the new user template.

**Interfaces:**
- Consume `getConfigValues()`, `findSelectedTemplateForValues()`, `nextTemplateName()`, `nextUserTemplateId()`, `persistUserTemplates()`, `populateTemplateEditor()`, and `showTab()`.
- Add `async function addBuilderResultTemplate()` and bind it to `#addToTemplatesBtn`.

- [x] Add the button under `#openToolBtn` with label **Add to templates**.
- [x] Implement `addBuilderResultTemplate()` to validate nonempty `#finalPrompt`, snapshot all Builder values and `#referenceDescription` into Context, assign metadata/name/id, append as `_source: 'user'`, and call `persistUserTemplates()`.
- [x] On successful persistence, refresh template filters, select the new record, switch to Templates, populate its editor, and show success status. On failure, remove the unsaved record and report failure on Builder.
- [x] Disable the button while persistence is in progress and restore it in `finally`.
- [x] Verify the empty prompt, successful save, failed persistence, duplicate-name, and missing-match paths by static inspection. Runtime UI verification was unavailable.
