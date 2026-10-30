// Shared provider/AI logic, used in the browser by static-api.js (GitHub Pages).
const stripBase = (base) => (base || '').replace(/\/$/, '');
const authHeaders = (apiKey) => (apiKey ? { Authorization: 'Bearer ' + apiKey } : {});

export function parseJsonText(raw) {
  const cleaned = String(raw || '').replace(/^```json\s*|\s*```$/g, '').trim();
  try { return JSON.parse(cleaned); } catch { return { description: cleaned, prompt: cleaned }; }
}

export async function fetchJson(url, options = {}) {
  const r = await fetch(url, options);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) {
    const err = data?.error;
    let detail = (typeof err === 'string' ? err : err?.message) || data?.message || (typeof err === 'object' && err ? JSON.stringify(err) : '') || text || `HTTP ${r.status}`;
    const extra = err?.metadata?.raw;
    if (extra && !String(detail).includes(String(extra))) detail += ` — ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`;
    throw new Error(`${detail} (HTTP ${r.status})`);
  }
  return data;
}

function matchesAny(value, patterns = []) {
  const text = String(value || '').toLowerCase();
  return patterns.some(p => text.includes(String(p).toLowerCase()));
}

function isVisionByProviderConfig(model, provider) {
  const cfg = provider?.models || {};
  const id = String(model.id || model.name || '').toLowerCase();
  const text = `${id} ${JSON.stringify(model).toLowerCase()}`;
  if (cfg.vision_detection === 'capabilities') {
    return model.vision === true || model.input_image === true || (Array.isArray(model.capabilities) && model.capabilities.includes('vision'));
  }
  if (cfg.vision_detection === 'capabilities_object') return model?.capabilities?.vision === true;
  if (cfg.vision_detection === 'input_modalities') {
    const modalities = model?.architecture?.input_modalities || model?.input_modalities || model?.modalities?.input || [];
    return Array.isArray(modalities) && modalities.some(x => String(x).toLowerCase() === 'image');
  }
  if (matchesAny(text, cfg.exclude_patterns || [])) return false;
  const patterns = cfg.vision_patterns || [];
  return patterns.length ? matchesAny(id, patterns) : false;
}

export function formatGenerationValue(key, value) {
  const label = key === 'clarification' ? 'Additional user requirements (Clarification)' : String(key || '').replace(/([a-z])([A-Z])/g, '$1 $2');
  if (Array.isArray(value)) return `${label}: ${value.filter(Boolean).join(', ') || 'None selected'}`;
  if (value === undefined || value === null || value === '') return `${label}: Not specified`;
  return `${label}: ${String(value)}`;
}

export function selectPromptTemplate(config, aiTool) {
  const templates = config?.promptTemplates || {};
  const exact = String(templates[aiTool] || '').trim();
  if (exact) return exact;
  // Custom AI Tool: fall back to the first configured template.
  return String(Object.values(templates).find(t => String(t || '').trim()) || '').trim();
}

const ANALYZE_SYSTEM_PREFIX = `You are Prompt Builder's visual reference analyst. Analyze ONLY the attached image(s). Builder configuration is not provided and must not be used. `;
const ANALYZE_SYSTEM_SUFFIX = ` Return valid JSON with exactly three fields: "description" (string), "palette" (array of 1 to 8 uppercase HEX colors in #RRGGBB format) and "suggestions" (object with three strings: "style", a concise visual style phrase supported by the references; "sceneElements", the scene type best supported by the references; and "placement", a placement valid for that scene type). The description must contain ONLY visual traits supported by visible evidence. If multiple images are provided, report ONLY traits shared across the references and omit one-off details. The palette must also represent the common color language across the set, not colors unique to one reference. If one image is provided, extract its dominant representative palette. Never invent objects, people, colors, layouts, themes, or visual attributes that are not visibly supported. Do not produce a final image-generation prompt. MANDATORY: the result must NOT contain any information about UI (interface elements, buttons, menus, icons, panels, widgets, layouts of screens) or about any text in the images (headlines, captions, labels, numbers, logos with lettering, typography, fonts, copy). Ignore them completely and do not mention that they exist; describe only the non-UI, non-text visual content, and do not take UI or text elements into account when building the palette.`;

