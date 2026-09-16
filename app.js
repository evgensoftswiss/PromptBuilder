let CONFIG = null;
let refs = [];
let currentResult = null;
let providerModels = [];

const $ = (id) => document.getElementById(id);

let PROVIDERS = {};
let PROVIDER_ORDER = [];
let SAVED_CREDENTIALS = {};
let SAVED_PRESETS = [];
let PROMPT_TEMPLATES = [];
let selectedTemplateIndex = -1;
let BASELINE_TEMPLATE_MAX_ID = 0;
let BASELINE_TEMPLATE_IDS = new Set();

const TEMPLATE_RATING = { Excellent: 5, Good: 4, Average: 3, 'Needs Improvement': 2 };
function templateStars(value) {
  const score = TEMPLATE_RATING[String(value)] || 0;
  return '★'.repeat(score) + '☆'.repeat(Math.max(0, 5 - score));
}
function templateValues(key) {
  const values = uniqueTemplateValues(key);
  return ['All', ...values];
}

function templateTaxonomyValues(key) {
  return uniqueTemplateValues(key);
}

function refreshBuilderTaxonomy() {
  if (!CONFIG?.fields || !Array.isArray(PROMPT_TEMPLATES)) return;
  const sections = templateTaxonomyValues('section');
  const categories = templateTaxonomyValues('category');
  const agents = templateTaxonomyValues('agent');
  const sectionField = CONFIG.fields.find(f => f.id === 'section');
  const categoryField = CONFIG.fields.find(f => f.id === 'category');
  const aiToolField = CONFIG.fields.find(f => f.id === 'aiTool');
  if (sectionField) {
    sectionField.options = sections.map(value => ({ value, label: value }));
  }
  if (categoryField) {
    categoryField.options = categories.map(value => ({ value, label: value }));
  }
  if (aiToolField) {
    aiToolField.options = agents.map(value => ({ value, label: value }));
  }
  const sectionSelect = $('field-section');
  const categorySelect = $('field-category');
  const aiToolSelect = $('field-aiTool');
  const setSelectOptions = (select, values) => {
    if (!select) return;
    const current = select.value;
    select.innerHTML = values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join('');
    if (current && values.includes(current)) select.value = current;
    else if (values.length) select.value = values[0];
  };
  setSelectOptions(sectionSelect, sections);
  setSelectOptions(categorySelect, categories);
  setSelectOptions(aiToolSelect, agents);
  if (categorySelect) categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
  if (aiToolSelect) aiToolSelect.dispatchEvent(new Event('change', { bubbles: true }));
  updateOpenToolButton();
}
function fillTemplateFilter(id, key, preserve = '') {
  const select = $(id);
  if (!select) return;
  const allLabels = { section: 'All sections', category: 'All categories', agent: 'All AI tools' };
  const values = templateValues(key);
  select.innerHTML = values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value === 'All' ? allLabels[key] : value)}</option>`).join('');
  select.value = values.includes(preserve) ? preserve : 'All';
}
function updateCategoryVisibility() {
  const categoryField = $('templateCategory')?.closest('label');
  if (categoryField) {
    categoryField.hidden = false;
    categoryField.style.display = '';
  }
  return true;
}
function templateSection(item) { return String(item.section || '').trim(); }
function templateCategory(item) { return String(item.category || '').trim(); }
function filteredTemplateIndexes() {
  const filters = { section: $('templateSection')?.value || 'All', category: $('templateCategory')?.value || 'All', agent: $('templateAgent')?.value || 'All' };
  return PROMPT_TEMPLATES.map((item, i) => ({item, i})).filter(({item}) =>
    Object.entries(filters).every(([key,value]) => value === 'All' || (key === 'section' ? templateSection(item) : key === 'category' ? templateCategory(item) : item[key]) === value)
  );
}
function templateDisplayName(item, index) {
  return item.name || `${templateCategory(item) || 'Template'} ${index + 1}`;
}
function uniqueTemplateValues(key) {
  return [...new Set(PROMPT_TEMPLATES.map(item => String(key === 'section' ? templateSection(item) : key === 'category' ? templateCategory(item) : (item[key] || '')).trim()).filter(Boolean))];
}
function templateChoiceOptions(key, current = '') {
  const values = uniqueTemplateValues(key);
  if (current && !values.includes(current)) values.push(current);
  return values;
}
function fillTemplateMetaSelect(id, key, current = '') {
  const select = $(id);
  if (!select) return;
  const values = templateChoiceOptions(key, current);
  select.innerHTML = '';
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  const add = document.createElement('option');
  add.value = '__ADD_NEW__';
  add.textContent = '+ Add new value…';
  select.appendChild(add);
  select.value = current && values.includes(current) ? current : (values[0] || '');
}
function persistConfigToDisk() {
  try {
    const snapshot = JSON.parse(JSON.stringify(CONFIG));
    if (Array.isArray(snapshot?.fields)) snapshot.fields.forEach(field => { if (field.id === 'section' || field.id === 'category' || field.id === 'aiTool') delete field.options; });
    if (snapshot?.defaults) { delete snapshot.defaults.section; delete snapshot.defaults.category; delete snapshot.defaults.aiTool; }
    localStorage.setItem('pb-builder-config-v1', JSON.stringify(snapshot));
    return true;
  } catch (error) {
    console.warn('[Prompt Builder] Could not persist Builder configuration locally:', error);
    return false;
  }
}

function syncTemplateTaxonomyToBuilder(key, value) {
  refreshBuilderTaxonomy();
  if (key === 'section') { fillTemplateFilter('templateSection', 'section', $('templateSection')?.value || 'All'); }
  if (key === 'category') fillTemplateFilter('templateCategory', 'category', $('templateCategory')?.value || 'All');
  if (key === 'agent') fillTemplateFilter('templateAgent', 'agent', $('templateAgent')?.value || 'All');
  return true;
}
function installMetaSelect(id, key) {
  const select = $(id);
  if (!select || select.dataset.bound === '1') return;
  select.dataset.bound = '1';
  select.addEventListener('change', async () => {
    if (select.value !== '__ADD_NEW__') { writeTemplateEditorToModel(); return; }
    const label = key === 'agent' ? 'AI Tool' : key === 'section' ? 'Section' : 'Category';
    const value = window.prompt(`Enter new ${label}:`);
    if (!value || !value.trim()) { populateTemplateEditor(selectedTemplateIndex); return; }
    const clean = value.trim();
    const item = PROMPT_TEMPLATES[selectedTemplateIndex];
    if (!item) return;
    item[key] = clean;
    
    fillTemplateMetaSelect(id, key, clean);
    syncTemplateTaxonomyToBuilder(key, clean);
    writeTemplateEditorToModel();
    renderTemplateEditorList();
    await persistConfigToDisk();
  });
}
function renderTemplateEditorList() {
  const list = $('templateEditorList');
  if (!list) return;
  const visible = filteredTemplateIndexes();
  $('templatesCount').textContent = `${visible.length} template${visible.length === 1 ? '' : 's'}`;
  list.innerHTML = visible.length ? visible.map(({item,i}) => `<button type="button" class="template-editor-item ${i === selectedTemplateIndex ? 'active' : ''}" data-template-index="${i}"><strong>${escapeHtml(templateDisplayName(item,i))}</strong><span>${escapeHtml(item.agent || '')}</span><small>${escapeHtml(templateSection(item))} · ${escapeHtml(templateCategory(item))}</small></button>`).join('') : '<div class="template-empty">No templates match.</div>';
  list.querySelectorAll('.template-editor-item').forEach(btn => btn.addEventListener('click', () => selectTemplate(Number(btn.dataset.templateIndex))));
}
function highlightPromptText(text) {
  let html = escapeHtml(text || '');
  html = html.replace(/(^|\n)(#{1,6}[^\n]*)/g, '$1<span class="syn-heading">$2</span>');
  html = html.replace(/(^|\n)(\s*[-*+]\s+[^\n]*)/g, '$1<span class="syn-list">$2</span>');
  html = html.replace(/(\{\{[^{}]+\}\}|\{[^{}\n]+\})/g, '<span class="syn-var">$1</span>');
  html = html.replace(/(https?:\/\/[^\s]+)/g, '<span class="syn-link">$1</span>');
  return html || '<span class="syn-placeholder">Start writing your prompt template…</span>';
}
function syncPromptHighlight() {
  const area = $('editorPromptTemplate');
  const layer = $('editorPromptHighlight');
  if (!area || !layer) return;
  layer.innerHTML = highlightPromptText(area.value);
  layer.scrollTop = area.scrollTop;
  layer.scrollLeft = area.scrollLeft;
}
function configureVariableMap() {
  const map = {};
  if (!Array.isArray(CONFIG?.fields)) return map;
  const aliases = {
    aiTool: ['ai tool', 'ai tool / agent', 'agent'],
    color_palette: ['color palette', 'palette'],
    dimensions: ['dimensions', 'format'],
    reference_description: ['reference description', 'description of references', 'references'],
    hero_subject: ['hero subject', 'hero object']
  };
  CONFIG.fields.forEach(field => {
    const el = field.type === 'palette' ? null : $(`field-${field.id}`);
    let value = field.type === 'palette' ? (getConfigValues()[field.id] || []) : (el?.value || '');
    if (Array.isArray(value)) value = value.filter(Boolean).join(', ');
    const keys = [field.id, field.label, ...(aliases[field.id] || [])].filter(Boolean);
    keys.forEach(key => {
      const normalized = String(key).trim();
      map[normalized] = value;
      map[normalized.toLowerCase()] = value;
      map[normalized.toLowerCase().replace(/[._-]/g, ' ')] = value;
    });
  });
  const ref = $('referenceDescription')?.value || '';
  map.reference_description = ref;
  map['description of references'] = ref;
  map.references = ref;
  return map;
}
function isBaselineTemplate(item) { return !!item && BASELINE_TEMPLATE_IDS.has(Number(item.id)); }
function setTemplateEditorDisabled(disabled) {
  ['editorTemplateName','editorTemplateSection','editorTemplateCategory','editorTemplateAgent','editorTemplateRating','editorPromptTemplate','editorContext','editorEvaluation'].forEach(id => { const el=$(id); if (el) el.disabled=disabled; });
  const save=$('templateSaveBtn'); if (save) save.disabled=disabled;
}
function updateTemplateDeleteState() {
  const btn = $('templateDeleteBtn');
  if (!btn) return;
  const item = PROMPT_TEMPLATES[selectedTemplateIndex];
  const canDelete = !!item && !isBaselineTemplate(item);
  btn.disabled = !canDelete;
  btn.title = canDelete ? 'Delete this template' : 'This template cannot be deleted';
}
function updateEditorRatingStars(value) {
  const root = $('editorTemplateRatingStars');
  if (!root) return;
  const score = TEMPLATE_RATING[String(value)] || 0;
  root.textContent = '★'.repeat(score) + '☆'.repeat(Math.max(0, 5 - score));
  root.title = value || '';
}
function populateTemplateEditor(index) {
  const item = PROMPT_TEMPLATES[index]; if (!item) return;
  $('templateEditorEmpty').hidden = true; $('templateEditorForm').hidden = false;
  $('editorTemplateTitle').textContent = templateDisplayName(item,index);
  $('editorTemplateMeta').textContent = `${templateSection(item)} · ${templateCategory(item)} · ${item.agent || ''}`;
  $('editorTemplateName').value = item.name || templateDisplayName(item,index);
  fillTemplateMetaSelect('editorTemplateSection','section', templateSection(item));
  fillTemplateMetaSelect('editorTemplateCategory','category', templateCategory(item));
  fillTemplateMetaSelect('editorTemplateAgent','agent', item.agent || '');
  installMetaSelect('editorTemplateSection','section');
  installMetaSelect('editorTemplateCategory','category');
  installMetaSelect('editorTemplateAgent','agent');
  $('editorTemplateRating').value = item.effectiveness_rating || 'Average';
  updateEditorRatingStars($('editorTemplateRating').value);
  $('editorPromptTemplate').value = item.prompt_template || '';
  $('editorContext').value = item.context || '';
  $('editorEvaluation').value = item.evaluation || '';
  syncPromptHighlight();
  setTemplateEditorDisabled(isBaselineTemplate(item));
  updateTemplateDeleteState();
  renderTemplateEditorList();
}
function writeTemplateEditorToModel() {
  if (selectedTemplateIndex < 0 || !PROMPT_TEMPLATES[selectedTemplateIndex]) return;
  const item = PROMPT_TEMPLATES[selectedTemplateIndex];
  if (isBaselineTemplate(item)) return;
  item.name = $('editorTemplateName').value.trim();
  item.section = $('editorTemplateSection').value.trim();
  item.category = $('editorTemplateCategory').value.trim();
  item.agent = $('editorTemplateAgent').value.trim();
  item.effectiveness_rating = $('editorTemplateRating').value;
  item.prompt_template = $('editorPromptTemplate').value;
  item.context = $('editorContext').value;
  item.evaluation = $('editorEvaluation').value;
}

function alignTemplateFiltersToCurrentTemplate() {
  if (selectedTemplateIndex < 0) return;
  const item = PROMPT_TEMPLATES[selectedTemplateIndex];
  if (!item) return;
  const mappings = [
    ['templateSection', templateSection(item) || 'All'],
    ['templateCategory', templateCategory(item) || 'All'],
    ['templateAgent', item.agent || 'All']
  ];
  let changed = false;
  mappings.forEach(([id, value]) => {
    const select = $(id);
    if (!select || !value || value === 'All') return;
    const current = select.value || 'All';
    if (current !== 'All' && current !== value) { select.value = value; changed = true; }
  });
  if (changed) { updateCategoryVisibility(); renderTemplateEditorList(); }
}
async function saveTemplateFile() {
  if (selectedTemplateIndex < 0 || isBaselineTemplate(PROMPT_TEMPLATES[selectedTemplateIndex])) { updateTemplateDeleteState(); return; }
  writeTemplateEditorToModel();
  syncTemplateTaxonomyToBuilder('section', templateSection(PROMPT_TEMPLATES[selectedTemplateIndex] || {}));
  syncTemplateTaxonomyToBuilder('category', templateCategory(PROMPT_TEMPLATES[selectedTemplateIndex] || {}));
  syncTemplateTaxonomyToBuilder('agent', PROMPT_TEMPLATES[selectedTemplateIndex]?.agent || '');
  alignTemplateFiltersToCurrentTemplate();
  await persistUserTemplates();
  const configSnapshot = JSON.parse(JSON.stringify(CONFIG));
  if (Array.isArray(configSnapshot?.fields)) configSnapshot.fields.forEach(field => { if (field.id === 'section' || field.id === 'category' || field.id === 'aiTool') delete field.options; });
  if (configSnapshot?.defaults) { delete configSnapshot.defaults.category; delete configSnapshot.defaults.aiTool; }
  localStorage.setItem('pb-builder-config-v1', JSON.stringify(configSnapshot));
  $('editorSaveStatus').textContent = 'Templates saved';
  $('editorSaveStatus').style.color = '#047857';
  setTimeout(() => { if ($('editorSaveStatus')) $('editorSaveStatus').textContent = ''; }, 1600);
  renderTemplateEditorList(); populateTemplateEditor(selectedTemplateIndex);
}
function selectTemplate(index) { selectedTemplateIndex = index; populateTemplateEditor(index); }
function nextTemplateName(section, agent) {
  const parts = [section, agent].filter(value => value && value !== 'All').map(value => String(value).trim()).filter(Boolean);
  const prefix = parts.join('-') || 'Template';
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escapedPrefix}-(\\d+)$`);
  let maxNumber = 0;
  PROMPT_TEMPLATES.forEach(item => {
    const match = String(item.name || '').trim().match(re);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]) || 0);
  });
  return `${prefix}-${maxNumber + 1}`;
}
function nextUserTemplateId() {
  return Math.max(BASELINE_TEMPLATE_MAX_ID, ...PROMPT_TEMPLATES.map(item => Number(item.id) || 0)) + 1;
}
async function addTemplate() {
  const filterState = {
    section: $('templateSection')?.value || 'All',
    category: $('templateCategory')?.value || 'All',
    agent: $('templateAgent')?.value || 'All'
  };
  const selectedSection = filterState.section !== 'All' ? filterState.section : '';
  const selectedCategory = filterState.category !== 'All' ? filterState.category : '';
  const selectedAgent = filterState.agent !== 'All' ? filterState.agent : '';
  const newTemplate = {
    id: nextUserTemplateId(),
    name: nextTemplateName(selectedSection, selectedAgent),
    section: selectedSection,
    category: selectedCategory,
    agent: selectedAgent,
    prompt_template: 'Create a new production-ready image prompt.\n\nUse the supplied reference description and Configure requirements.',
    context: '', effectiveness_rating: 'Average', evaluation: ''
  };
  PROMPT_TEMPLATES.push(newTemplate);
  selectedTemplateIndex = PROMPT_TEMPLATES.length - 1;
  await persistUserTemplates();
  fillTemplateFilter('templateSection','section', filterState.section);
  fillTemplateFilter('templateCategory','category', filterState.category);
  fillTemplateFilter('templateAgent','agent', filterState.agent);
  refreshBuilderTaxonomy();
  updateCategoryVisibility();
  populateTemplateEditor(selectedTemplateIndex);
}

