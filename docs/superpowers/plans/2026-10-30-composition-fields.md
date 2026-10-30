# Composition Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split composition into scene elements and a placement choice that adapts to the scene.

**Architecture:** Add `sceneElements` and `placement` as Builder fields. Their options come from `config.json`; changing scene elements filters placement choices and clears an incompatible selection. Reference analysis returns and applies both fields automatically. Legacy presets map the existing Composition value into the new fields.

**Tech Stack:** Existing vanilla JavaScript UI and JSON configuration.

**Spec:** User-approved proposal in the conversation: Scene elements (`Object only`, `Character only`, `Object + character`, `Custom`) and context-dependent Placement.

## Global Constraints

- Keep the existing Builder field schema and custom-select behavior.
- Preserve old saved presets and Builder state where a clear mapping exists.
- Include both new field values in generated prompt data.

## Review Focus

- Placement options must update when Scene elements changes.
- Reference analysis must select both Scene elements and a valid Placement from the reference content.
- Switching scene type must not retain an invalid placement.
- Legacy `No character` and `Character left/center/right` values must migrate sensibly.
- Object-plus-character options must express relative placement.
- Custom choices must remain usable.

### Task 1: Add scene fields and dependent placement choices

**Files:** `config.json`, `app.js`, `index.html`

- [x] Add Scene elements and Placement options/defaults to Builder config.
- [x] Filter Placement options by scene type and clear a placement when it becomes invalid.
- [x] Migrate legacy Composition values from presets and saved Builder state.
- [x] Preserve both new values in generation configuration and bump the app script cache version.
- [x] Verify JSON and JavaScript syntax, option filtering, migration, and the live app configuration.
