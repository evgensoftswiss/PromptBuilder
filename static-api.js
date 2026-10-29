// Browser backend for GitHub Pages: ./api/* requests are served in the page.
// Data lives in localStorage and AI providers are called directly via core.js.
(function () {
  const realFetch = window.fetch.bind(window);
  const KEYS = { presets: 'pb-presets-v1', templates: 'pb-user-templates-v1', providerKeys: 'pb-provider-keys-v1' };
  const API = /^(?:\.\/|\/)?api\/([^?#]*)/;
  let corePromise = null;

  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const text = (message, status = 500) => new Response(String(message), { status, headers: { 'Content-Type': 'text/plain' } });
  const read = (key, fallback) => { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const getJson = async (url) => { const r = await realFetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`Could not load ${url} (HTTP ${r.status})`); return r.json(); };

  let providersCache = null;
  async function providers() {
    if (!providersCache) {
      let data;
      data = await getJson('./config_providers.json');
      providersCache = Object.fromEntries((data.providers || []).map(p => [p.id, p]));
    }
    return providersCache;
  }
  const storedKey = (id) => String((read(KEYS.providerKeys, {}) || {})[id] || '');

  function core() {
    return corePromise || (corePromise = Promise.all([import('./core.js'), providers()]).then(([mod, list]) =>
      mod.createCore({ providers: list, getApiKey: (s) => String(s?.apiKey || '').trim() || storedKey(s?.provider) })));
  }

  async function handle(route, init) {
    const method = String(init.method || 'GET').toUpperCase();
    const body = () => { try { return JSON.parse(init.body || '{}'); } catch { return {}; } };

    if (route === 'status') {
      let version = '';
      try { version = (await getJson('./package.json')).version || ''; } catch {}
      return json({ ok: true, version, mode: 'static' });
    }
    if (route === 'config') return json(await getJson('./config.json'));

    if (route === 'presets' && method === 'GET') return json({ ok: true, presets: read(KEYS.presets, []) });
    if (route === 'presets' && method === 'POST') {
      const b = body();
      const name = String(b.name || '').trim();
      if (!name) return json({ ok: false, error: 'Preset name is required.' }, 400);
      const now = new Date().toISOString();
      const presets = read(KEYS.presets, []);
      const i = presets.findIndex(p => String(p.name).toLowerCase() === name.toLowerCase());
      const record = { name, createdAt: i >= 0 ? presets[i].createdAt : now, updatedAt: now, values: b.values || {}, referenceDescription: String(b.referenceDescription || ''), prompt: String(b.prompt || '') };
      if (i >= 0) presets.splice(i, 1);
      presets.push(record);
      while (presets.length > 20) presets.shift();
      write(KEYS.presets, presets);
      return json({ ok: true, presets });
    }
    if (route.startsWith('presets/') && method === 'DELETE') {
      const target = decodeURIComponent(route.slice('presets/'.length)).toLowerCase();
      const presets = read(KEYS.presets, []).filter(p => String(p.name).toLowerCase() !== target);
      write(KEYS.presets, presets);
      return json({ ok: true, presets });
    }

    if (route === 'user-templates' && method === 'GET') return json({ ok: true, templates: read(KEYS.templates, []) });
    if (route === 'user-templates' && method === 'PUT') {
      const templates = body().templates;
      if (!Array.isArray(templates)) return json({ ok: false, error: 'templates must be an array.' }, 400);
      write(KEYS.templates, templates);
      return json({ ok: true, count: templates.length });
    }

    if (route === 'provider-credentials' && method === 'GET') {
      const list = await providers();
      return json({ ok: true, providers: Object.fromEntries(Object.entries(list).map(([id, p]) => [id, { has_saved_key: !!storedKey(id), required: !!p.api_key?.required }])) });
    }
    if (route === 'provider-credentials' && method === 'POST') {
      const { provider, apiKey } = body();
      const list = await providers();
      if (!list[provider]) return json({ ok: false, error: 'Provider is not configured.' }, 400);
      const keys = read(KEYS.providerKeys, {}) || {};
      const value = String(apiKey || '').trim();
      if (value && list[provider].api_key?.required) keys[provider] = value; else delete keys[provider];
      write(KEYS.providerKeys, keys);
      return json({ ok: true, saved: !!keys[provider] });
    }

    try {
      if (route === 'verify-provider') { await (await core()).verifyProvider(body()); return json({ ok: true }); }
      if (route === 'models') return json({ ok: true, models: await (await core()).listModels(body()) });
    } catch (e) { return json({ ok: false, error: e.message }, 400); }

    try {
      if (route === 'analyze') return json(await (await core()).analyze(body()));
      if (route === 'generate') return json(await (await core()).generate(body(), await getJson('./config.json')));
    } catch (e) { return text(e.message, 500); }

    return json({ ok: false, error: `Unknown endpoint: ${route}` }, 404);
  }

  document.documentElement.dataset.pbMode = 'static';
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const match = API.exec(url);
    if (!match) return realFetch(input, init);
    return handle(match[1], init || {});
  };
})();