async function duplicateTemplate() { if (selectedTemplateIndex < 0) return; const source = PROMPT_TEMPLATES[selectedTemplateIndex]; const copy = JSON.parse(JSON.stringify(source)); copy.id = nextUserTemplateId(); copy.name = `${templateDisplayName(source, selectedTemplateIndex)} Copy`; PROMPT_TEMPLATES.splice(selectedTemplateIndex + 1, 0, copy); selectedTemplateIndex += 1; await persistUserTemplates(); renderTemplateEditorList(); populateTemplateEditor(selectedTemplateIndex); alignTemplateFiltersToCurrentTemplate(); }
async function deleteTemplate() {
  if (selectedTemplateIndex < 0) return;
  if (isBaselineTemplate(PROMPT_TEMPLATES[selectedTemplateIndex])) { updateTemplateDeleteState(); return; }
  if (!confirm('Delete this template?')) return;
  const deletedIndex = selectedTemplateIndex;
  PROMPT_TEMPLATES.splice(deletedIndex, 1);
  try {
    await persistUserTemplates();
  } catch (error) { console.warn('[Prompt Builder] Could not persist deleted template:', error); }
  const visible = filteredTemplateIndexes();
  if (visible.length) {
    const prior = visible.filter(({i}) => i < deletedIndex);
    selectedTemplateIndex = prior.length ? prior[prior.length - 1].i : visible[visible.length - 1].i;
  } else {
    selectedTemplateIndex = -1;
  }
  renderTemplateEditorList();
  if (selectedTemplateIndex >= 0) populateTemplateEditor(selectedTemplateIndex);
  else { $('templateEditorForm').hidden = true; $('templateEditorEmpty').hidden = false; }
}
function renderTemplates() { renderTemplateEditorList(); if (selectedTemplateIndex >= 0 && PROMPT_TEMPLATES[selectedTemplateIndex]) populateTemplateEditor(selectedTemplateIndex); }