const REQUIRED_IMAGE_EXCLUSIONS = 'The image must contain no text, lettering, typography, logos, captions, labels, numbers, or UI/interface elements.';
const GENERATE_SYSTEM = `You are Prompt Builder's final image-prompt generator. The selected AI Tool template is the required output structure. Complete the template using the Builder configuration and Description of references. Do not replace the template with a different structure. Builder configuration contains explicit user requirements and has priority over reference observations when they conflict. Description of references contains only shared visual guidance extracted from the images. Preserve every meaningful configured requirement, fulfil the user's Clarification (additional requirements) when provided, use only selected Color Palette values when present, and apply Prompt Builder principles from the validated library: clear objective, strong visual hierarchy, one dominant focal point when compatible, concrete subject placement, controlled lighting/material/texture direction, useful negative constraints, restrained supporting elements, clear negative space, avoid clutter/overlap/duplication, and never copy unique artwork, exact text, logos, or unrelated details from references. MANDATORY: the final image-generation prompt must explicitly include this sentence: "${REQUIRED_IMAGE_EXCLUSIONS}" Do not request visible text or UI elements, even if the Description of references or the template mentions them. Return only the completed prompt in English, with no explanation, headings, markdown fences, or JSON.`;

// ctx: { providers: {id: providerConfig}, getApiKey(settings) -> string, log?(label, payload) }
export function createCore(ctx) {
  const providers = () => ctx.providers;
  const defaultBase = (id) => providers()[id]?.base_url;
  const log = ctx.log || (() => {});

  async function listOllamaModels(baseUrl, provider) {
    const root = stripBase(baseUrl || defaultBase('ollama'));
    const tags = await fetchJson(`${root}/api/tags`);
    const checked = await Promise.all((tags.models || []).map(async m => {
      const id = m.name || m.model;
      try {
        const detail = await fetchJson(`${root}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: id }) });
        return (detail.capabilities || []).includes('vision') ? { id, name: id, vision: true } : null;
      } catch {
        return isVisionByProviderConfig({ id, details: m.details }, provider) ? { id, name: id, vision: true } : null;
      }
    }));
    return checked.filter(Boolean);
  }
  async function listOpenAIModels(baseUrl, apiKey, provider) {
    const data = await fetchJson(`${stripBase(baseUrl)}/models`, { headers: authHeaders(apiKey) });
    return (data.data || []).filter(m => isVisionByProviderConfig(m, provider)).map(m => ({ id: m.id, name: m.id, vision: true }));
  }
  async function listGoogleModels(baseUrl, apiKey, provider) {
    const root = stripBase(baseUrl || defaultBase('google'));
    const data = await fetchJson(`${root}/models?key=${encodeURIComponent(apiKey)}`);
    return (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && isVisionByProviderConfig(m, provider))
      .map(m => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName || m.name, vision: true }));
  }

  async function listModels(settings) {
    const provider = providers()[settings.provider];
    if (!provider) throw new Error(`Unsupported provider: ${settings.provider}`);
    const apiKey = ctx.getApiKey(settings);
    if (provider.api_key?.required && !apiKey) throw new Error('API key is required for this provider.');
    const base = settings.baseUrl || provider.base_url;
    if (provider.id === 'ollama') return listOllamaModels(base, provider);
    if (provider.id === 'google') return listGoogleModels(base, apiKey, provider);
    if (['openai', 'mistral', 'groq', 'openrouter', 'openai-compatible', 'lm-studio'].includes(provider.id)) return listOpenAIModels(base, apiKey, provider);
    throw new Error(`Unsupported provider: ${provider.id}`);
  }

  async function verifyProvider(settings) {
    const provider = providers()[settings.provider];
    if (!provider) throw new Error('Provider is not configured.');
    const apiKey = ctx.getApiKey(settings);
    if (provider.api_key?.required && !apiKey) throw new Error('API key is required for this provider.');
    if (provider.id === 'ollama') await fetchJson(`${stripBase(settings.baseUrl || defaultBase('ollama'))}/api/tags`);
    else await fetchJson(`${stripBase(settings.baseUrl || provider.base_url)}/models`, { headers: authHeaders(apiKey) });
  }

  async function callOpenAICompatible(settings, messages) {
    const preparedMessages = messages.map(message => {
      if (!Array.isArray(message.content)) return message;
      return {
        ...message,
        content: message.content.map(part => (part.type === 'image_url' && settings.provider === 'openai')
          ? { ...part, image_url: { ...part.image_url, detail: 'high' } } : part)
      };
    });
    const data = await fetchJson(`${stripBase(settings.baseUrl)}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(settings.apiKey) },
      body: JSON.stringify({ model: settings.model, messages: preparedMessages, temperature: 0.4, max_tokens: 8192 })
    });
    const choice = data?.choices?.[0];
    let content = choice?.message?.content;
    if (Array.isArray(content)) content = content.map(p => typeof p === 'string' ? p : (p?.text || '')).join('');
    content = String(content || '').trim();
    if (!content) {
      const reason = choice?.finish_reason || choice?.native_finish_reason || 'unknown';
      const refusal = choice?.message?.refusal ? ` Refusal: ${choice.message.refusal}` : '';
      const apiErr = data?.error?.message ? ` Provider: ${data.error.message}` : '';
      const err = new Error(`The model returned an empty response (finish_reason: ${reason}). ${reason === 'length' ? 'It likely spent all tokens on reasoning; try a non-reasoning model.' : 'Try again or choose another model.'}${refusal}${apiErr}`);
      err.emptyResponse = true;
      throw err;
    }
    return content;
  }

  async function callOllama(settings, messages) {
    const normalized = messages.map(message => {
      if (!Array.isArray(message.content)) return message;
      const text = message.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
      const images = message.content.filter(p => p.type === 'image_url').map(p => String(p.image_url.url).replace(/^data:image\/[^;]+;base64,/, ''));
      return { role: message.role, content: text, ...(images.length ? { images } : {}) };
    });
    const data = await fetchJson(`${stripBase(settings.baseUrl || defaultBase('ollama'))}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.model, messages: normalized, stream: false })
    });
    return data?.message?.content || '';
  }

  async function callGoogle(settings, messages) {
    const root = stripBase(settings.baseUrl || defaultBase('google'));
    const contents = messages.map(message => {
      const parts = Array.isArray(message.content) ? message.content.map(p => {
        if (p.type === 'text') return { text: p.text };
        const match = String(p.image_url.url).match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
        return match ? { inlineData: { mimeType: match[1], data: match[2] } } : { text: String(p.image_url.url) };
      }) : [{ text: message.content }];
      return { role: message.role === 'assistant' ? 'model' : 'user', parts };
    });
    const data = await fetchJson(`${root}/models/${encodeURIComponent(settings.model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig: { temperature: 0.4 } })
    });
    return data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  }

  async function callVision(rawSettings, messages) {
    const provider = providers()[rawSettings.provider];
    const settings = { ...rawSettings, apiKey: ctx.getApiKey(rawSettings), baseUrl: rawSettings.baseUrl || provider?.base_url || '' };
    if (provider?.api_key?.required && !settings.apiKey) throw new Error('API key is required for this provider. Save it in Settings and reconnect.');
    const call = () => settings.provider === 'ollama' ? callOllama(settings, messages)
      : settings.provider === 'google' ? callGoogle(settings, messages)
      : callOpenAICompatible(settings, messages);
    const maxAttempts = 3;
    for (let attempt = 1; ; attempt++) {
      try { return await call(); }
      catch (e) {
        if (!e.emptyResponse || attempt >= maxAttempts) throw e;
        console.warn(`[Prompt Builder] Empty model response, retrying (${attempt}/${maxAttempts - 1})`);
      }
    }
  }

  async function analyze({ settings, images, instruction, sceneElementOptions, placementOptionsByScene, placementOptions, compositionOptions }) {
    if (!settings?.model) throw new Error('No Vision model selected');
    if (!Array.isArray(images) || !images.length) throw new Error('No reference images were received.');
    const normalized = images.map((url, index) => {
      const match = String(url || '').match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
      if (!match) throw new Error(`Reference image ${index + 1} is not a valid data URL.`);
      return { mimeType: match[1], base64: match[2] };
    });
    const imageParts = normalized.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } }));
    const analysisInstruction = String(instruction || 'Analyze only the attached reference image(s). Treat the visible image content as the sole source of truth.');
    const system = `${ANALYZE_SYSTEM_PREFIX}${analysisInstruction}${ANALYZE_SYSTEM_SUFFIX}`;
    const sceneOptions = (Array.isArray(sceneElementOptions) ? sceneElementOptions : []).map(o => String(o || '').trim()).filter(Boolean);
    const placementsByScene = placementOptionsByScene && typeof placementOptionsByScene === 'object' && !Array.isArray(placementOptionsByScene)
      ? placementOptionsByScene
      : {};
    const fallbackOptions = (Array.isArray(placementOptions) ? placementOptions : Array.isArray(compositionOptions) ? compositionOptions : []).map(o => String(o || '').trim()).filter(Boolean);
    const userText = `Analyze ${normalized.length} attached reference image${normalized.length === 1 ? '' : 's'} as a single reference set. If there are multiple images, analyze each image separately first, then compare them and report only traits shared across all images. Extract ONLY the common visual language and a representative palette of no more than 8 HEX colors. Return JSON only: {"description":"...","palette":["#RRGGBB"],"suggestions":{"style":"...","sceneElements":"...","placement":"..."}}.${sceneOptions.length ? ` The "sceneElements" value must exactly match one of: ${sceneOptions.map(o => JSON.stringify(o)).join(', ')}. The "placement" value must exactly match one of the placement options associated with that sceneElements value in this mapping: ${JSON.stringify(placementsByScene)}.` : ''}${fallbackOptions.length ? ` For legacy requests without scene options, "placement" must match one of: ${fallbackOptions.map(o => JSON.stringify(o)).join(', ')}.` : ''} Do not include differences between images or any final generation instructions. Do not include any information about UI or texts in the result.`;
    log('Reference analysis request', { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model, imageCount: normalized.length, systemPrompt: system, userPrompt: userText });
    const raw = await callVision(settings, [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: userText }, ...imageParts] }]);
    const out = parseJsonText(raw);
    const palette = Array.isArray(out.palette)
      ? out.palette.map(c => String(c || '').trim().toUpperCase()).filter(c => /^#[0-9A-F]{6}$/.test(c)).slice(0, 8)
      : [];
    const rawSceneElements = String(out.suggestions?.sceneElements || '').trim();
    const sceneElements = sceneOptions.find(option => option.toLowerCase() === rawSceneElements.toLowerCase()) || '';
    const validPlacements = Array.isArray(placementsByScene[sceneElements])
      ? placementsByScene[sceneElements].map(option => String(option || '').trim()).filter(Boolean)
      : fallbackOptions;
    const rawPlacement = String(out.suggestions?.placement || out.suggestions?.composition || '').trim();
    const placement = validPlacements.find(option => option.toLowerCase() === rawPlacement.toLowerCase()) || '';
    const suggestions = {
      style: String(out.suggestions?.style || '').trim().slice(0, 120),
      sceneElements,
      placement
    };
    return { description: out.description || raw, palette, suggestions };
  }

  function buildGenerationRequest({ values, referenceDescription, template: selectedTemplate }, config) {
    const aiTool = String(values?.aiTool || '').trim();
    const template = String(selectedTemplate || '').trim() || selectPromptTemplate(config, aiTool);
    if (!template) throw new Error(`No prompt template configured for AI Tool: ${aiTool || 'Unknown'}`);
    const configLines = Object.entries(values || {}).map(([key, value]) => formatGenerationValue(key, value)).join('\n');
    const user = `AI TOOL: ${aiTool}\n\nPROMPT TEMPLATE\n${template}\n\nBUILDER CONFIGURATION\n${configLines || 'No configuration values provided.'}\n\nDESCRIPTION OF REFERENCES\n${referenceDescription || 'No reference description provided.'}\n\nComplete the template now. Fill its placeholders and sections using the supplied data. Output only the final ready-to-use image-generation prompt. Explicitly include this requirement: "${REQUIRED_IMAGE_EXCLUSIONS}".`;
    return {
      aiTool,
      template,
      systemPrompt: GENERATE_SYSTEM,
      userPrompt: user,
      clipboardPrompt: `SYSTEM INSTRUCTIONS\n${GENERATE_SYSTEM}\n\nUSER REQUEST\n${user}`
    };
  }

  async function generate({ settings, values, referenceDescription, template: selectedTemplate }, config) {
    if (!settings?.model) throw new Error('No Vision model selected');
    const request = buildGenerationRequest({ values, referenceDescription, template: selectedTemplate }, config);
    const { aiTool, template, systemPrompt, userPrompt } = request;
    log('Final prompt generation request', { provider: settings.provider, baseUrl: settings.baseUrl, model: settings.model, aiTool, template, systemPrompt, userPrompt });
    const raw = await callVision(settings, [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }]);
    const generatedPrompt = String(raw || '').trim();
    const prompt = generatedPrompt.toLowerCase().includes(REQUIRED_IMAGE_EXCLUSIONS.toLowerCase())
      ? generatedPrompt
      : [generatedPrompt, REQUIRED_IMAGE_EXCLUSIONS].filter(Boolean).join('\n\n');
    return { prompt, aiTool, template, debug: { aiTool, template, systemPrompt, userPrompt } };
  }

  return { listModels, verifyProvider, analyze, generate, buildGenerationRequest };
}