async function loadTemplates() {
  try {
    const normalize = (item) => {
      const next = { ...item };
      const parsedId = Number(next.id);
      next.id = Number.isFinite(parsedId) && parsedId > 0 ? parsedId : null;
      next.section = String(next.section || '').trim();
      next.category = String(next.category || '').trim();
      next.agent = String(next.agent || '').trim();
      return next;
    };
    const response = await fetch('./prompt_templates.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const baseline = await response.json();
    const baselineTemplates = Array.isArray(baseline?.templates) ? baseline.templates.map(normalize) : [];
    BASELINE_TEMPLATE_MAX_ID = baselineTemplates.reduce((m, item) => Math.max(m, Number(item.id) || 0), 0);
    BASELINE_TEMPLATE_IDS = new Set(baselineTemplates.map(item => Number(item.id)).filter(Number.isFinite));
    BASELINE_TEMPLATE_MAX_ID = baselineTemplates.reduce((m, item) => Math.max(m, Number(item.id) || 0), 0);
    let usedIds = new Set(baselineTemplates.map(item => item.id).filter(Number.isFinite));

    let userTemplates = [];
    try {
      let candidates = [];
      if (window.__PB_LOCAL_SERVER__ || document.body?.dataset?.pbMode === 'local') {
        const r = await fetch('./user_templates.json', { cache: 'no-store' });
        if (r.ok) { const stored = await r.json(); candidates = Array.isArray(stored?.templates) ? stored.templates : []; }
      } else {
        const raw = localStorage.getItem('pb-user-templates-v4') || localStorage.getItem('pb-user-templates-v3') || localStorage.getItem('pb-prompt-templates-v2') || localStorage.getItem('pb-prompt-templates-v1');
        if (raw) { const stored = JSON.parse(raw); candidates = Array.isArray(stored?.templates) ? stored.templates : (Array.isArray(stored) ? stored : []); }
      }
      let nextId = Math.max(BASELINE_TEMPLATE_MAX_ID, ...candidates.map(x => Number(x?.id) || 0));
      for (const rawItem of candidates) {
        const item = normalize(rawItem);
        const legacyUser = rawItem?.CanBeDeleted === true || !BASELINE_TEMPLATE_IDS.has(Number(item.id));
        if (isBaselineTemplate(item) || !legacyUser) continue;
        delete item.CanBeDeleted;
        if (!Number.isFinite(item.id) || item.id <= BASELINE_TEMPLATE_MAX_ID || usedIds.has(item.id)) item.id = ++nextId;
        usedIds.add(item.id);
        userTemplates.push(item);
      }
    } catch (_) { userTemplates = []; }

    const dedupe = new Set(baselineTemplates.map(item => JSON.stringify({section:item.section,category:item.category,agent:item.agent,prompt_template:item.prompt_template||''})));
    userTemplates = userTemplates.filter(item => {
      const sig=JSON.stringify({section:item.section,category:item.category,agent:item.agent,prompt_template:item.prompt_template||''});
      if (dedupe.has(sig)) return false; dedupe.add(sig); return true;
    });
    PROMPT_TEMPLATES = [...baselineTemplates, ...userTemplates];
    if (!(window.__PB_LOCAL_SERVER__ || document.body?.dataset?.pbMode === 'local')) persistUserTemplates();

    fillTemplateFilter('templateSection', 'section');
    fillTemplateFilter('templateCategory', 'category');
    fillTemplateFilter('templateAgent', 'agent');
    refreshBuilderTaxonomy();
    updateCategoryVisibility();
    ['templateSection', 'templateCategory', 'templateAgent'].forEach(id => {
      const el = $(id);
      if (el && el.dataset.bound !== '1') {
        el.dataset.bound = '1';
        el.addEventListener('change', renderTemplateEditorList);
      }
    });
    renderTemplateEditorList();
    if (PROMPT_TEMPLATES.length) {
      const visible = filteredTemplateIndexes();
      selectedTemplateIndex = visible[0]?.i ?? 0;
      populateTemplateEditor(selectedTemplateIndex);
    }
  } catch (error) {
    console.error('[Prompt Builder] Could not load prompt templates:', error);
    if ($('templateEditorList')) $('templateEditorList').innerHTML = '<div class="template-empty">Could not load prompt templates.</div>';
  }
}

async function persistUserTemplates() {
  const users = PROMPT_TEMPLATES.filter(item => !isBaselineTemplate(item));
  if (window.__PB_LOCAL_SERVER__ || document.body?.dataset?.pbMode === 'local') {
    try {
      const response = await fetch('./api/user-templates', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({version:'0.1.62', project:'Prompt Builder', templates:users}) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (error) { console.warn('[Prompt Builder] Could not save local user templates:', error); return false; }
  }
  try { localStorage.setItem('pb-user-templates-v4', JSON.stringify({version:'0.1.62', project:'Prompt Builder', templates:users})); return true; }
  catch(error){ console.warn('[Prompt Builder] Could not save user templates:', error); return false; }
}

function showAiOverlay(message) {
  const overlay = $('aiLoadingOverlay');
  if (!overlay) return;
  overlay.dataset.mode = 'working';
  $('aiLoadingMessage').textContent = message;
  overlay.hidden = false;
  document.body.classList.add('ai-busy');
}
function hideAiOverlay(force = false) {
  const overlay = $('aiLoadingOverlay');
  if (!overlay) return;
  if (!force && overlay.dataset.mode === 'error') return;
  overlay.hidden = true;
  overlay.dataset.mode = '';
  document.body.classList.remove('ai-busy');
}
function showAiErrorOverlay(message) {
  const overlay = $('aiLoadingOverlay');
  if (!overlay) { alert(message); return; }
  overlay.dataset.mode = 'error';
  $('aiLoadingMessage').textContent = message;
  overlay.hidden = false;
  document.body.classList.add('ai-busy');
}


async function loadConfig() {
  let loaded = null;
  try {
    const raw = localStorage.getItem('pb-builder-config-v1');
    if (raw) loaded = JSON.parse(raw);
  } catch (error) {
    console.warn('[Prompt Builder] Could not read local Builder configuration:', error);
  }
  if (!loaded?.fields) {
    try {
      const res = await fetch('./config.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Config HTTP ${res.status}`);
      loaded = await res.json();
    } catch (error) {
      loaded = window.__PROMPT_BUILDER_CONFIG__ || null;
      if (!loaded) throw error;
    }
  }
  if (!loaded || !Array.isArray(loaded.fields)) throw new Error('Invalid Builder configuration: fields must be an array.');
  CONFIG = loaded;
  refreshBuilderTaxonomy();
  mergeCustomDimensions();
  renderFields();
  setDefaults();

  try {
    const providersRes = await fetch('./config_providers.json', { cache: 'no-store' });
    if (!providersRes.ok) throw new Error(`Provider config HTTP ${providersRes.status}`);
    const providerConfig = await providersRes.json();
    PROVIDER_ORDER = Array.isArray(providerConfig.providers) ? providerConfig.providers : [];
    PROVIDERS = Object.fromEntries(PROVIDER_ORDER.map(p => [p.id, p]));
    SAVED_CREDENTIALS = loadStoredCredentialsState();
    initProviderSettings(providerConfig.default_provider || PROVIDER_ORDER[0]?.id);
  } catch (error) {
    console.error('[Prompt Builder] Provider setup unavailable; Builder remains usable.', error);
  }
  requestAnimationFrame(() => {
    if (!hasAllConfigureFields()) { renderFields(); setDefaults(); }
  });
}

function getCustomDimensions() {
  try {
    const raw = localStorage.getItem('pb-custom-dimensions-v1');
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.filter(item => item && item.value && Number(item.width) > 0 && Number(item.height) > 0) : [];
  } catch (error) {
    console.warn('[Prompt Builder] Could not read custom dimensions:', error);
    return [];
  }
}

function saveCustomDimensions(items) {
  try {
    localStorage.setItem('pb-custom-dimensions-v1', JSON.stringify(items));
  } catch (error) {
    console.warn('[Prompt Builder] Could not save custom dimensions:', error);
  }
}

function mergeCustomDimensions() {
  const field = CONFIG?.fields?.find(item => item.id === 'dimensions');
  if (!field || !Array.isArray(field.options)) return;
  const base = field.options.filter(item => item.value !== '__ADD_DIMENSION__');
  const known = new Set(base.map(item => String(item.value)));
  getCustomDimensions().forEach(item => {
    if (!known.has(String(item.value))) {
      base.push({ value: item.value, label: item.label || item.value, width: Number(item.width), height: Number(item.height), custom: true });
    }
  });
  field.options = base;
}

function createDimensionOption() {
  const field = CONFIG?.fields?.find(item => item.id === 'dimensions');
  if (!field) return;
  const select = $('field-dimensions');
  if (!select) return;
  const current = select.value;
  const raw = window.prompt('Enter dimensions (for example: 1200 x 628):', '1200 x 628');
  if (!raw) { select.value = current; return; }
  const match = String(raw).trim().match(/^(\d{2,5})\s*[xX×]\s*(\d{2,5})$/);
  if (!match) {
    alert('Please enter dimensions in the format WIDTH x HEIGHT.');
    select.value = current;
    return;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  const orientation = width === height ? 'Square' : (width > height ? 'Landscape' : 'Portrait');
  const value = `${width} x ${height} (${orientation})`;
  if (field.options.some(item => item.value === value)) {
    select.value = value;
    saveBuilderState();
    return;
  }
  const item = { value, label: value, width, height, custom: true };
  field.options.push(item);
  const custom = getCustomDimensions().filter(existing => existing.value !== value);
  custom.push(item);
  saveCustomDimensions(custom);
  persistConfigToDisk();
  const option = document.createElement('option');
  option.value = value;
  option.textContent = value;
  select.insertBefore(option, select.querySelector('option[value="__ADD_DIMENSION__"]') || null);
  select.value = value;
  saveBuilderState();
}

function renderFields() {
  const root = $('dynamicFields');
  if (!root || !CONFIG?.fields) return;
  root.innerHTML = '';
  root.removeAttribute('hidden');
  root.style.display = '';
  CONFIG.fields.forEach(field => {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.hidden = false;
    wrap.style.display = '';
    const label = document.createElement('label'); label.textContent = field.label;
    wrap.appendChild(label);
    if (field.type === 'palette') {
      const row = document.createElement('div'); row.className = 'palette-control';
      const swatches = document.createElement('div'); swatches.className = 'swatches'; swatches.id = `${field.id}-swatches`;
      const colors = Array.isArray(field.defaultColors) ? field.defaultColors : [];
      const slots = Number(field.slots || 6);
      for (let i = 0; i < slots; i += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'palette-swatch';
        button.dataset.index = String(i);
        button.setAttribute('aria-label', `Color ${i + 1}`);
        const color = colors[i] || '';
        if (color) button.dataset.color = color;
        button.addEventListener('click', (event) => {
          if (event.target.closest('.palette-swatch-remove')) return;
          openPaletteColorPicker(i);
        });
        const remove = document.createElement('span');
        remove.className = 'palette-swatch-remove';
        remove.textContent = '×';
        remove.setAttribute('role','button');
        remove.setAttribute('tabindex','0');
        remove.setAttribute('aria-label', `Remove color ${i + 1}`);
        remove.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); clearPaletteColor(i); });
        remove.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); clearPaletteColor(i); } });
        button.appendChild(remove);
        swatches.appendChild(button);
      }
      row.appendChild(swatches); wrap.appendChild(row);
      renderPalette();
    } else {
      wrap.appendChild(buildSelect(field));
    }
    root.appendChild(wrap);
  });
  root.dataset.renderedFields = String(CONFIG.fields.length);
}

function hasAllConfigureFields() {
  if (!Array.isArray(CONFIG?.fields) || !CONFIG.fields.length) return false;
  const root = $('dynamicFields');
  if (!root) return false;
  return CONFIG.fields.every(field => {
    if (field.type === 'palette') return !!root.querySelector(`#${field.id}-swatches`);
    const el = $(`field-${field.id}`);
    return !!el && !el.hidden && !!el.closest('.field');
  });
}

function buildSelect(field) {
  const select = document.createElement('select');
  select.id = `field-${field.id}`;
  field.options.forEach(o => {
    const option = document.createElement('option');
    option.value = o.value;
    option.textContent = o.label;
    select.appendChild(option);
  });
  if (field.id === 'dimensions') {
    const add = document.createElement('option');
    add.value = '__ADD_DIMENSION__';
    add.textContent = field.addOptionLabel || '+ Add new dimension…';
    select.appendChild(add);
  }
  select.addEventListener('change', () => {
    if (field.id === 'dimensions' && select.value === '__ADD_DIMENSION__') {
      createDimensionOption();
      return;
    }
    saveBuilderState();
    if (field.id === 'aiTool') updateOpenToolButton();
  });
  return select;
}

function ensureConfigureFields() {
  const root = $('dynamicFields');
  if (!root || !Array.isArray(CONFIG?.fields)) return;
  if (!hasAllConfigureFields()) {
    renderFields();
    setDefaults();
  }
}

function setDefaults() {
  Object.entries(CONFIG.defaults || {}).forEach(([key, value]) => { const el = $(`field-${key}`); if (el) el.value = value; });
  renderPalette();
}

function getPaletteColors() {
  return Array.from(document.querySelectorAll('#palette-swatches .palette-swatch'))
    .map(el => el.dataset.color || '')
    .filter(Boolean);
}

function clearPaletteColor(index) {
  const swatches = $('palette-swatches');
  if (!swatches) return;
  const swatch = swatches.querySelector(`.palette-swatch[data-index="${index}"]`);
  if (!swatch) return;
  delete swatch.dataset.color;
  renderPalette();
  saveBuilderState();
}

function renderPalette() {
  const field = CONFIG?.fields?.find(f => f.id === 'palette');
  const root = $('palette-swatches');
  if (!field || !root) return;
  const current = Array.from(root.querySelectorAll('.palette-swatch')).map((el, i) => el.dataset.color || (field.defaultColors?.[i] || ''));
  root.querySelectorAll('.palette-swatch').forEach((el, i) => {
    const color = current[i] || '';
    if (color) {
      el.dataset.color = color;
      el.style.background = color;
      el.classList.add('filled');
      el.title = color;
      const remove = el.querySelector('.palette-swatch-remove');
      if (remove) remove.hidden = false;
    } else {
      delete el.dataset.color;
      el.style.background = '';
      el.classList.remove('filled');
      el.title = 'Choose color';
      const remove = el.querySelector('.palette-swatch-remove');
      if (remove) remove.hidden = true;
    }
  });
}

function normalizeHexValue(value) {
  if (typeof value !== 'string') return null;
  let hex = value.trim().toUpperCase();
  if (!hex.startsWith('#')) hex = `#${hex}`;
  if (/^#[0-9A-F]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return /^#[0-9A-F]{6}$/.test(hex) ? hex : null;
}

function hexToHsv(hex) {
  const normalized = normalizeHexValue(hex) || '#000000';
  const r = parseInt(normalized.slice(1,3), 16) / 255;
  const g = parseInt(normalized.slice(3,5), 16) / 255;
  const b = parseInt(normalized.slice(5,7), 16) / 255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g-b)/d) % 6);
    else if (max === g) h = 60 * (((b-r)/d) + 2);
    else h = 60 * (((r-g)/d) + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToHex(h, s, v) {
  h = ((Number(h) % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, Number(s) || 0));
  v = Math.max(0, Math.min(1, Number(v) || 0));
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r=0,g=0,b=0;
  if (h < 60) [r,g,b] = [c,x,0];
  else if (h < 120) [r,g,b] = [x,c,0];
  else if (h < 180) [r,g,b] = [0,c,x];
  else if (h < 240) [r,g,b] = [0,x,c];
  else if (h < 300) [r,g,b] = [x,0,c];
  else [r,g,b] = [c,0,x];
  const toHex = n => Math.round((n+m)*255).toString(16).padStart(2,'0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function openPaletteColorPicker(index) {
  const swatches = $('palette-swatches');
  if (!swatches) return;
  const swatch = swatches.querySelector(`.palette-swatch[data-index="${index}"]`);
  if (!swatch) return;
  const existing = $('paletteColorDialog');
  if (existing) existing.remove();

  const current = normalizeHexValue(swatch.dataset.color || '#000000') || '#000000';
  const hsv = hexToHsv(current);
  const recent = Array.from(new Set(getPaletteColors().map(c => String(c).toUpperCase()))).slice(0, 10);
  const overlay = document.createElement('div');
  overlay.id = 'paletteColorDialog';
  overlay.className = 'color-dialog-overlay';
  overlay.innerHTML = `
    <div class="modern-color-dialog palette-picker-v2" role="dialog" aria-modal="true" aria-label="Choose color">
      <div class="modern-color-header">
        <div><div class="modern-color-title">Choose color</div><div class="modern-color-subtitle">Click or drag to choose a color</div></div>
        <button type="button" class="color-dialog-close" id="paletteCloseBtn" aria-label="Close">×</button>
      </div>
      <div class="picker-main">
        <div class="vertical-hue-wrap"><div id="paletteHueTrack" class="vertical-hue-track"></div><div id="paletteHueKnob" class="vertical-hue-knob"></div></div>
        <div class="color-surface-wrap picker-surface-wrap"><div id="paletteColorSurface" class="color-surface" style="--picker-h:${hsv.h}deg"></div><div id="paletteColorKnob" class="color-knob"></div></div>
      </div>
      <div class="color-value-row">
        <div class="color-preview-large" id="paletteColorPreview"></div>
        <label class="hex-field"><span>HEX</span><input id="paletteHexInput" type="text" value="${escapeAttr(current)}" maxlength="7" autocomplete="off" spellcheck="false"></label>
      </div>
      ${recent.length ? `<div class="recent-colors"><span>Recent</span><div class="recent-grid">${recent.map(c=>`<button type="button" class="recent-swatch" data-preset="${escapeAttr(c)}" title="${escapeAttr(c)}" style="background:${escapeAttr(c)}"></button>`).join('')}</div></div>` : ''}
    </div>`;
  document.body.appendChild(overlay);

  const surface = $('paletteColorSurface');
  const surfaceKnob = $('paletteColorKnob');
  const hueTrack = $('paletteHueTrack');
  const hueKnob = $('paletteHueKnob');
  const hexInput = $('paletteHexInput');
  const preview = $('paletteColorPreview');
  const state = {h:hsv.h,s:hsv.s,v:hsv.v};

  function applyColor(hex) {
    const normalized = normalizeHexValue(hex);
    if (!normalized) return;
    swatch.dataset.color = normalized;
    renderPalette();
    saveBuilderState();
  }
  function updateUi(apply=false) {
    const hex = hsvToHex(state.h,state.s,state.v);
    const hueHex = hsvToHex(state.h, 1, 1);
    // Keep the S/B surface driven by the exact same hue value as the Hue track.
    surface.style.setProperty('--picker-color', hueHex);
    surface.style.background = `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, ${hueHex})`; 
    surfaceKnob.style.left = `${state.s*100}%`;
    surfaceKnob.style.top = `${(1-state.v)*100}%`;
    hueKnob.style.top = `${state.h/360*100}%`;
    hexInput.value = hex;
    preview.style.background = hex;
    if (apply) applyColor(hex);
  }
  function setFromHex(value, apply=true) {
    const normalized = normalizeHexValue(value);
    if (!normalized) return false;
    const next = hexToHsv(normalized);
    state.h=next.h; state.s=next.s; state.v=next.v;
    updateUi(apply);
    return true;
  }
  function setFromSurface(ev) {
    const rect=surface.getBoundingClientRect();
    state.s=Math.min(1,Math.max(0,(ev.clientX-rect.left)/rect.width));
    state.v=Math.min(1,Math.max(0,1-(ev.clientY-rect.top)/rect.height));
    updateUi(true);
  }
  function setFromHue(ev) {
    const rect=hueTrack.getBoundingClientRect();
    const ratio=Math.min(1,Math.max(0,(ev.clientY-rect.top)/rect.height));
    state.h=ratio>=0.999 ? 360 : ratio*360;
    updateUi(true);
  }
  function pointerDrag(target, fn) {
    const move=e=>fn(e);
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);};
    target.addEventListener('pointerdown',e=>{e.preventDefault();fn(e);window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);});
  }
  pointerDrag(surface,setFromSurface);
  pointerDrag(hueTrack,setFromHue);
  hexInput.addEventListener('input',()=>{ setFromHex(hexInput.value, true); });
  overlay.querySelectorAll('.recent-swatch').forEach(btn=>btn.addEventListener('click',()=>setFromHex(btn.dataset.preset, true)));
  const close=()=>overlay.remove();
  $('paletteCloseBtn').addEventListener('click',close);
  overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
  function onEscape(e){if(e.key==='Escape'){close();document.removeEventListener('keydown',onEscape);}};
  document.addEventListener('keydown',onEscape);
  updateUi(false);
}

function getConfigValues() {
  ensureConfigureFields();
  if (!Array.isArray(CONFIG?.fields)) throw new Error('Builder configuration is not loaded yet.');
  const out = {};
  CONFIG.fields.forEach(f => {
    if (f.type === 'palette') {
      out[f.id] = getPaletteColors();
      return;
    }
    const el = $(`field-${f.id}`);
    if (!el) throw new Error(`Builder field '${f.id}' is not available.`);
    out[f.id] = el.value;
  });
  return out;
}

function buildLocalPrompt(values) {
  const desc = $('referenceDescription').value.trim();
  const paletteColors = Array.isArray(values.palette) ? values.palette : [];
  const dims = CONFIG.fields.find(f=>f.id==='dimensions').options.find(o=>o.value===values.dimensions && o.value !== '__ADD_DIMENSION__');
  return [
    `Create a premium ${values.style.toLowerCase()} promotional ${values.category.toLowerCase()} banner for ${values.theme}.`,
    `Use a ${values.composition.toLowerCase()} composition at ${dims?.width || 1920}x${dims?.height || 700}.`,
    `Build the visual around one dominant focal point with cinematic lighting, depth, restrained supporting elements and generous negative space for copy.`,
    paletteColors.length ? `Use only these selected colors as the color palette: ${paletteColors.join(', ')}.` : '',
    desc ? `Reference direction: ${desc}` : `Reference direction: use the uploaded references as style and composition guidance without copying them.`,
    `Keep the result premium, balanced, readable, scalable and production-ready. Avoid visual clutter, flat lighting, multiple focal points, busy backgrounds and cheap-looking text effects.`
  ].join('\n');
}

function deriveRecommendation(values) {
  const meta = CONFIG?.promptTemplateMetadata?.[values.aiTool] || {};
  const effectiveness = meta.effectiveness_label || 'Not evaluated';
  const validation = meta.validation_status || 'Not evaluated';
  const starMap = {
    'Very effective': '★★★★★',
    'Effective': '★★★★☆',
    'Moderately effective': '★★★☆☆',
    'Limited / needs improvement': '★★☆☆☆'
  };
  $('ratingStars').textContent = starMap[effectiveness] || '☆☆☆☆☆';
  $('ratingStars').title = effectiveness;
  $('ratingScore').textContent = meta.prompt_type || '';
  $('validationBadge').textContent = validation;
  $('validationBadge').className = `badge ${validation === 'Validated' ? 'green' : 'gray'}`;
  $('bestFor').textContent = meta.best_for || 'No source-backed recommendation available.';
  const chips = [values.aiTool, meta.prompt_type, meta.graphic_type].filter(Boolean);
  $('recommendations').innerHTML = chips.map(x=>`<span class="chip">${escapeHtml(x)}</span>`).join('');
  $('limitations').textContent = meta.limitations || 'No source-backed limitation recorded.';
}

function generateMockAnalysis() {
  const values = getConfigValues();
  const visualNotes = refs.length
    ? 'Mock mode is enabled. Add/connect a Vision model to analyze the references with AI.'
    : 'No references were supplied.';
  $('referenceDescription').value = visualNotes;
  $('statusBadge').textContent = refs.length ? 'Mock' : '';
  currentResult = { values, referenceDescription: visualNotes };
  $('finalPrompt').value = buildLocalPrompt(values);
  deriveRecommendation(values);
}

function getSettings() {
  const providerId = $('provider').value;
  return {
    provider: providerId,
    baseUrl: $('baseUrl').value.trim(),
    apiKey: $('apiKey').value.trim() || getStoredProviderApiKey(providerId),
    model: $('model').value,
    mockMode: $('mockMode').checked
  };
}

async function loadImageFromDataUrl(dataUrl) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read reference image for palette extraction.'));
    img.src = dataUrl;
  });
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function extractPaletteFromReferences() {
  if (!refs.length) return [];
  const combined = new Map();
  const bucketSize = 16;
  const maxSamplesPerImage = 12000;

  for (const ref of refs) {
    const img = await loadImageFromDataUrl(ref.dataUrl);
    const maxSide = 180;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const imageCounts = new Map();
    const step = Math.max(1, Math.floor((pixels.length / 4) / maxSamplesPerImage));

    for (let i = 0; i < pixels.length; i += 4 * step) {
      const a = pixels[i + 3];
      if (a < 220) continue;
      const r = Math.min(255, Math.floor(pixels[i] / bucketSize) * bucketSize + bucketSize / 2);
      const g = Math.min(255, Math.floor(pixels[i + 1] / bucketSize) * bucketSize + bucketSize / 2);
      const b = Math.min(255, Math.floor(pixels[i + 2] / bucketSize) * bucketSize + bucketSize / 2);
      const key = `${r},${g},${b}`;
      imageCounts.set(key, (imageCounts.get(key) || 0) + 1);
    }

    const imageTotal = Array.from(imageCounts.values()).reduce((a, b) => a + b, 0) || 1;
    for (const [key, count] of imageCounts) {
      combined.set(key, (combined.get(key) || 0) + count / imageTotal);
    }
  }

  const candidates = Array.from(combined.entries())
    .map(([key, score]) => ({ key, score, rgb: key.split(',').map(Number) }))
    .sort((a, b) => b.score - a.score);

  const selected = [];
  const minDistance = 28;
  for (const item of candidates) {
    if (selected.length >= 10) break;
    const [r, g, b] = item.rgb;
    const distinct = selected.every(existing => {
      const dr = r - existing[0], dg = g - existing[1], db = b - existing[2];
      return Math.sqrt(dr * dr + dg * dg + db * db) >= minDistance;
    });
    if (distinct) selected.push([r, g, b]);
  }
  return selected.map(([r, g, b]) => rgbToHex(r, g, b));
}

function setReferencePalette(colors) {
  const swatches = $('palette-swatches');
  if (!swatches) return;
  swatches.querySelectorAll('.palette-swatch').forEach((el, index) => {
    const color = colors[index] || '';
    if (color) el.dataset.color = color;
    else delete el.dataset.color;
  });
  renderPalette();
}


async function callOpenAICompatibleBrowser(settings, messages) {
  const prepared = messages.map(message => {
    if (!Array.isArray(message.content)) return message;
    return {...message, content: message.content.map(part => part.type === 'image_url' ? {...part, image_url:{...part.image_url, ...(settings.provider==='openai'?{detail:'high'}:{})}} : part)};
  });
  const data = await fetchProviderJson(`${settings.baseUrl.replace(/\/$/,'')}/chat/completions`, {method:'POST',headers:{'Content-Type':'application/json',...buildProviderFetchOptions(PROVIDERS[settings.provider],settings.apiKey).headers},body:JSON.stringify({model:settings.model,messages:prepared,temperature:0.4})});
  return data?.choices?.[0]?.message?.content || '';
}
async function callGoogleBrowser(settings, messages) {
  const contents = messages.map(message => ({role:message.role==='assistant'?'model':'user',parts:Array.isArray(message.content)?message.content.map(p=>{
    if(p.type==='text') return {text:p.text};
    const m=String(p.image_url.url).match(/^data:(image\/[\\w.+-]+);base64,(.+)$/);
    return m ? {inlineData:{mimeType:m[1],data:m[2]}} : {text:String(p.image_url.url)};
  }):[{text:message.content}]}));
  const root=settings.baseUrl.replace(/\/$/,'');
  const data=await fetchProviderJson(`${root}/models/${encodeURIComponent(settings.model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents,generationConfig:{temperature:0.4}})});
  return data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
}
async function callOllamaBrowser(settings, messages) {
  const normalized=messages.map(message=>{if(!Array.isArray(message.content))return message;const textParts=message.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');const images=message.content.filter(p=>p.type==='image_url').map(p=>String(p.image_url.url).replace(/^data:image\/[^;]+;base64,/,'')).filter(Boolean);return {role:message.role,content:textParts,...(images.length?{images}:{})};});
  const root=settings.baseUrl.replace(/\/$/,'');
  const data=await fetchProviderJson(`${root}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:settings.model,messages:normalized,stream:false})});
  return data?.message?.content||'';
}
async function callVisionBrowser(settings,messages){
  if(settings.provider==='google') return callGoogleBrowser(settings,messages);
  if(settings.provider==='ollama') return callOllamaBrowser(settings,messages);
  return callOpenAICompatibleBrowser(settings,messages);
}
function parseAiJson(raw){const cleaned=String(raw||'').replace(/^```json\s*|\s*```$/g,'').trim();try{return JSON.parse(cleaned);}catch{return {description:cleaned,palette:[]};}}

async function analyzeReferences() {
  if (!refs.length) {
    $('referenceDescription').value = 'No references were supplied.';
    $('statusBadge').textContent = 'Draft';
    return '';
  }
  const settings = getSettings();
  if (!settings.model) {
    if (settings.mockMode) {
      generateMockAnalysis();
      return $('referenceDescription').value;
    }
    throw new Error('Connect the provider and choose a Vision model first.');
  }
  // Mock mode never overrides a real Vision model. If a model is selected, send the images to AI.
  const images = refs.map(r => r.dataUrl);
  const instruction = 'Analyze only the attached reference image(s), using visible image content as the sole source of truth. Return ONLY characteristics supported by the references. If multiple images are attached, describe ONLY characteristics they have in common and ignore one-off details. Identify the common visual style, recurring subject/object types, composition and placement, framing, lighting, materials, textures, perspective, atmosphere and depth. Also extract a representative color palette of no more than 8 HEX colors. For multiple references, include only colors or very close color families that are genuinely common across the reference set; for one reference, return its dominant representative colors. Do not use or infer any Builder settings. Do not invent unsupported details. Do not generate a final image prompt.';
  console.log('[Prompt Builder] Reference analysis instruction sent to AI:\n' + instruction);
  console.log('[Prompt Builder] Reference images sent: ' + images.length);
  console.log('[Prompt Builder] Reference analysis request:', {settings:{provider:settings.provider,baseUrl:settings.baseUrl,model:settings.model}, instruction, imageCount:images.length});
  const raw = await callVisionBrowser(settings,[{role:'system',content:'You are Prompt Builder\'s visual reference analyst. Analyze ONLY the attached image(s). Builder configuration is not provided and must not be used. Return valid JSON with exactly two fields: description (string) and palette (array of 1 to 8 uppercase HEX colors).',},{role:'user',content:[{type:'text',text:instruction},...images.map(url=>({type:'image_url',image_url:{url}}))]}]);
  const data = parseAiJson(raw);
  $('referenceDescription').value = data.description || '';
  const aiPalette = Array.isArray(data.palette) ? data.palette.slice(0, 8) : [];
  setReferencePalette(aiPalette);
  console.log('[Prompt Builder] Palette returned by AI:', aiPalette);
  $('statusBadge').textContent = 'Analyzed';
  currentResult = { referenceDescription: data.description || '', palette: getPaletteColors() };
  return data.description || '';
}

function agentMatchesToolLocal(agent, aiTool){ const a=String(agent||'').toLowerCase(); const t=String(aiTool||'').toLowerCase(); if(!a||!t)return false; if(t.includes('chatgpt'))return a.includes('chatgpt')||a.includes('codex'); if(t.includes('figma'))return a.includes('figma'); if(t.includes('magnific'))return a.includes('magnific'); return a.includes(t); }

async function generateFinalWithAI(referenceDescription) {
  const settings = getSettings();
  if (!settings.model) throw new Error('Connect the provider and choose a Vision model first.');
  const values = getConfigValues();
  const aiTool = String(values?.aiTool || '').trim();
  const storedTemplates = PROMPT_TEMPLATES || [];
  const match = storedTemplates.find(t => agentMatchesToolLocal(t.agent, aiTool)) || storedTemplates.find(t => String(t.agent||'').trim()===aiTool);
  const template = String(match?.prompt_template || '').trim();
  if (!template) throw new Error(`No prompt template configured for AI Tool: ${aiTool || 'Unknown'}`);
  const configLines = Object.entries(values || {}).map(([key,value]) => `${key}: ${Array.isArray(value)?value.filter(Boolean).join(', '): (value ?? '')}`).join('\n');
  const system = `You are Prompt Builder's final image-prompt generator. Use the selected AI Tool template as the required output structure. Fill and adapt it using the supplied Builder configuration and Description of references. Preserve the template structure. Configure values are explicit user requirements and have priority over reference guidance. Apply the validated Prompt Builder principles: clear objective, strong visual hierarchy, one dominant focal point when compatible, concrete subject placement, controlled lighting/material/texture direction, useful negative constraints, restrained supporting elements, clear negative space, avoid clutter/overlap/duplication, and never copy unique artwork, exact text, logos, or unrelated details from references. Return only the completed prompt in English.`;
  const user = `AI TOOL: ${aiTool}\n\nPROMPT TEMPLATE\n${template}\n\nBUILDER CONFIGURATION\n${configLines || 'No configuration values provided.'}\n\nDESCRIPTION OF REFERENCES\n${referenceDescription || 'No reference description provided.'}\n\nComplete the template now. Output only the final ready-to-use image-generation prompt.`;
  console.log('[Prompt Builder] Final prompt generation request:', {provider:settings.provider,baseUrl:settings.baseUrl,model:settings.model,aiTool,template,systemPrompt:system,userPrompt:user});
  const raw = await callVisionBrowser(settings,[{role:'system',content:system},{role:'user',content:user}]);
  const data = {prompt:String(raw||'').trim(), debug:{aiTool,template,systemPrompt:system,userPrompt:user}, metadata:match||null};
  if (data.debug) {
    console.log('[Prompt Builder] Final prompt request sent to AI:', data.debug);
  }
  $('finalPrompt').value = data.prompt || '';
  $('statusBadge').textContent = 'Generated';
  currentResult = { values, referenceDescription, prompt: data.prompt || '' };
  deriveRecommendation(values);
}

async function generatePrompt() {
  const values = getConfigValues();
  try {
    const settings = getSettings();
    if (!settings.model) {
      if (settings.mockMode) {
        $('finalPrompt').value = buildLocalPrompt(values);
        $('statusBadge').textContent = 'Generated';
        currentResult = { values, prompt: $('finalPrompt').value, referenceDescription: $('referenceDescription').value };
        deriveRecommendation(values);
        return;
      }
      throw new Error('Connect the provider and choose a Vision model first.');
    }
    let referenceDescription = $('referenceDescription').value.trim();
    if (!referenceDescription && refs.length) {
      showAiOverlay('Analyzing reference images with AI…');
      try { referenceDescription = await analyzeReferences(); } finally { showAiOverlay('Generating final image prompt with AI…'); }
    }
    await generateFinalWithAI(referenceDescription);
  } catch (e) { showConnectionError(`AI generation failed: ${e.message}`); }
}
function renderProviderOptions() {
  $('provider').innerHTML = PROVIDER_ORDER.map(p => `<option value="${escapeAttr(p.id)}">${escapeHtml(p.label)}</option>`).join('');
}

function applyProviderTemplate({resetModel=true, preserveBaseUrl=false} = {}) {
  const provider = PROVIDERS[$('provider').value];
  if (!provider) return;
  const requiresKey = !!provider.api_key?.required;
  if (!preserveBaseUrl || !$('baseUrl').value.trim()) $('baseUrl').value = provider.base_url || '';
  $('apiKey').placeholder = provider.api_key?.placeholder || 'API key';
  const hasSavedKey = !!SAVED_CREDENTIALS[$('provider').value]?.has_saved_key;
  $('apiKey').value = '';
  $('apiKey').dataset.verified = 'false';
  $('apiKey').dataset.saved = hasSavedKey ? 'true' : 'false';
  $('apiKey').placeholder = hasSavedKey ? 'Saved securely · enter a new key to replace' : (provider.api_key?.placeholder || 'API key');
  $('apiKey').disabled = !requiresKey;
  $('apiKeyField').classList.toggle('disabled-field', !requiresKey);
  updateMockModeState();
  $('modelHint').textContent = requiresKey
    ? 'Only models detected as Vision-capable will appear after a successful connection.'
    : 'Only installed Vision-capable local models will appear after a successful connection.';
  $('providerHelp').textContent = provider.help || '';
  $('providerDetails').textContent = provider.details || '';
  renderApiKeyHelp();
  if (resetModel) resetModelSelect();
}


function renderApiKeyHelp({forceVisible=false} = {}) {
  const provider = PROVIDERS[$('provider').value];
  const box = $('apiKeyHelp');
  if (!box || !provider) return;
  const requiresKey = !!provider.api_key?.required;
  const key = $('apiKey').value.trim();
  const verified = $('apiKey').dataset.verified === 'true';

  if (!requiresKey || (verified && !forceVisible)) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  const setup = provider.api_key?.setup;
  if (!setup) {
    box.hidden = false;
    box.innerHTML = '<strong>API key required.</strong><span>Open your provider dashboard, create an API key, paste it above, and test the connection.</span>';
    return;
  }

  const items = (setup.steps || []).map(step => {
    if (typeof step === 'string') return `<li>${escapeHtml(step)}</li>`;
    const text = String(step?.text || '');
    const link = step?.link;
    if (!link?.url || !link?.text) return `<li>${escapeHtml(text)}</li>`;
    const safeText = escapeHtml(text);
    const safeLabel = escapeHtml(link.text);
    const anchor = `<a href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
    const escapedLabel = escapeHtml(link.text);
    return `<li>${safeText.includes(escapedLabel) ? safeText.replace(escapedLabel, anchor) : `${anchor} ${safeText}`}</li>`;
  }).join('');
  box.hidden = false;
  box.innerHTML = `<div class="api-key-help-title">${escapeHtml(setup.title || 'How to get an API key')}</div><ol>${items}</ol>`;
}

function updateMockModeState() {
  const provider = PROVIDERS[$('provider').value];
  const hasSavedKey = !!SAVED_CREDENTIALS[$('provider').value]?.has_saved_key;
  const hasTypedKey = !!$('apiKey').value.trim();
  const hasModel = !!$('model').value;
  const shouldDisable = !!(hasModel || (provider?.api_key?.required && (hasSavedKey || hasTypedKey)));
  const mock = $('mockMode');
  mock.disabled = shouldDisable;
  mock.closest('.setting-row')?.classList.toggle('disabled-field', shouldDisable);
  if (shouldDisable) mock.checked = false;
}

function resetModelSelect() {
  providerModels = [];
  $('model').innerHTML = '<option value="">Connect provider to load Vision models</option>';
  $('model').disabled = true;
  $('model').value = '';
}

function initProviderSettings(defaultProviderId) {
  renderProviderOptions();
  const saved = JSON.parse(localStorage.getItem('pb-ai-settings') || '{}');
  SAVED_CREDENTIALS = loadStoredCredentialsState();
  const initialProvider = saved.provider && PROVIDERS[saved.provider]
    ? saved.provider
    : (PROVIDERS[defaultProviderId] ? defaultProviderId : PROVIDER_ORDER[0]?.id);
  $('provider').value = initialProvider || '';
  $('baseUrl').value = '';
  $('model').dataset.previous = saved.models?.[$('provider').value] || (saved.model && PROVIDERS[$('provider').value]?.id === saved.provider ? saved.model : '');
  applyProviderTemplate({resetModel:false});
  if (saved.baseUrl && PROVIDERS[$('provider').value]?.id === saved.provider) $('baseUrl').value = saved.baseUrl;

  $('provider').addEventListener('change', async () => {
    const latest = JSON.parse(localStorage.getItem('pb-ai-settings') || '{}');
    $('model').dataset.previous = latest.models?.[$('provider').value] || '';
    applyProviderTemplate({resetModel:true, preserveBaseUrl:false});
    $('connectionStatus').textContent = 'Checking connection...';
    persistSettings();
    const provider = PROVIDERS[$('provider').value];
    if (provider && !provider.api_key?.required) {
      await loadProviderModels({showError:true});
    } else if (SAVED_CREDENTIALS[$('provider').value]?.has_saved_key) {
      await loadProviderModels({showError:true});
    } else {
      $('connectionStatus').textContent = 'API key required';
    }
  });
  $('baseUrl').addEventListener('input', () => $('connectionStatus').textContent = 'Not tested');
  $('apiKey').addEventListener('input', () => { $('apiKey').dataset.verified = 'false'; $('connectionStatus').textContent = 'Not tested'; renderApiKeyHelp(); updateMockModeState(); });
  $('mockMode').addEventListener('change', () => {
    const active = $('mockMode').checked;
    $('connectionStatus').textContent = active ? 'Mock mode enabled' : 'Not tested';
    // Mock mode affects AI analysis/generation only. Provider connectivity and model discovery stay available.
  });
  $('testConnectionBtn').addEventListener('click', () => loadProviderModels({showError:true}));
  $('clearConnectionBtn').addEventListener('click', clearConnection);
$('model').addEventListener('change', () => {
  if ($('model').value) {
    $('model').dataset.previous = $('model').value;
    persistSettings();
  }
  updateMockModeState();
});

  updateMockModeState();
  const initial = PROVIDERS[$('provider').value];
  if (initial && !initial.api_key?.required) {
    loadProviderModels({showError:true});
  } else if (initial && SAVED_CREDENTIALS[$('provider').value]?.has_saved_key) {
    loadProviderModels({showError:true});
  } else if (initial) {
    $('connectionStatus').textContent = 'API key required';
    renderApiKeyHelp({forceVisible:true});
  }
}

function persistSettings() {
  const current = JSON.parse(localStorage.getItem('pb-ai-settings') || '{}');
  const models = current.models || {};
  if ($('model').value) models[$('provider').value] = $('model').value;
  localStorage.setItem('pb-ai-settings', JSON.stringify({ provider: $('provider').value, baseUrl: $('baseUrl').value.trim(), model: $('model').value, models }));
}

function loadStoredCredentialsState() {
  try {
    const raw = localStorage.getItem('pb-provider-credentials-v1');
    const data = raw ? JSON.parse(raw) : {};
    return Object.fromEntries(Object.entries(data).map(([id, value]) => [id, {has_saved_key: !!value?.apiKey, required: !!PROVIDERS[id]?.api_key?.required}]));
  } catch { return {}; }
}
function getStoredProviderApiKey(providerId) {
  try {
    const data = JSON.parse(localStorage.getItem('pb-provider-credentials-v1') || '{}');
    return String(data?.[providerId]?.apiKey || '');
  } catch { return ''; }
}
function saveStoredProviderApiKey(providerId, apiKey) {
  const data = JSON.parse(localStorage.getItem('pb-provider-credentials-v1') || '{}');
  data[providerId] = {apiKey};
  localStorage.setItem('pb-provider-credentials-v1', JSON.stringify(data));
  SAVED_CREDENTIALS[providerId] = {has_saved_key: !!apiKey, required: !!PROVIDERS[providerId]?.api_key?.required};
}
function saveProviderCredential(apiKey) {
  const provider = PROVIDERS[$('provider').value];
  if (!provider?.api_key?.required) return;
  const value = String(apiKey || '').trim();
  if (!value) return;
  saveStoredProviderApiKey(provider.id, value);
  $('apiKey').dataset.saved = 'true';
  $('apiKey').value = '';
  $('apiKey').placeholder = 'Saved locally · enter a new key to replace';
  updateMockModeState();
}

function buildProviderFetchOptions(provider, apiKey) {
  return apiKey ? {headers:{Authorization:`Bearer ${apiKey}`}} : {};
}
async function fetchProviderJson(url, options = {}) {
  let response;
  try { response = await fetch(url, options); }
  catch (error) { throw new Error(`Network/CORS error: ${error.message}. The provider must allow browser requests from this site.`); }
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = {raw:text}; }
  if (!response.ok) {
    const message = data?.error?.message || data?.error || data?.message || text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}
function modelIsVision(model, provider) {
  const cfg = provider?.models || {};
  const id = String(model.id || model.name || '').toLowerCase();
  const text = `${id} ${JSON.stringify(model).toLowerCase()}`;
  if ((cfg.exclude_patterns || []).some(p => text.includes(String(p).toLowerCase()))) return false;
  if (cfg.vision_detection === 'input_modalities') {
    const modalities = model?.architecture?.input_modalities || model?.input_modalities || model?.modalities?.input || [];
    return Array.isArray(modalities) && modalities.some(x => String(x).toLowerCase() === 'image');
  }
  if (cfg.vision_detection === 'capabilities_object') return model?.capabilities?.vision === true;
  if (cfg.vision_detection === 'capabilities') return model.vision === true || (Array.isArray(model.capabilities) && model.capabilities.includes('vision'));
  const patterns = cfg.vision_patterns || [];
  return patterns.length ? patterns.some(p => id.includes(String(p).toLowerCase())) : false;
}
async function loadVisionModelsDirect(provider, apiKey, baseUrl) {
  const root = String(baseUrl || provider.base_url || '').replace(/\/$/, '');
  if (provider.id === 'ollama') {
    const tags = await fetchProviderJson(`${root}/api/tags`);
    const models = [];
    for (const m of (tags.models || [])) {
      try {
        const detail = await fetchProviderJson(`${root}/api/show`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:m.name || m.model})});
        if ((detail.capabilities || []).includes('vision')) models.push({id:m.name || m.model,name:m.name || m.model,vision:true});
      } catch {}
    }
    return models;
  }
  if (provider.id === 'google') {
    const data = await fetchProviderJson(`${root}/models?key=${encodeURIComponent(apiKey)}`);
    return (data.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && modelIsVision(m, provider)).map(m => ({id:String(m.name).replace(/^models\//,''),name:m.displayName || m.name,vision:true}));
  }
  const data = await fetchProviderJson(`${root}/models`, buildProviderFetchOptions(provider, apiKey));
  return (data.data || []).filter(m => modelIsVision(m, provider)).map(m => ({id:m.id,name:m.id,vision:true}));
}
async function loadProviderModels({showError=false} = {}) {
  const provider = PROVIDERS[$('provider').value];
  if (!provider) return;
  const typedApiKey = $('apiKey').value.trim();
  const apiKey = typedApiKey || getStoredProviderApiKey(provider.id);
  if (provider.api_key?.required && !apiKey) {
    $('connectionStatus').textContent = 'API key required';
    renderApiKeyHelp({forceVisible:true});
    if (showError) showConnectionError(`${provider.label}: API key is required.`);
    return;
  }
  try {
    $('testConnectionBtn').disabled = true;
    $('connectionStatus').textContent = 'Connecting and loading Vision models...';
    providerModels = await loadVisionModelsDirect(provider, apiKey, $('baseUrl').value.trim());
    if (!providerModels.length) {
      resetModelSelect();
      $('connectionStatus').textContent = `Connected · ${provider.label} · no Vision models found`;
      if (showError) showConnectionError(`${provider.label}: connected, but no Vision-capable models were found.`);
      return;
    }
    $('model').innerHTML = '<option value="">Select a Vision model</option>' + providerModels.map(m => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.name || m.id)}</option>`).join('');
    const previous = $('model').dataset.previous || '';
    const preferred = providerModels.find(m => m.id === previous) || providerModels[0];
    $('model').disabled = false;
    $('model').value = preferred.id;
    $('model').dataset.previous = preferred.id;
    if (typedApiKey) saveProviderCredential(typedApiKey);
    persistSettings();
    $('apiKey').dataset.verified = provider.api_key?.required ? 'true' : 'false';
    renderApiKeyHelp();
    updateMockModeState();
    $('connectionStatus').textContent = `Connected · ${provider.label} · ${providerModels.length} Vision model${providerModels.length === 1 ? '' : 's'}`;
  } catch (e) {
    $('apiKey').dataset.verified = 'false';
    resetModelSelect();
    renderApiKeyHelp({forceVisible:true});
    $('connectionStatus').textContent = 'Connection failed';
    if (showError) showConnectionError(`${provider.label}: ${e.message}`);
  } finally { $('testConnectionBtn').disabled = false; }
}

function clearConnection() {
  const provider = PROVIDERS[$('provider').value];
  $('apiKey').value = '';
  $('apiKey').dataset.verified = 'false';
  $('apiKey').dataset.saved = 'false';
  $('model').value = '';
  resetModelSelect();
  renderApiKeyHelp({forceVisible:true});
  if (provider?.api_key?.required) {
    const data = JSON.parse(localStorage.getItem('pb-provider-credentials-v1') || '{}');
    delete data[provider.id];
    localStorage.setItem('pb-provider-credentials-v1', JSON.stringify(data));
    SAVED_CREDENTIALS[provider.id] = {has_saved_key:false, required:true};
  }
  persistSettings();
  updateMockModeState();
  $('connectionStatus').textContent = 'Not connected';
}

function showConnectionError(message) {
  showAiErrorOverlay(message);
}

function handleFiles(files) {
  Array.from(files).forEach(file => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => { refs.push({name:file.name, dataUrl:reader.result}); renderRefs(); };
    reader.readAsDataURL(file);
  });
}
function removeRef(index) {
  if (index < 0 || index >= refs.length) return;
  refs.splice(index, 1);
  renderRefs();
}
function renderRefs() {
  $('thumbs').innerHTML = refs.map((r,i)=>`<div class="thumb-wrap"><img class="thumb" src="${r.dataUrl}" title="${escapeAttr(r.name)}" data-i="${i}"><button type="button" class="remove-ref-btn" data-remove-ref="${i}" title="Remove reference" aria-label="Remove ${escapeAttr(r.name)}">×</button></div>`).join('');
  document.querySelectorAll('[data-remove-ref]').forEach(btn => btn.addEventListener('click', () => removeRef(Number(btn.dataset.removeRef))));
  $('statusBadge').textContent = refs.length ? `${refs.length} ref${refs.length>1?'s':''}` : '';
}
function escapeHtml(s){return String(s ?? '').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\\':'&#92;'}[m]))}
function escapeAttr(s){return escapeHtml(s).replace(/'/g,'&#39;')}
function copyText(text){navigator.clipboard.writeText(text)}
function showTab(id){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===id));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active-view',v.id===id));
  if (id === 'builder') requestAnimationFrame(ensureConfigureFields);
  if (id === 'templates') renderTemplates();
}
function loadPresets() {
  try {
    const raw = localStorage.getItem('pb-presets-v1');
    const data = raw ? JSON.parse(raw) : [];
    SAVED_PRESETS = Array.isArray(data) ? data : (Array.isArray(data.presets) ? data.presets : []);
  } catch (error) {
    console.warn('[Prompt Builder] Presets unavailable:', error);
    SAVED_PRESETS = [];
  }
  renderPresetOptions();
}
function savePresetsToStorage() {
  localStorage.setItem('pb-presets-v1', JSON.stringify(SAVED_PRESETS));
}
function renderPresetOptions() {
  const menu = $('presetMenu');
  if (!menu) return;
  menu.innerHTML = SAVED_PRESETS.length
    ? SAVED_PRESETS.map(p => `<button type="button" class="preset-menu-item" data-preset-name="${escapeAttr(p.name)}"><span>${escapeHtml(p.name)}</span><small>${escapeHtml(new Date(p.updatedAt || p.createdAt || Date.now()).toLocaleDateString())}</small></button>`).join('')
    : '<div class="preset-menu-empty">No saved presets</div>';
  menu.querySelectorAll('.preset-menu-item').forEach(btn => btn.addEventListener('click', () => {
    const name = btn.dataset.presetName || '';
    loadPresetByName(name);
    setPresetInput(name);
    menu.hidden = true;
  }));
}
function setPresetInput(value='') { const el=$('presetName'); if(el) el.value=value; }
function togglePresetMenu() {
  const menu = $('presetMenu');
  if (!menu) return;
  renderPresetOptions();
  menu.hidden = !menu.hidden;
}
function loadPresetByName(name) {
  const preset = SAVED_PRESETS.find(p => p.name === name);
  if (!preset) return;
  if (preset.values && typeof preset.values === 'object') applyPresetValues(preset.values);
  $('referenceDescription').value = preset.referenceDescription || '';
  if (preset.prompt != null) $('finalPrompt').value = preset.prompt;
  $('statusBadge').textContent = 'Preset loaded';
  saveBuilderState();
}
function applyPresetValues(values) {
  ensureConfigureFields();
  for (const field of (CONFIG?.fields || [])) {
    if (field.type === 'palette') { setReferencePalette(Array.isArray(values[field.id]) ? values[field.id] : []); continue; }
    const el = $(`field-${field.id}`);
    if (el && values[field.id] != null) el.value = values[field.id];
  }
  deriveRecommendation(values);
}

function savePreset() {
  const name = $('presetName').value.trim();
  if (!name) { alert('Enter a preset name first.'); $('presetName').focus(); return; }
  const now = new Date().toISOString();
  const payload = { name, values: getConfigValues(), referenceDescription: $('referenceDescription').value.trim(), prompt: $('finalPrompt').value, updatedAt: now };
  const existingIndex = SAVED_PRESETS.findIndex(p => p.name === name);
  if (existingIndex >= 0) SAVED_PRESETS[existingIndex] = { ...SAVED_PRESETS[existingIndex], ...payload };
  else {
    SAVED_PRESETS.push({ ...payload, createdAt: now });
    if (SAVED_PRESETS.length > 20) SAVED_PRESETS = SAVED_PRESETS.slice(-20);
  }
  savePresetsToStorage();
  renderPresetOptions();
  $('presetName').value = name;
  $('statusBadge').textContent = 'Preset saved';
  saveBuilderState();
}
function deletePreset() {
  const name = $('presetName').value.trim();
  if (!name) return;
  SAVED_PRESETS = SAVED_PRESETS.filter(p => p.name !== name);
  savePresetsToStorage();
  renderPresetOptions();
  $('presetName').value='';
}

const aiOverlay = $('aiLoadingOverlay');
if (aiOverlay) aiOverlay.addEventListener('click', () => { if (aiOverlay.dataset.mode === 'error') hideAiOverlay(true); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && aiOverlay?.dataset.mode === 'error') hideAiOverlay(true); });

$('dropzone').addEventListener('click',()=>$('fileInput').click());
$('fileInput').addEventListener('change',e=>handleFiles(e.target.files));
$('dropzone').addEventListener('dragover',e=>{e.preventDefault();$('dropzone').style.background='#faf7ff'});
$('dropzone').addEventListener('dragleave',()=>{$('dropzone').style.background=''});
$('dropzone').addEventListener('drop',e=>{e.preventDefault();$('dropzone').style.background='';handleFiles(e.dataTransfer.files)});
$('analyzeBtn').onclick=async()=>{
  showAiOverlay('Analyzing reference images with AI…');
  try { await analyzeReferences(); } catch(e) { showConnectionError(`Analysis failed: ${e.message}`); } finally { hideAiOverlay(); }
};
$('generateBtn').onclick=async()=>{
  showAiOverlay('Generating final image prompt with AI…');
  try { await generatePrompt(); } finally { hideAiOverlay(); }
};
$('copyPromptBtn').onclick=()=>copyText($('finalPrompt').value);
$('copyPromptIcon').onclick=()=>copyText($('finalPrompt').value);
$('copyTemplateBtn')?.addEventListener('click',()=>copyText($('editorPromptTemplate')?.value || ''));
$('copyTemplateIcon')?.addEventListener('click',()=>copyText($('editorPromptTemplate')?.value || ''));
$('copyJsonBtn').onclick=()=>copyText(JSON.stringify({configuration:getConfigValues(), referenceDescription:$('referenceDescription').value, prompt:$('finalPrompt').value},null,2));
$('copyRefBtn').onclick=()=>copyText($('referenceDescription').value);
$('saveBtn').onclick=async()=>{try{await savePreset();}catch(e){alert(`Could not save preset: ${e.message}`)}};
$('presetMenuToggle').onclick=togglePresetMenu;
$('presetName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadPresetByName($('presetName').value.trim()); $('presetMenu').hidden = true; } });
$('presetName').addEventListener('focus', () => { if (SAVED_PRESETS.length) renderPresetOptions(); });
$('presetDeleteBtn').onclick=async()=>{try{await deletePreset();}catch(e){alert(`Could not delete preset: ${e.message}`)}};
document.addEventListener('click', e => { const wrap=$('presetPicker'); if (wrap && !wrap.contains(e.target)) { const menu=$('presetMenu'); if(menu) menu.hidden=true; } });
const TOOL_LINKS = {
  'Magnific': { label: 'Magnific' },
  'ChatGPT / Codex': { label: 'ChatGPT' },
  'Figma AI': { label: 'Figma' }
};
function updateOpenToolButton() {
  const aiTool = $('field-aiTool')?.value || 'Magnific';
  const launchUrls = CONFIG?.aiToolLaunchUrls || {};
  const target = { label: TOOL_LINKS[aiTool]?.label || aiTool, url: launchUrls[aiTool] || 'about:blank' };
  if ($('toolName')) $('toolName').textContent = target.label;
  $('openToolBtn').dataset.url = target.url;
}
$('openToolBtn').onclick=async()=>{
  const prompt = $('finalPrompt').value.trim();
  if (prompt) { try { await navigator.clipboard.writeText(prompt); } catch {} }
  const url = $('openToolBtn').dataset.url || TOOL_LINKS.Magnific.url;
  window.open(url,'_blank');
};
$('templateAddBtn')?.addEventListener('click', addTemplate);
$('templateSaveBtn')?.addEventListener('click', async()=>{try{await saveTemplateFile();}catch(e){alert(`Could not save templates: ${e.message}`)}});
$('templateDuplicateBtn')?.addEventListener('click', duplicateTemplate);
$('templateDeleteBtn')?.addEventListener('click', deleteTemplate);
$('editorPromptTemplate')?.addEventListener('input', ()=>{writeTemplateEditorToModel();syncPromptHighlight();});
$('editorPromptTemplate')?.addEventListener('scroll', syncPromptHighlight);
['editorTemplateName','editorTemplateSection','editorTemplateCategory','editorTemplateAgent','editorContext','editorEvaluation'].forEach(id=>$(id)?.addEventListener('input', ()=>{writeTemplateEditorToModel();}));
$('editorTemplateRating')?.addEventListener('change', ()=>{writeTemplateEditorToModel();updateEditorRatingStars($('editorTemplateRating').value);});
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>showTab(t.dataset.tab));
document.querySelector('.configure .section-head')?.addEventListener('click', () => {
  // Configure is intentionally non-collapsible. Verify the fields remain mounted.
  requestAnimationFrame(ensureConfigureFields);
});
$('apiKey').addEventListener('input', () => { $('apiKey').dataset.verified = 'false'; renderApiKeyHelp(); });
$('model').addEventListener('change', () => {
  if ($('model').value) {
    $('model').dataset.previous = $('model').value;
    persistSettings();
  }
  updateMockModeState();
});

const BUILDER_STATE_KEY = 'pb-builder-state-v1';
let __restoringBuilderState = false;
function saveBuilderState() {
  if (__restoringBuilderState || !CONFIG?.fields || !hasAllConfigureFields()) return;
  try { localStorage.setItem(BUILDER_STATE_KEY, JSON.stringify({ values:getConfigValues(), referenceDescription:$('referenceDescription')?.value||'', finalPrompt:$('finalPrompt')?.value||'', presetName:$('presetName')?.value||'' })); }
  catch (error) { console.warn('[Prompt Builder] Could not save Builder state.', error); }
}
function restoreBuilderState() {
  try { const raw=localStorage.getItem(BUILDER_STATE_KEY); if(!raw) return; const state=JSON.parse(raw); __restoringBuilderState=true; if(state.values) applyPresetValues(state.values); if($('referenceDescription')) $('referenceDescription').value=state.referenceDescription||''; if($('finalPrompt')) $('finalPrompt').value=state.finalPrompt||''; if($('presetName')) $('presetName').value=state.presetName||''; }
  catch(error){ console.warn('[Prompt Builder] Could not restore Builder state.',error); }
  finally { __restoringBuilderState=false; }
}
function clearPromptBuilderLocalStorage() {
  if (document.body?.dataset?.pbMode !== 'github') return;
  const ok = window.confirm('Clear Prompt Builder localStorage? This removes saved Builder state, presets, user templates, provider credentials, and AI settings stored in this browser. Base JSON files will not be changed.');
  if (!ok) return;
  const keys = [
    BUILDER_STATE_KEY,
    'pb-presets-v1',
    'pb-user-templates-v4',
    'pb-user-templates-v3',
    'pb-prompt-templates-v2',
    'pb-prompt-templates-v1',
    'pb-builder-config-v1',
    'pb-custom-dimensions-v1',
    'pb-ai-settings',
    'pb-provider-credentials-v1'
  ];
  keys.forEach(key => localStorage.removeItem(key));
  window.location.reload();
}

function bindBuilderStatePersistence(){ ['referenceDescription','finalPrompt','presetName'].forEach(id=>$(id)?.addEventListener('input',saveBuilderState)); window.addEventListener('beforeunload',saveBuilderState); }
loadPresets();
bindBuilderStatePersistence();
$('clearLocalStorageBtn')?.addEventListener('click', clearPromptBuilderLocalStorage);

(async()=>{
  try {
    await loadTemplates();
    await loadConfig();
    refreshBuilderTaxonomy();
    restoreBuilderState();
    updateOpenToolButton();
  } catch (error) {
    console.error('[Prompt Builder] Startup failed:', error);
    const root = $('dynamicFields');
    if (root) root.innerHTML = `<div class="muted">Could not load Builder configuration: ${escapeHtml(error.message)}</div>`;
  }
})();
