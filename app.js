let CONFIG = null;
let refs = [];
let currentResult = null;
let providerModels = [];
let aiActionBusy = false;

const $ = (id) => document.getElementById(id);

let PROVIDERS = {};
let PROVIDER_ORDER = [];
let SAVED_CREDENTIALS = {};
let SAVED_PRESETS = [];
let PROMPT_TEMPLATES = [];

const TEMPLATE_RATING = { Excellent: 5, Good: 4, Average: 3, 'Needs Improvement': 2 };
let selectedTemplateIndex = -1;
let BASELINE_TEMPLATE_MAX_ID = 0;
let APP_VERSION_LABEL = '';
const TEMPLATE_ADD_NEW = '__ADD_NEW__';

function templateStars(value) {
  const score = TEMPLATE_RATING[String(value)] || 0;
  return '★'.repeat(score) + '☆'.repeat(Math.max(0, 5 - score));
}
function templateKeyValue(item, key) { return String(item?.[key] || '').trim(); }
function uniqueTemplateValues(key) {
  return [...new Set(PROMPT_TEMPLATES.map(item => templateKeyValue(item, key)).filter(Boolean))];
}
function isUserTemplate(item) { return item?._source === 'user'; }
function templateDisplayName(item, index) {
  return item?.name || `${templateKeyValue(item, 'category') || 'Template'} ${index + 1}`;
}
function fillTemplateFilter(id, key, preserve = '') {
  const select = $(id);
  if (!select) return;
  const allLabels = { section: 'All sections', category: 'All categories', agent: 'All AI tools' };
  const values = ['All', ...uniqueTemplateValues(key)];
  select.innerHTML = values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value === 'All' ? allLabels[key] : value)}</option>`).join('');
  select.value = values.includes(preserve) ? preserve : 'All';
}
function refreshTemplateFilters() {
  fillTemplateFilter('templateSection', 'section', $('templateSection')?.value || 'All');
  fillTemplateFilter('templateCategory', 'category', $('templateCategory')?.value || 'All');
  fillTemplateFilter('templateAgent', 'agent', $('templateAgent')?.value || 'All');
}
function filteredTemplateIndexes() {
  const filters = { section: $('templateSection')?.value || 'All', category: $('templateCategory')?.value || 'All', agent: $('templateAgent')?.value || 'All' };
  return PROMPT_TEMPLATES.map((item, i) => ({ item, i })).filter(({ item }) =>
    Object.entries(filters).every(([key, value]) => value === 'All' || templateKeyValue(item, key) === value));
}
function fillTemplateMetaSelect(id, key, current = '') {
  const select = $(id);
  if (!select) return;
  const values = uniqueTemplateValues(key);
  if (current && !values.includes(current)) values.push(current);
  select.innerHTML = values.map(value => `<option value="${escapeAttr(value)}">${escapeHtml(value)}</option>`).join('')
    + `<option value="${TEMPLATE_ADD_NEW}">+ Add new value…</option>`;
  select.value = current && values.includes(current) ? current : (values[0] || '');
}
function installMetaSelect(id, key) {
  const select = $(id);
  if (!select || select.dataset.bound === '1') return;
  select.dataset.bound = '1';
  select.addEventListener('change', () => {
    if (select.value !== TEMPLATE_ADD_NEW) { writeTemplateEditorToModel(); return; }
    const label = key === 'agent' ? 'AI Tool' : key === 'section' ? 'Section' : 'Category';
    const value = (window.prompt(`Enter new ${label}:`) || '').trim();
    const item = PROMPT_TEMPLATES[selectedTemplateIndex];
    if (!value || !item || !isUserTemplate(item)) { populateTemplateEditor(selectedTemplateIndex); return; }
    fillTemplateMetaSelect(id, key, value);
    writeTemplateEditorToModel();
    refreshTemplateFilters();
  });
}
function renderTemplateEditorList() {
  const list = $('templateEditorList');
  if (!list) return;
  const visible = filteredTemplateIndexes();
  if ($('templatesCount')) $('templatesCount').textContent = `${visible.length} template${visible.length === 1 ? '' : 's'}`;
  list.innerHTML = visible.length
    ? visible.map(({ item, i }) => `<button type="button" class="template-editor-item ${i === selectedTemplateIndex ? 'active' : ''}" data-template-index="${i}"><strong>${escapeHtml(templateDisplayName(item, i))}${isUserTemplate(item) ? '<em class="template-badge">Yours</em>' : ''}</strong><small>${escapeHtml(templateKeyValue(item, 'section'))} · ${escapeHtml(templateKeyValue(item, 'category'))}</small><span>${escapeHtml(templateKeyValue(item, 'agent'))}</span></button>`).join('')
    : '<div class="template-empty">No templates match.</div>';
  list.querySelectorAll('.template-editor-item').forEach(btn => btn.addEventListener('click', () => selectTemplate(Number(btn.dataset.templateIndex))));
}
function highlightPromptText(text) {
  let html = escapeHtml(text || '');
  html = html.replace(/(^|\n)(#{1,6}[^\n]*)/g, '$1<span class="syn-heading">$2</span>');
  html = html.replace(/(^|\n)(\s*[-*+]\s+[^\n]*)/g, '$1<span class="syn-list">$2</span>');
  html = html.replace(/(\{\{[^{}]+\}\}|\{[^{}\n]+\})/g, '<span class="syn-var">$1</span>');
  html = html.replace(/(https?:\/\/[^\s]+)/g, '<span class="syn-link">$1</span>');
  return html + '\n';
}
function syncPromptHighlight() {
  const area = $('editorPromptTemplate');
  const layer = $('editorPromptHighlight');
  if (!area || !layer) return;
  layer.innerHTML = area.value ? highlightPromptText(area.value) : '<span class="syn-placeholder">Start writing your prompt template…</span>';
  layer.scrollTop = area.scrollTop;
  layer.scrollLeft = area.scrollLeft;
}
function setTemplateEditorReadOnly(readOnly) {
  ['editorTemplateName', 'editorPromptTemplate', 'editorContext', 'editorEvaluation'].forEach(id => { const el = $(id); if (el) el.readOnly = !!readOnly; });
  ['editorTemplateSection', 'editorTemplateCategory', 'editorTemplateAgent', 'editorTemplateRating'].forEach(id => { const el = $(id); if (el) el.disabled = !!readOnly; });
  if ($('templateSaveBtn')) $('templateSaveBtn').disabled = !!readOnly;
  $('templateEditorForm')?.classList.toggle('is-readonly', !!readOnly);
}
function updateTemplateDeleteState() {
  const btn = $('templateDeleteBtn');
  if (!btn) return;
  const canDelete = isUserTemplate(PROMPT_TEMPLATES[selectedTemplateIndex]);
  btn.disabled = !canDelete;
  btn.title = canDelete ? 'Delete this template' : 'Built-in templates cannot be deleted';
}
function updateEditorRatingStars(value) {
  const root = $('editorTemplateRatingStars');
  if (!root) return;
  root.textContent = templateStars(value);
  root.title = value || '';
}
function updateEditorHeader(item, index) {
  $('editorTemplateTitle').textContent = templateDisplayName(item, index);
  $('editorTemplateMeta').textContent = `${isUserTemplate(item) ? 'User template' : 'Built-in (read-only)'} · ${templateKeyValue(item, 'section')} · ${templateKeyValue(item, 'category')} · ${templateKeyValue(item, 'agent')}`;
}
function populateTemplateEditor(index) {
  const item = PROMPT_TEMPLATES[index];
  if (!item) return;
  $('templateEditorEmpty').hidden = true;
  $('templateEditorForm').hidden = false;
  updateEditorHeader(item, index);
  $('editorTemplateName').value = item.name || templateDisplayName(item, index);
  fillTemplateMetaSelect('editorTemplateSection', 'section', templateKeyValue(item, 'section'));
  fillTemplateMetaSelect('editorTemplateCategory', 'category', templateKeyValue(item, 'category'));
  fillTemplateMetaSelect('editorTemplateAgent', 'agent', templateKeyValue(item, 'agent'));
  installMetaSelect('editorTemplateSection', 'section');
  installMetaSelect('editorTemplateCategory', 'category');
  installMetaSelect('editorTemplateAgent', 'agent');
  $('editorTemplateRating').value = item.effectiveness_rating || 'Average';
  updateEditorRatingStars($('editorTemplateRating').value);
  $('editorPromptTemplate').value = item.prompt_template || '';
  $('editorContext').value = item.context || '';
  $('editorEvaluation').value = item.evaluation || '';
  syncPromptHighlight();
  setTemplateEditorReadOnly(!isUserTemplate(item));
  updateTemplateDeleteState();
  renderTemplateEditorList();
}
let persistTemplateTimer = null;
function writeTemplateEditorToModel() {
  const item = PROMPT_TEMPLATES[selectedTemplateIndex];
  if (!item || !isUserTemplate(item)) return;
  item.name = $('editorTemplateName').value.trim();
  item.section = $('editorTemplateSection').value.trim();
  item.category = $('editorTemplateCategory').value.trim();
  item.agent = $('editorTemplateAgent').value.trim();
  item.effectiveness_rating = $('editorTemplateRating').value;
  item.prompt_template = $('editorPromptTemplate').value;
  item.context = $('editorContext').value;
  item.evaluation = $('editorEvaluation').value;
  item.updatedAt = new Date().toISOString();
  renderTemplateEditorList();
  updateEditorHeader(item, selectedTemplateIndex);
}
function setEditorStatus(text, ok) {
  const el = $('editorSaveStatus');
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? '#047857' : '#b91c1c';
  if (ok) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 1800);
}
function validateUserTemplate(item, index = -1) {
  const errors = [];
  const name = String(item?.name || '').trim();
  if (!name) errors.push('Name is required.');
  if (!templateKeyValue(item, 'section')) errors.push('Section is required.');
  if (!templateKeyValue(item, 'category')) errors.push('Category is required.');
  if (!templateKeyValue(item, 'agent')) errors.push('AI Tool is required.');
  if (!String(item?.prompt_template || '').trim()) errors.push('Prompt template cannot be empty.');
  const id = Number(item?.id);
  if (!Number.isFinite(id) || id <= BASELINE_TEMPLATE_MAX_ID) errors.push('User template must have a valid unique ID.');
  if (PROMPT_TEMPLATES.some((other, i) => i !== index && Number(other?.id) === id)) errors.push(`Template ID ${id} is already used.`);
  if (PROMPT_TEMPLATES.some((other, i) => i !== index && String(other?.name || '').trim().toLowerCase() === name.toLowerCase())) errors.push(`Template name "${name}" already exists.`);
  return errors;
}
function orderedUserTemplate(item) {
  return {
    id: Number(item?.id) || 0,
    name: String(item?.name || ''),
    section: String(item?.section || ''),
    category: String(item?.category || ''),
    agent: String(item?.agent || ''),
    prompt_template: String(item?.prompt_template || ''),
    context: String(item?.context || ''),
    effectiveness_rating: String(item?.effectiveness_rating || ''),
    evaluation: String(item?.evaluation || ''),
    createdAt: item?.createdAt || null,
    updatedAt: item?.updatedAt || null
  };
}
async function persistUserTemplates() {
  const templates = PROMPT_TEMPLATES.filter(isUserTemplate).map(orderedUserTemplate);
  try {
    const response = await fetch('./api/user-templates', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templates }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } catch (error) {
    console.warn('[Prompt Builder] Could not save user templates:', error);
    return false;
  }
}
async function saveTemplateFile() {
  const item = PROMPT_TEMPLATES[selectedTemplateIndex];
  if (!item || !isUserTemplate(item)) return;
  writeTemplateEditorToModel();
  const errors = validateUserTemplate(item, selectedTemplateIndex);
  if (errors.length) { setEditorStatus(errors.join(' '), false); return; }
  if (!await persistUserTemplates()) { setEditorStatus('Could not save the template.', false); return; }
  refreshTemplateFilters();
  populateTemplateEditor(selectedTemplateIndex);
  setEditorStatus('Template saved', true);
}
function selectTemplate(index) { selectedTemplateIndex = index; populateTemplateEditor(index); }
function nextTemplateName(section, agent) {
  const prefix = [section, agent].filter(Boolean).join('-') || 'Template';
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
  const max = PROMPT_TEMPLATES.reduce((m, item) => { const match = String(item.name || '').trim().match(re); return match ? Math.max(m, Number(match[1]) || 0) : m; }, 0);
  return `${prefix}-${max + 1}`;
}
function nextUserTemplateId() {
  return Math.max(BASELINE_TEMPLATE_MAX_ID, ...PROMPT_TEMPLATES.map(item => Number(item.id) || 0)) + 1;
}
async function addTemplate() {
  const pick = id => { const v = $(id)?.value || 'All'; return v === 'All' ? '' : v; };
  const section = pick('templateSection');
  const category = pick('templateCategory');
  const agent = pick('templateAgent');
  const now = new Date().toISOString();
  PROMPT_TEMPLATES.push({
    id: nextUserTemplateId(), _source: 'user', name: nextTemplateName(section, agent), section, category, agent,
    prompt_template: 'Create a new production-ready image prompt.\n\nUse the supplied reference description and Configure requirements.',
    context: '', effectiveness_rating: 'Average', evaluation: '', createdAt: now, updatedAt: now
  });
  selectedTemplateIndex = PROMPT_TEMPLATES.length - 1;
  await persistUserTemplates();
  populateTemplateEditor(selectedTemplateIndex);
}
async function addBuilderResultTemplate() {
  const button = $('addToTemplatesBtn');
  if (!button || button.disabled) return;

  const prompt = $('finalPrompt')?.value.trim() || '';
  if (!prompt) { $('statusBadge').textContent = 'Generate a prompt before adding it to Templates.'; return; }

  const previousIndex = selectedTemplateIndex;
  let createdIndex = -1;
  let persisted = false;
  button.dataset.busy = 'true';
  button.textContent = 'Saving template…';
  updateBuilderActionStates();
  try {
    const values = getConfigValues();
    const matchedTemplate = findSelectedTemplateForValues(values);
    const category = String(values.category || templateKeyValue(matchedTemplate, 'category') || '').trim();
    const agent = String(values.aiTool || templateKeyValue(matchedTemplate, 'agent') || '').trim();
    const section = String(values.section || templateKeyValue(matchedTemplate, 'section') || category).trim();
    if (!section || !category || !agent) throw new Error('Select a Category and AI Tool before saving this template.');

    const now = new Date().toISOString();
    const item = {
      id: nextUserTemplateId(),
      _source: 'user',
      name: nextTemplateName(section, agent),
      section,
      category,
      agent,
      prompt_template: prompt,
      context: JSON.stringify({
        builderParameters: values,
        referenceDescription: $('referenceDescription')?.value.trim() || ''
      }, null, 2),
      effectiveness_rating: 'Average',
      evaluation: '',
      createdAt: now,
      updatedAt: now
    };
    PROMPT_TEMPLATES.push(item);
    createdIndex = PROMPT_TEMPLATES.length - 1;

    if (!await persistUserTemplates()) {
      PROMPT_TEMPLATES.splice(createdIndex, 1);
      selectedTemplateIndex = previousIndex;
      createdIndex = -1;
      throw new Error('Could not save the template. Please try again.');
    }
    persisted = true;

    selectedTemplateIndex = createdIndex;
    ['templateSection', 'templateCategory', 'templateAgent'].forEach(id => {
      const filter = $(id);
      if (filter) filter.value = 'All';
    });
    refreshTemplateFilters();
    showTab('templates');
    populateTemplateEditor(createdIndex);
    setEditorStatus('Template added from Builder', true);
  } catch (error) {
    if (!persisted && createdIndex >= 0 && PROMPT_TEMPLATES[createdIndex]?._source === 'user') {
      PROMPT_TEMPLATES.splice(createdIndex, 1);
      selectedTemplateIndex = previousIndex;
    }
    $('statusBadge').textContent = error.message || 'Could not add the template.';
  } finally {
    delete button.dataset.busy;
    button.textContent = 'Add to templates';
    updateBuilderActionStates();
  }
}
async function duplicateTemplate() {

  const source = PROMPT_TEMPLATES[selectedTemplateIndex];
  if (!source) return;
  const now = new Date().toISOString();
  const copy = { ...JSON.parse(JSON.stringify(source)), id: nextUserTemplateId(), _source: 'user', createdAt: now, updatedAt: now };
  copy.name = `${templateDisplayName(source, selectedTemplateIndex)} Copy`;
  PROMPT_TEMPLATES.splice(selectedTemplateIndex + 1, 0, copy);
  selectedTemplateIndex += 1;
  await persistUserTemplates();
  refreshTemplateFilters();
  populateTemplateEditor(selectedTemplateIndex);
}
async function deleteTemplate() {
  const item = PROMPT_TEMPLATES[selectedTemplateIndex];
  if (!item || !isUserTemplate(item) || !confirm('Delete this template?')) return;
  const deletedIndex = selectedTemplateIndex;
  PROMPT_TEMPLATES.splice(deletedIndex, 1);
  await persistUserTemplates();
  refreshTemplateFilters();
  const visible = filteredTemplateIndexes();
  const prior = visible.filter(({ i }) => i < deletedIndex);
  selectedTemplateIndex = visible.length ? (prior.length ? prior[prior.length - 1].i : visible[visible.length - 1].i) : -1;
  renderTemplateEditorList();
  if (selectedTemplateIndex >= 0) populateTemplateEditor(selectedTemplateIndex);
  else { $('templateEditorForm').hidden = true; $('templateEditorEmpty').hidden = false; }
}
function renderTemplates() {
  renderTemplateEditorList();
  if (selectedTemplateIndex >= 0 && PROMPT_TEMPLATES[selectedTemplateIndex]) populateTemplateEditor(selectedTemplateIndex);
}
async function loadTemplates() {
  try {
    const response = await fetch('./prompt_templates.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const builtin = (Array.isArray(data.templates) ? data.templates : []).map(item => ({ ...item, _source: 'builtin' }));
    BASELINE_TEMPLATE_MAX_ID = builtin.reduce((m, item) => Math.max(m, Number(item.id) || 0), 0);
    let users = [];
    try {
      const res = await fetch('./api/user-templates', { cache: 'no-store' });
      if (res.ok) users = (await res.json()).templates || [];
    } catch (error) { console.warn('[Prompt Builder] User templates unavailable:', error); }
    const used = new Set(builtin.map(item => Number(item.id)));
    let nextId = Math.max(BASELINE_TEMPLATE_MAX_ID, ...users.map(item => Number(item.id) || 0));
    users = users.map(item => {
      const next = { ...item, _source: 'user' };
      if (!Number.isFinite(Number(next.id)) || next.id <= BASELINE_TEMPLATE_MAX_ID || used.has(Number(next.id))) next.id = ++nextId;
      used.add(Number(next.id));
      return next;
    });
    PROMPT_TEMPLATES = [...builtin, ...users];
    refreshTemplateFilters();
    ['templateSection', 'templateCategory', 'templateAgent'].forEach(id => {
      const el = $(id);
      if (el && el.dataset.bound !== '1') { el.dataset.bound = '1'; el.addEventListener('change', renderTemplateEditorList); }
    });
    selectedTemplateIndex = PROMPT_TEMPLATES.length ? 0 : -1;
    if (selectedTemplateIndex >= 0) populateTemplateEditor(selectedTemplateIndex); else renderTemplateEditorList();
  } catch (error) {
    console.error('[Prompt Builder] Could not load prompt templates:', error);
    if ($('templateEditorList')) $('templateEditorList').innerHTML = '<div class="template-empty">Could not load prompt templates.</div>';
  }
}

// Match Builder metadata to the source template's Section, Category, and AI Tool.
function agentMatchesTool(agent, aiTool) {
  const a = String(agent || '').toLowerCase();
  const t = String(aiTool || '').toLowerCase();
  if (!a || !t) return false;
  if (t.includes('chatgpt')) return a.includes('chatgpt') || a.includes('codex');
  if (t.includes('figma')) return a.includes('figma');
  if (t.includes('magnific')) return a.includes('magnific');
  return a.includes(t);
}
function findSelectedTemplateForValues(values) {
  const section = String(values?.section || '').trim().toLowerCase();
  const category = String(values?.category || '').trim().toLowerCase();
  const aiTool = String(values?.aiTool || '').trim();
  // User templates are listed last, so searching from the end lets them override built-in ones.
  const byTool = [...PROMPT_TEMPLATES].reverse().filter(item => agentMatchesTool(item.agent, aiTool));
  const exactSectionAndCategory = item =>
    (!section || templateKeyValue(item, 'section').toLowerCase() === section) &&
    (!category || templateKeyValue(item, 'category').toLowerCase() === category);
  if (section && category) return byTool.find(exactSectionAndCategory) || null;
  return byTool.find(item => section && templateKeyValue(item, 'section').toLowerCase() === section) ||
    byTool.find(item => category && templateKeyValue(item, 'category').toLowerCase() === category) ||
    byTool[0] || null;
}
function updateSelectedTemplateInfo(values) {
  const node = $('selectedTemplateInfo');
  if (!node) return null;
  const match = findSelectedTemplateForValues(values || {});
  node.innerHTML = match
    ? `Template: <strong>${escapeHtml(templateDisplayName(match, PROMPT_TEMPLATES.indexOf(match)))}</strong> <span class="muted">· ${escapeHtml(templateKeyValue(match, 'section'))} · ${escapeHtml(templateKeyValue(match, 'category'))} · ${escapeHtml(templateKeyValue(match, 'agent'))}</span>`
    : 'Template: —';
  return match;
}
function setAiSuggestions(style, placement) {
  const box = $('aiSuggestions');
  if (!box) return;
  const suggestion = $('aiSuggestedStyle');
  if (suggestion) suggestion.textContent = style || '—';
  box.hidden = !(style || placement);
  box.dataset.style = style || '';
  box.dataset.placement = placement || '';
}

function parseReferenceAnalysisResponse(text) {
  const source = String(text || '').trim();
  if (!source) return null;
  const unfenced = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let data;
  try {
    data = JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try { data = JSON.parse(unfenced.slice(start, end + 1)); } catch { return null; }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const suggestions = data.suggestions && typeof data.suggestions === 'object' ? data.suggestions : {};
  const result = {
    description: typeof data.description === 'string' ? data.description.trim() : '',
    palette: Array.isArray(data.palette)
      ? data.palette.map(color => String(color || '').trim().toUpperCase()).filter(color => /^#[0-9A-F]{6}$/.test(color)).slice(0, 8)
      : null,
    style: String(suggestions.style || data.style || '').trim().slice(0, 120),
    sceneElements: String(suggestions.sceneElements || data.sceneElements || '').trim(),
    placement: String(suggestions.placement || data.placement || '').trim()
  };

  const legacyComposition = String(suggestions.composition || data.composition || '').trim();
  if (!result.sceneElements && legacyComposition) {
    const legacyMatch = legacyComposition.match(/^(Character|Object)\s+(left|center|right)$/i);
    if (legacyMatch) {
      result.sceneElements = `${legacyMatch[1][0].toUpperCase()}${legacyMatch[1].slice(1).toLowerCase()} only`;
      result.placement ||= `${legacyMatch[2][0].toUpperCase()}${legacyMatch[2].slice(1).toLowerCase()}`;
    } else if (/^No character$/i.test(legacyComposition)) {
      result.sceneElements = 'Object only';
    } else {
      result.sceneElements = 'Custom';
      result.placement ||= legacyComposition;
    }
  }

  return result.description || result.palette?.length || result.sceneElements || result.placement || result.style
    ? result
    : null;
}

function applyReferenceAnalysisResult(data, statusText = 'Analyzed') {
  const description = String(data?.description || '').trim();
  if (description) {
    $('referenceDescription').value = description;
    $('referenceDescription').dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (Array.isArray(data?.palette)) setReferencePalette(data.palette);
  setAiSuggestions(String(data?.style || data?.suggestions?.style || ''), '');
  applyReferenceCompositionSuggestion(
    data?.sceneElements || data?.suggestions?.sceneElements,
    data?.placement || data?.suggestions?.placement
  );
  $('statusBadge').textContent = statusText;
  currentResult = {
    referenceDescription: description || $('referenceDescription').value.trim(),
    palette: getPaletteColors(),
    sceneElements: $('field-sceneElements')?.value || '',
    placement: $('field-placement')?.value || ''
  };
  updateBuilderActionStates();
  saveBuilderState();
}

function handleReferenceAnalysisPaste(event) {
  const pastedText = event.clipboardData?.getData('text/plain') || '';
  const result = parseReferenceAnalysisResponse(pastedText);
  if (!result) return;
  event.preventDefault();
  applyReferenceAnalysisResult(result, 'Analysis response applied');
}

function handleReferenceDescriptionInput() {
  updateBuilderActionStates();
  const result = parseReferenceAnalysisResponse($('referenceDescription')?.value || '');
  if (result) applyReferenceAnalysisResult(result, 'Analysis response applied');
}

function applyAiSuggestions() {
  const box = $('aiSuggestions');
  if (!box) return;
  const style = box.dataset.style || '';
  const placement = box.dataset.placement || '';
  const placementEl = $('field-placement');
  if (placementEl && placement) {
    const match = [...placementEl.options].find(o => o.value.toLowerCase() === placement.toLowerCase());
    if (match) { placementEl.value = match.value; placementEl.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  // Style suggestions are added to Clarification because Configure has no Style field.
  const clarification = $('field-clarification');
  if (clarification && style && !clarification.value.includes(style)) {
    clarification.value = clarification.value.trim() ? `${clarification.value.trim()}\n${style}` : style;
    clarification.dispatchEvent(new Event('input', { bubbles: true }));
  }
  syncCombos();
  saveBuilderState();
  box.hidden = true;
}

function applyReferenceCompositionSuggestion(sceneElements, placement) {
  const sceneSelect = $('field-sceneElements');
  const placementSelect = $('field-placement');
  if (!sceneSelect || !placementSelect) return;

  const sceneMatch = [...sceneSelect.options].find(option => option.value.toLowerCase() === String(sceneElements || '').trim().toLowerCase());
  if (sceneMatch && sceneSelect.value !== sceneMatch.value) {
    sceneSelect.value = sceneMatch.value;
    sceneSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const placementMatch = [...placementSelect.options].find(option => option.value.toLowerCase() === String(placement || '').trim().toLowerCase());
  if (placementMatch) {
    placementSelect.value = placementMatch.value;
    placementSelect.dispatchEvent(new Event('change', { bubbles: true }));
  }
  syncCombos();
  saveBuilderState();
}

function userDataStatus(text, ok = true) {
  const el = $('userDataStatus');
  if (!el) return;
  el.textContent = text;
  el.style.color = ok ? '#047857' : '#b91c1c';
}
function exportUserData() {
  const customValues = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('pb-custom-')) customValues[key] = localStorage.getItem(key);
  }
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem('pb-ai-settings') || '{}'); } catch {}
  let builderState = null;
  try { builderState = JSON.parse(localStorage.getItem(BUILDER_STATE_KEY) || 'null'); } catch {}
  const data = {
    format: 'prompt-builder-user-data',
    version: APP_VERSION_LABEL,
    exportedAt: new Date().toISOString(),
    userTemplates: PROMPT_TEMPLATES.filter(isUserTemplate).map(orderedUserTemplate),
    presets: SAVED_PRESETS,
    customValues,
    builderState,
    aiSettings: { provider: settings.provider || '', baseUrl: settings.baseUrl || '', model: settings.model || '', models: settings.models || {} }
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'prompt-builder-user-data.json';
  a.click();
  URL.revokeObjectURL(url);
  userDataStatus(`Exported ${data.userTemplates.length} templates and ${data.presets.length} presets.`);
}
async function importUserData(file) {
  const data = JSON.parse(await file.text());
  if (!data || data.format !== 'prompt-builder-user-data') throw new Error('Invalid Prompt Builder user data file.');
  const incoming = Array.isArray(data.userTemplates) ? data.userTemplates : [];
  const existingKeys = new Set(PROMPT_TEMPLATES.filter(isUserTemplate).map(item => `${item.name}|${item.prompt_template}`));
  let nextId = nextUserTemplateId() - 1;
  let added = 0;
  for (const raw of incoming) {
    if (existingKeys.has(`${raw.name}|${raw.prompt_template}`)) continue;
    PROMPT_TEMPLATES.push({ ...orderedUserTemplate(raw), id: ++nextId, _source: 'user' });
    added++;
  }
  if (added && !await persistUserTemplates()) throw new Error('Could not save imported templates.');
  if (Array.isArray(data.presets)) {
    for (const preset of data.presets.slice(-20)) {
      if (!preset?.name) continue;
      await fetch('./api/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: preset.name, values: preset.values || {}, referenceDescription: preset.referenceDescription || '', prompt: preset.prompt || '' }) });
    }
    await loadPresets();
  }
  if (data.customValues && typeof data.customValues === 'object') {
    for (const [key, value] of Object.entries(data.customValues)) if (key.startsWith('pb-custom-') && typeof value === 'string') localStorage.setItem(key, value);
  }
  if (data.builderState) localStorage.setItem(BUILDER_STATE_KEY, JSON.stringify(data.builderState));
  refreshTemplateFilters();
  renderTemplates();
  userDataStatus(`Imported ${added} templates. Reloading…`);
  setTimeout(() => location.reload(), 600);
}
async function loadAppVersion() {
  try {
    const data = await (await fetch('./api/status', { cache: 'no-store' })).json();
    APP_VERSION_LABEL = data.version || '';
    if ($('appVersion')) $('appVersion').textContent = APP_VERSION_LABEL ? `v${APP_VERSION_LABEL}` : '';
  } catch {}
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
  // Builder configuration is loaded independently from provider credentials.
  const configRes = await fetch('./config.json', { cache: 'no-store' });
  if (!configRes.ok) throw new Error(`Builder configuration HTTP ${configRes.status}`);
  CONFIG = await configRes.json();
  if (!CONFIG || !Array.isArray(CONFIG.fields)) {
    throw new Error('Invalid Builder configuration: fields must be an array.');
  }

  // Configure fields must never depend on provider settings or credentials.
  renderFields();
  setDefaults();
  $('configPreview').textContent = JSON.stringify(CONFIG, null, 2);

  try {
    const providersRes = await fetch('./config_providers.json', { cache: 'no-store' });
    if (!providersRes.ok) throw new Error(`Provider config HTTP ${providersRes.status}`);
    const providerConfig = await providersRes.json();
    PROVIDER_ORDER = Array.isArray(providerConfig.providers) ? providerConfig.providers : [];
    PROVIDERS = Object.fromEntries(PROVIDER_ORDER.map(p => [p.id, p]));

    try {
      const credsRes = await fetch('./api/provider-credentials', { cache: 'no-store' });
      if (credsRes.ok) {
        const credentialState = await credsRes.json();
        SAVED_CREDENTIALS = credentialState.providers || {};
      } else {
        SAVED_CREDENTIALS = {};
        console.warn('[Prompt Builder] Provider credential state unavailable.', credsRes.status);
      }
    } catch (error) {
      SAVED_CREDENTIALS = {};
      console.warn('[Prompt Builder] Could not load provider credential state.', error);
    }

    initProviderSettings(providerConfig.default_provider || PROVIDER_ORDER[0]?.id);
  } catch (error) {
    console.error('[Prompt Builder] Provider setup unavailable; Builder remains usable.', error);
  }

  // Final render guard. If a browser extension or a transient reload touched the DOM, restore the fields.
  requestAnimationFrame(() => {
    if (!hasAllConfigureFields()) {
      renderFields();
      setDefaults();
    }
  });
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
    } else if (field.type === 'textarea') {
      wrap.appendChild(buildTextarea(field));
    } else {
      wrap.appendChild(buildSelectControl(field));
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
  field.options.forEach(o => { const option = document.createElement('option'); option.value = o.value; option.textContent = o.label; select.appendChild(option); });
  if (isCustomAllowed(field)) loadCustomValues(field).forEach(item => appendCustomOption(select, item));
  select.addEventListener('change', () => {
    if (field.id !== 'sceneElements') saveBuilderState();
    updateCustomRemoveState(select);
    if (field.id === 'aiTool') updateOpenToolButton();
    if (field.id === 'sceneElements') { updatePlacementOptions(); saveBuilderState(); }
    if (field.id === 'section' || field.id === 'category' || field.id === 'aiTool') { try { deriveRecommendation(getConfigValues()); } catch (_) {} }
  });
  return select;
}

function updatePlacementOptions() {
  const sceneSelect = $('field-sceneElements');
  const placementSelect = $('field-placement');
  const placementField = CONFIG?.fields?.find(field => field.id === 'placement');
  if (!sceneSelect || !placementSelect || !placementField) return;

  const sceneField = CONFIG.fields.find(field => field.id === 'sceneElements');
  const sceneGroup = sceneField?.options?.some(option => option.value === sceneSelect.value)
    ? sceneSelect.value
    : 'Custom';
  const matching = placementField.options.filter(option => option.sceneElements?.includes(sceneGroup));
  const currentValue = placementSelect.value;
  const customValues = Array.from(placementSelect.options)
    .filter(option => option.dataset.custom === 'true')
    .map(option => ({ value: option.value, label: option.textContent }));

  placementSelect.replaceChildren();
  matching.forEach(option => {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    placementSelect.appendChild(node);
  });
  customValues.forEach(option => appendCustomOption(placementSelect, option));

  if (Array.from(placementSelect.options).some(option => option.value === currentValue)) {
    placementSelect.value = currentValue;
  } else {
    const defaultValue = CONFIG.defaults?.placement;
    placementSelect.value = Array.from(placementSelect.options).some(option => option.value === defaultValue)
      ? defaultValue
      : placementSelect.options[0]?.value || '';
  }
  updateCustomRemoveState(placementSelect);
  syncCombos();
}

function buildTextarea(field) {
  const area = document.createElement('textarea');
  area.id = `field-${field.id}`;
  area.className = 'field-textarea';
  area.rows = 4;
  area.placeholder = field.placeholder || '';
  area.addEventListener('input', saveBuilderState);
  if (field.allowCustom === false) return area;

  // Saved variants for the textarea: up to maxCustomFor(field), oldest dropped first.
  const key = customStorageKey(field);
  const load = () => {
    try { const list = JSON.parse(localStorage.getItem(key) || '[]'); return (Array.isArray(list) ? list : []).filter(t => typeof t === 'string' && t.trim()).slice(-maxCustomFor(field)); }
    catch { return []; }
  };
  const save = (list) => { try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { console.warn('[Prompt Builder] Could not save variants.', e); } };
  const control = document.createElement('div');
  control.className = 'select-control';
  control.innerHTML = `<div class="select-row"><select class="saved-variants" aria-label="Saved Clarification variants"></select>
    <button type="button" class="icon-btn variant-save" title="Save current text as a variant" aria-label="Save current text as a variant">♡</button>
    <button type="button" class="icon-btn variant-remove" title="Remove selected variant" aria-label="Remove selected variant" disabled>🗑</button></div>
    <span class="field-hint custom-hint" role="status"></span>`;
  const select = control.querySelector('.saved-variants');
  const hint = control.querySelector('.custom-hint');
  const removeBtn = control.querySelector('.variant-remove');
  const render = () => {
    const list = load();
    select.innerHTML = '<option value="">Saved Clarification variants…</option>';
    list.forEach((text, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = text.replace(/\s+/g, ' ').slice(0, 60) + (text.length > 60 ? '…' : '');
      o.title = text;
      select.appendChild(o);
    });
    removeBtn.disabled = true;
  };
  render();
  select.addEventListener('change', () => {
    const text = load()[Number(select.value)];
    removeBtn.disabled = select.value === '';
    if (select.value !== '' && text != null) { area.value = text; saveBuilderState(); }
  });
  control.querySelector('.variant-save').addEventListener('click', () => {
    const text = area.value.trim().slice(0, 1000);
    if (!text) { hint.textContent = 'Type a Clarification first.'; return; }
    let list = load();
    if (list.includes(text)) { hint.textContent = 'Already saved.'; select.value = String(list.indexOf(text)); removeBtn.disabled = false; return; }
    list.push(text);
    list = list.slice(-maxCustomFor(field));
    save(list);
    render();
    select.value = String(list.length - 1);
    removeBtn.disabled = false;
    hint.textContent = `Saved (max ${maxCustomFor(field)}, oldest is replaced).`;
  });
  removeBtn.addEventListener('click', () => {
    if (select.value === '') return;
    const list = load();
    list.splice(Number(select.value), 1);
    save(list);
    render();
    hint.textContent = 'Variant removed.';
  });
  const frag = document.createDocumentFragment();
  frag.append(area, control);
  return frag;
}

// Custom values: every select field accepts user-added options, persisted in localStorage per field.
function parseSize(text) {
  const m = String(text || '').match(/(\d{2,5})\s*[x×X*]\s*(\d{2,5})/);
  if (!m) return null;
  const width = Number(m[1]), height = Number(m[2]);
  if (width < 64 || height < 64 || width > 8192 || height > 8192) return null;
  const shape = width === height ? 'Square' : (width > height ? 'Landscape' : 'Portrait');
  const label = `${width} x ${height} (${shape})`;
  return { value: label, label, width, height, custom: true };
}
function isCustomAllowed(field) {
  return field.type !== 'palette' && field.type !== 'textarea' && field.allowCustom !== false;
}
function customStorageKey(field) {
  return field.customStorageKey || `pb-custom-${field.id}-v1`;
}
function normalizeCustomValue(field, text) {
  if (field.id === 'dimensions') return parseSize(text);
  const value = String(text || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return value ? { value, label: value, custom: true } : null;
}
function loadCustomValues(field) {
  try {
    const list = JSON.parse(localStorage.getItem(customStorageKey(field)) || '[]');
    return (Array.isArray(list) ? list : []).map(item => normalizeCustomValue(field, item?.value ?? item)).filter(Boolean).slice(-maxCustomFor(field));
  } catch { return []; }
}
function saveCustomValues(field, select) {
  const items = Array.from(select.options).filter(o => o.dataset.custom === 'true').map(o => ({ value: o.value }));
  try { localStorage.setItem(customStorageKey(field), JSON.stringify(items)); }
  catch (error) { console.warn('[Prompt Builder] Could not save custom values.', error); }
}
const DEFAULT_MAX_CUSTOM = 20;
// Per-field limit of saved custom values (config `maxCustom`); the oldest is dropped when exceeded.
function maxCustomFor(field) { const n = Number(field?.maxCustom); return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_CUSTOM; }
// Adds a custom option and keeps only the newest maxCustomFor(field) (oldest is dropped).
function addCustomValue(field, select, item) {
  appendCustomOption(select, item);
  const customs = Array.from(select.options).filter(o => o.dataset.custom === 'true');
  while (customs.length > maxCustomFor(field)) customs.shift().remove();
  saveCustomValues(field, select);
}
function appendCustomOption(select, item) {
  if (Array.from(select.options).some(o => o.value === item.value)) return;
  const option = document.createElement('option');
  option.value = item.value;
  option.textContent = item.label;
  option.dataset.custom = 'true';
  select.appendChild(option);
}
function updateCustomRemoveState(select) {
  const btn = select?.closest('.field')?.querySelector('.custom-remove');
  if (btn) btn.disabled = select.selectedOptions[0]?.dataset.custom !== 'true';
}
function selectedLabel(select) {
  return select.selectedOptions[0]?.textContent || '';
}
function syncCombos() {
  document.querySelectorAll('#dynamicFields .combo').forEach(combo => {
    const select = combo.querySelector('select');
    const input = combo.querySelector('.combo-input');
    if (select && input && document.activeElement !== input) input.value = selectedLabel(select);
    updateCustomRemoveState(select);
  });
}
// Searchable combobox: same look/behavior as the Preset field. The hidden <select> stays the source of truth.
function buildSelectControl(field) {
  const select = buildSelect(field);
  const allowCustom = isCustomAllowed(field);
  const isSize = field.id === 'dimensions';
  const control = document.createElement('div');
  control.className = 'select-control';
  control.innerHTML = `<div class="select-row">
      <div class="preset-picker combo">
        <div class="preset-input-wrap"><input type="text" class="combo-input" role="combobox" aria-expanded="false" aria-autocomplete="list" maxlength="${isSize ? 20 : 60}" placeholder="${escapeAttr(isSize ? 'Select or enter size, e.g. 1200 x 628' : `Select or enter ${String(field.label || field.id)}`)}" autocomplete="off" spellcheck="false" /><button type="button" class="preset-toggle combo-toggle" tabindex="-1" aria-label="Show options">▾</button></div>
        <div class="preset-menu combo-menu" role="listbox" hidden></div>
      </div>
      ${allowCustom ? `<button type="button" class="icon-btn custom-toggle" title="Save typed value to the list" aria-label="Save typed value to the list">♡</button>
      <button type="button" class="icon-btn custom-remove" title="Remove selected custom value" aria-label="Remove selected custom value" disabled>🗑</button>` : ''}
    </div>
    <span class="field-hint custom-hint" role="status"></span>`;
  const combo = control.querySelector('.combo');
  combo.querySelector('.preset-input-wrap').prepend(select);
  select.classList.add('combo-select');
  select.tabIndex = -1;
  const input = control.querySelector('.combo-input');
  const menu = control.querySelector('.combo-menu');
  const hint = control.querySelector('.custom-hint');
  let active = -1;
  let items = [];

  const isOpen = () => !menu.hidden;
  const close = () => { menu.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); };
  const restore = () => { input.value = selectedLabel(select); };
  const setActive = (i) => {
    active = i;
    Array.from(menu.children).forEach((el, idx) => el.classList.toggle('active', idx === i));
    menu.children[i]?.scrollIntoView({ block: 'nearest' });
  };
  const choose = (value) => {
    select.value = value;
    input.value = selectedLabel(select);
    close();
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const render = (filterText) => {
    const q = String(filterText || '').trim().toLowerCase();
    items = Array.from(select.options).filter(o => !q || o.textContent.toLowerCase().includes(q));
    menu.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'preset-menu-empty';
      empty.textContent = allowCustom ? 'No matches — press ♡ to save it as a new value' : 'No matches';
      menu.appendChild(empty);
    }
    items.forEach(o => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-menu-item' + (o.value === select.value ? ' selected' : '');
      btn.setAttribute('role', 'option');
      btn.dataset.value = o.value;
      btn.innerHTML = `<span>${escapeHtml(o.textContent)}</span>${o.dataset.custom === 'true' ? '<small>saved</small>' : ''}`;
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => choose(o.value));
      menu.appendChild(btn);
    });
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(items.length && q ? 0 : -1);
  };

  input.addEventListener('focus', () => { hint.textContent = ''; input.select(); render(''); });
  input.addEventListener('click', () => { if (!isOpen()) render(''); });
  input.addEventListener('input', () => { hint.textContent = ''; render(input.value); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen()) render(input.value === selectedLabel(select) ? '' : input.value);
      if (!items.length) return;
      setActive(e.key === 'ArrowDown' ? (active + 1) % items.length : (active <= 0 ? items.length - 1 : active - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const typed = input.value.trim().toLowerCase();
      const exact = Array.from(select.options).find(o => o.textContent.toLowerCase() === typed || o.value.toLowerCase() === typed);
      const pick = items[active] || exact;
      if (pick) choose(pick.value);
      else if (allowCustom && input.value.trim()) addTyped();
    } else if (e.key === 'Escape') {
      if (isOpen()) { e.stopPropagation(); close(); restore(); }
    }
  });
  input.addEventListener('blur', () => { close(); restore(); });
  combo.querySelector('.combo-toggle').addEventListener('mousedown', e => e.preventDefault());
  combo.querySelector('.combo-toggle').addEventListener('click', () => {
    if (isOpen()) { close(); return; }
    input.focus();
    render('');
  });

  function addTyped() {
    const item = normalizeCustomValue(field, input.value);
    if (!item) { hint.textContent = isSize ? 'Enter size as width x height (64–8192 px).' : 'Type a value first.'; return; }
    const existing = Array.from(select.options).find(o => o.value.toLowerCase() === item.value.toLowerCase() || o.textContent.toLowerCase() === item.label.toLowerCase());
    if (existing) {
      hint.textContent = 'Already in the list — selected.';
      choose(existing.value);
      return;
    }
    addCustomValue(field, select, item);
    hint.textContent = `Saved (max ${maxCustomFor(field)}, oldest is replaced).`;
    choose(item.value);
  }
  if (allowCustom) {
    const saveBtn = control.querySelector('.custom-toggle');
    saveBtn.addEventListener('mousedown', e => e.preventDefault());
    saveBtn.addEventListener('click', addTyped);
    control.querySelector('.custom-remove').addEventListener('click', () => {
      const option = select.selectedOptions[0];
      if (!option || option.dataset.custom !== 'true') return;
      option.remove();
      saveCustomValues(field, select);
      select.selectedIndex = 0;
      input.value = selectedLabel(select);
      hint.textContent = 'Custom value removed.';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  input.value = selectedLabel(select);
  return control;
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
  updatePlacementOptions();
  syncCombos();
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
  const dims = parseSize(values.dimensions);
  const extra = String(values.clarification || '').trim();
  return [
    `Create a premium promotional ${values.category.toLowerCase()} banner for ${values.theme}.`,
    `Scene elements: ${values.sceneElements || 'Custom'}. Placement: ${values.placement || 'Custom — specify in Clarification'}. Size: ${dims?.width || 1920}x${dims?.height || 700}.`,
    extra ? `Additional requirements: ${extra}` : '',
    `Build the visual around one dominant focal point with cinematic lighting, depth, restrained supporting elements and generous negative space.`,
    paletteColors.length ? `Use only these selected colors as the color palette: ${paletteColors.join(', ')}.` : '',
    desc ? `Reference direction: ${desc}` : `Reference direction: use the uploaded references as style and composition guidance without copying them.`,
    `Keep the result premium, balanced, scalable and production-ready. Avoid visual clutter, flat lighting, multiple focal points and busy backgrounds.`,
    `The image must contain no text, lettering, typography, logos, captions, labels, numbers, or UI/interface elements.`
  ].join('\n');
}

function deriveRecommendation(values) {
  const meta = findSelectedTemplateForValues(values || {}) || {};
  const effectiveness = meta.effectiveness_rating || 'Not evaluated';
  const validation = meta.id ? 'Validated' : 'Not evaluated';
  const starMap = { 'Excellent': '★★★★★', 'Good': '★★★★☆', 'Average': '★★★☆☆', 'Needs Improvement': '★★☆☆☆' };
  $('ratingStars').textContent = starMap[effectiveness] || '☆☆☆☆☆';
  $('ratingStars').title = effectiveness;
  $('ratingScore').textContent = meta.id ? effectiveness : '';
  $('validationBadge').textContent = validation;
  $('validationBadge').className = `badge ${validation === 'Validated' ? 'green' : 'gray'}`;
  $('bestFor').textContent = meta.context || 'No source-backed recommendation available.';
  const chips = [meta.agent, meta.section, meta.category].filter(Boolean);
  $('recommendations').innerHTML = [...new Set(chips)].map(x=>`<span class="chip">${escapeHtml(x)}</span>`).join('');
  $('limitations').textContent = meta.evaluation || 'No source-backed limitation recorded.';
  updateSelectedTemplateInfo(values);
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
  updateBuilderActionStates();
  deriveRecommendation(values);
}

function getSettings() {
  return {
    provider: $('provider').value,
    baseUrl: $('baseUrl').value.trim(),
    apiKey: $('apiKey').value.trim(),
    model: $('model').value,
    mockMode: $('mockMode').checked
  };
}

function updateBuilderActionStates() {
  const model = $('model');
  const hasConnectedModel = !!model?.value && !model.disabled;
  const hasPrompt = !!$('finalPrompt')?.value.trim();
  const setDisabled = (id, disabled) => { const button = $(id); if (button) button.disabled = !!disabled; };

  setDisabled('analyzeBtn', !hasConnectedModel || aiActionBusy);
  setDisabled('generateBtn', !hasConnectedModel || aiActionBusy);
  setDisabled('copyReferencesBtn', !refs.length || $('copyReferencesBtn')?.dataset.busy === 'true');
  setDisabled('copyGenerationDataBtn', !CONFIG?.fields?.length || $('copyGenerationDataBtn')?.dataset.busy === 'true');
  setDisabled('copyPromptBtn', !hasPrompt);
  setDisabled('copyPromptIcon', !hasPrompt);
  setDisabled('copyJsonBtn', !CONFIG?.fields?.length);
  setDisabled('openToolBtn', !hasPrompt);
  setDisabled('addToTemplatesBtn', !hasPrompt || $('addToTemplatesBtn')?.dataset.busy === 'true');
}

async function loadImageFromDataUrl(dataUrl) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read reference image for palette extraction.'));
    img.src = dataUrl;
  });
}

function getReferenceCompositionOptions() {
  const sceneField = CONFIG?.fields?.find(field => field.id === 'sceneElements');
  const placementField = CONFIG?.fields?.find(field => field.id === 'placement');
  const sceneElementOptions = (sceneField?.options || []).map(option => option.value).filter(Boolean);
  const placementOptionsByScene = Object.fromEntries(sceneElementOptions.map(scene => [
    scene,
    (placementField?.options || []).filter(option => option.sceneElements?.includes(scene)).map(option => option.value)
  ]));
  return { sceneElementOptions, placementOptionsByScene };
}

function buildReferenceAnalysisRequest(referenceCount = refs.length) {
  const { sceneElementOptions, placementOptionsByScene } = getReferenceCompositionOptions();
  const panels = Number(referenceCount) > 1
    ? `This contact sheet contains ${referenceCount} numbered reference panels. Analyze each panel separately first, then compare them and report only traits shared across all panels. Refer to panels by their numbers while reasoning, but do not treat the panel labels as visual content from the references.`
    : 'This contact sheet contains one reference panel. Analyze its visible content directly.';
  return `${panels} Describe only visual characteristics clearly supported by the reference panels: style, subjects, composition, framing, color palette (up to 8 representative HEX colors), lighting, materials, textures, perspective, atmosphere, and depth. Ignore visible text, logos, UI, interface elements, and the contact-sheet panel labels. Do not use Builder settings or invent details. Do not write a final image-generation prompt. Classify the shared scene as one of ${sceneElementOptions.map(option => JSON.stringify(option)).join(', ')}. Choose placement only from the options associated with the selected scene type in this mapping: ${JSON.stringify(placementOptionsByScene)}. Return only valid JSON in this exact structure: {"description":"...","palette":["#RRGGBB"],"suggestions":{"style":"short visual style phrase","sceneElements":"...","placement":"..."}}.`;
}

async function resizeReferenceForClipboard(reference) {
  const image = await loadImageFromDataUrl(reference.dataUrl);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, 500 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error(`Could not resize reference image "${reference.name}".`);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { name: reference.name, dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

async function createReferenceContactSheet(images, instruction) {
  if (!images.length) throw new Error('No reference images are available.');
  const columns = images.length === 1 ? 2 : Math.min(3, Math.ceil(Math.sqrt(images.length)));
  const rows = Math.ceil(images.length / columns);
  const tileWidth = 520;
  const tileHeight = 538;
  const gutter = 16;
  const canvas = document.createElement('canvas');
  canvas.width = columns * tileWidth + (columns + 1) * gutter;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the reference contact sheet.');

  const instructionPadding = 20;
  const headerHeight = 24;
  const lineHeight = 19;
  const textWidth = canvas.width - gutter * 2 - instructionPadding * 2;
  context.font = '14px Arial, sans-serif';
  const instructionLines = [];
  let line = '';
  for (const word of String(instruction || '').split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > textWidth) {
      instructionLines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) instructionLines.push(line);
  const instructionBlockHeight = instructionPadding * 2 + headerHeight + 8 + instructionLines.length * lineHeight;
  const gridHeight = rows * tileHeight + (rows + 1) * gutter;
  canvas.height = gutter + instructionBlockHeight + gridHeight;

  context.fillStyle = '#e5e7eb';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.fillRect(gutter, gutter, canvas.width - gutter * 2, instructionBlockHeight);
  context.fillStyle = '#111827';
  context.font = '700 16px Arial, sans-serif';
  context.textBaseline = 'top';
  context.fillText('AI ANALYSIS REQUEST', gutter + instructionPadding, gutter + instructionPadding);
  context.font = '14px Arial, sans-serif';
  instructionLines.forEach((text, index) => {
    context.fillText(text, gutter + instructionPadding, gutter + instructionPadding + headerHeight + 8 + index * lineHeight);
  });

  const gridTop = gutter + instructionBlockHeight;
  for (let index = 0; index < images.length; index += 1) {
    const imageData = images[index];
    const image = await loadImageFromDataUrl(imageData.dataUrl);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = images.length === 1
      ? (canvas.width - tileWidth) / 2
      : gutter + column * (tileWidth + gutter);
    const y = gridTop + gutter + row * (tileHeight + gutter);
    context.fillStyle = '#ffffff';
    context.fillRect(x, y, tileWidth, tileHeight);
    context.fillStyle = '#111827';
    context.font = '600 16px Arial, sans-serif';
    context.textBaseline = 'middle';
    context.fillText(`Reference ${index + 1}`, x + 12, y + 17);

    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, 500 / imageWidth, 500 / imageHeight);
    const drawWidth = imageWidth * scale;
    const drawHeight = imageHeight * scale;
    const drawX = x + (tileWidth - drawWidth) / 2;
    const drawY = y + 30 + (500 - drawHeight) / 2;
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  }

  return await new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode the reference contact sheet as PNG.')), 'image/png');
  });
}

async function copyReferencesToClipboard() {
  const button = $('copyReferencesBtn');
  const status = $('referenceCopyStatus');
  if (!button || button.disabled || !refs.length) return;
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    if (status) status.textContent = 'This browser cannot copy images. Open the app over HTTPS and use a browser with image clipboard support.';
    return;
  }

  button.dataset.busy = 'true';
  button.textContent = 'Preparing references…';
  if (status) status.textContent = '';
  updateBuilderActionStates();
  try {
    const request = buildReferenceAnalysisRequest(refs.length);
    const resizedImages = Promise.all(refs.map(resizeReferenceForClipboard));
    const contactSheetBlob = resizedImages.then(images => createReferenceContactSheet(images, request));
    const clipboardItem = new ClipboardItem({
      'image/png': contactSheetBlob
    });
    await navigator.clipboard.write([clipboardItem]);
    if (status) status.textContent = 'Контактный лист с инструкцией скопирован как изображение. Вставьте его в ChatGPT.';
  } catch (error) {
    if (status) status.textContent = `Не удалось скопировать референсы: ${error.message}`;
  } finally {
    delete button.dataset.busy;
    button.textContent = 'Copy image with prompt';
    updateBuilderActionStates();
  }
}

async function copyGenerationData() {
  const button = $('copyGenerationDataBtn');
  const status = $('generationCopyStatus');
  if (!button || button.disabled) return;
  button.dataset.busy = 'true';
  button.textContent = 'Preparing request…';
  if (status) status.textContent = '';
  updateBuilderActionStates();
  try {
    const promptBlob = fetch('./api/generation-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: getConfigValues(), referenceDescription: $('referenceDescription').value.trim() })
    }).then(async response => {
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      if (!data.prompt) throw new Error('The generation request is empty.');
      return new Blob([data.prompt], { type: 'text/plain' });
    });
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': promptBlob })]);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(await (await promptBlob).text());
    } else {
      throw new Error('This browser does not allow clipboard access. Open the app over HTTPS and allow clipboard access.');
    }
    if (status) status.textContent = 'Данные для генерации промта скопированы в буфер обмена.';
  } catch (error) {
    if (status) status.textContent = `Не удалось скопировать запрос: ${error.message}`;
  } finally {
    delete button.dataset.busy;
    button.textContent = 'Copy data for prompt generation';
    updateBuilderActionStates();
  }
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
  const instruction = 'Analyze only the attached reference image(s), using visible image content as the sole source of truth. If multiple references are attached, analyze each image separately first, then compare them and describe ONLY characteristics they have in common; ignore one-off details. Identify the common visual style, recurring subject/object types, composition and placement, framing, lighting, materials, textures, perspective, atmosphere and depth. Also extract a representative color palette of no more than 8 HEX colors. For multiple references, include only colors or very close color families that are genuinely common across the reference set; for one reference, return its dominant representative colors. Do not use or infer any Builder settings. Do not invent unsupported details. Do not generate a final image prompt.';
  console.log('[Prompt Builder] Reference analysis instruction sent to AI:\n' + instruction);
  console.log('[Prompt Builder] Reference images sent: ' + images.length);
  const compositionOptions = getReferenceCompositionOptions();
  const res = await fetch('./api/analyze', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({settings, images, instruction, ...compositionOptions}) });
  if (!res.ok) { const t = await res.text(); throw new Error(t); }
  const data = await res.json();
  applyReferenceAnalysisResult(data, 'Analyzed');
  console.log('[Prompt Builder] Palette returned by AI:', Array.isArray(data.palette) ? data.palette.slice(0, 8) : []);
  return data.description || '';
}

async function generateFinalWithAI(referenceDescription) {
  const settings = getSettings();
  if (!settings.model) throw new Error('Connect the provider and choose a Vision model first.');
  const values = getConfigValues();
  const res = await fetch('./api/generate', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({settings, values, referenceDescription})
  });
  if (!res.ok) { const t = await res.text(); throw new Error(t); }
  const data = await res.json();
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
  updateBuilderActionStates();
}

function resetModelSelect() {
  providerModels = [];
  $('model').innerHTML = '<option value="">Connect provider to load Vision models</option>';
  $('model').disabled = true;
  $('model').value = '';
  updateBuilderActionStates();
}

function initProviderSettings(defaultProviderId) {
  renderProviderOptions();
  const saved = JSON.parse(localStorage.getItem('pb-ai-settings') || '{}');
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
  $('baseUrl').addEventListener('input', () => { resetModelSelect(); $('connectionStatus').textContent = 'Not tested'; });
  $('apiKey').addEventListener('input', () => { $('apiKey').dataset.verified = 'false'; resetModelSelect(); $('connectionStatus').textContent = 'Not tested'; renderApiKeyHelp(); updateMockModeState(); });
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

async function saveProviderCredential(apiKey) {
  const provider = PROVIDERS[$('provider').value];
  if (!provider?.api_key?.required) return;
  const value = String(apiKey || '').trim();
  if (!value) return;
  const r = await fetch('./api/provider-credentials', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({provider: $('provider').value, apiKey:value})
  });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(data.error || 'Failed to save API key');
  SAVED_CREDENTIALS[$('provider').value] = { has_saved_key:true, required:true };
  $('apiKey').dataset.saved = 'true';
  $('apiKey').value = '';
  $('apiKey').placeholder = 'Saved securely · enter a new key to replace';
  updateMockModeState();
}

async function loadProviderModels({showError=false} = {}) {
  const provider = PROVIDERS[$('provider').value];
  if (!provider) return;
  const typedApiKey = $('apiKey').value.trim();
  const hasSavedKey = !!SAVED_CREDENTIALS[provider.id]?.has_saved_key;
  const apiKey = typedApiKey || '';
  if (provider.api_key?.required && !apiKey && !hasSavedKey) {
    if (showError) showConnectionError('Enter an API key first.');
    return;
  }

  try {
    $('testConnectionBtn').disabled = true;
    $('connectionStatus').textContent = 'Connecting and loading Vision models...';
    const r = await fetch('./api/models', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({provider:$('provider').value, baseUrl:$('baseUrl').value.trim(), apiKey})
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || 'Connection failed');
    providerModels = data.models || [];
    if (!providerModels.length) {
      resetModelSelect();
      $('connectionStatus').textContent = 'Connected · no Vision models found';
      if (showError) showConnectionError(`${provider.label}: connected successfully, but no Vision-capable models were found.`);
      return;
    }
    $('model').innerHTML = '<option value="">Select a Vision model</option>' + providerModels.map(m => `<option value="${escapeAttr(m.id)}">${escapeHtml(m.name || m.id)}</option>`).join('');
    const previous = $('model').dataset.previous || '';
    const preferred = providerModels.find(m => m.id === previous) || providerModels[0];
    $('model').disabled = false;
    $('model').value = preferred.id;
    $('model').dataset.previous = preferred.id;
    if (typedApiKey) await saveProviderCredential(typedApiKey);
    persistSettings();
    $('apiKey').dataset.verified = provider.api_key?.required ? 'true' : 'false';
    renderApiKeyHelp();
    updateMockModeState();
    $('connectionStatus').textContent = `Connected · ${provider.label} · ${providerModels.length} Vision model${providerModels.length === 1 ? '' : 's'}` + ($('mockMode').checked ? ' · Mock mode enabled' : '');
  } catch (e) {
    $('apiKey').dataset.verified = 'false';
    resetModelSelect();
    renderApiKeyHelp({forceVisible:true});
    $('connectionStatus').textContent = 'Connection failed';
    if (showError) showConnectionError(`${provider.label}: ${e.message}`);
  } finally {
    $('testConnectionBtn').disabled = false;
  }
}

async function clearConnection() {
  const provider = PROVIDERS[$('provider').value];
  $('apiKey').value = '';
  $('apiKey').dataset.verified = 'false';
  $('apiKey').dataset.saved = 'false';
  $('model').value = '';
  resetModelSelect();
  renderApiKeyHelp({forceVisible:true});
  $('connectionStatus').textContent = 'Clearing saved connection...';
  try {
    if (provider?.api_key?.required && SAVED_CREDENTIALS[$('provider').value]?.has_saved_key) {
      const r = await fetch('./api/provider-credentials', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({provider: $('provider').value, apiKey:''})
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'Failed to clear saved credential');
    }
    SAVED_CREDENTIALS[$('provider').value] = { has_saved_key:false, required: !!provider?.api_key?.required };
    localStorage.removeItem('pb-ai-settings');
    updateMockModeState();
    $('connectionStatus').textContent = 'Not connected';
  } catch (e) {
    $('connectionStatus').textContent = 'Could not clear saved connection';
    showConnectionError(`Failed to clear ${provider?.label || 'provider'} connection: ${e.message}`);
  }
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
  updateBuilderActionStates();
}
function escapeHtml(s){return String(s ?? '').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\\':'&#92;'}[m]))}
function escapeAttr(s){return escapeHtml(s).replace(/'/g,'&#39;')}
async function copyText(text, successMessage='Copied to clipboard.') {
  try {
    await navigator.clipboard.writeText(String(text ?? ''));
    $('statusBadge').textContent = successMessage;
  } catch (error) {
    $('statusBadge').textContent = `Could not copy to clipboard: ${error.message}`;
  }
}
function showTab(id){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===id));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active-view',v.id===id));
  if (id === 'builder') requestAnimationFrame(ensureConfigureFields);
  if (id === 'templates') renderTemplates();
}
async function loadPresets() {
  try {
    const res = await fetch('./api/presets', { cache: 'no-store' });
    if (!res.ok) throw new Error('Could not load presets');
    const data = await res.json();
    SAVED_PRESETS = Array.isArray(data.presets) ? data.presets : [];
    renderPresetOptions();
  } catch (error) {
    console.warn('[Prompt Builder] Presets unavailable:', error);
    SAVED_PRESETS = [];
    renderPresetOptions();
  }
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
  updateBuilderActionStates();
  $('statusBadge').textContent = 'Preset loaded';
  saveBuilderState();
}
function applyPresetValues(values) {
  ensureConfigureFields();
  const normalizedValues = { ...values };
  const legacyComposition = String(normalizedValues.composition || '').trim();
  if (!normalizedValues.sceneElements && legacyComposition) {
    const characterPlacement = legacyComposition.match(/^Character\s+(left|center|right)$/i);
    if (/^No character$/i.test(legacyComposition)) {
      normalizedValues.sceneElements = 'Object only';
      normalizedValues.placement ||= 'Center';
    } else if (characterPlacement) {
      normalizedValues.sceneElements = 'Character only';
      normalizedValues.placement ||= characterPlacement[1][0].toUpperCase() + characterPlacement[1].slice(1).toLowerCase();
    } else {
      normalizedValues.sceneElements = 'Custom';
      normalizedValues.placement ||= legacyComposition;
    }
  }
  if (normalizedValues.category === 'Sportsbook') normalizedValues.category = 'Sportsbook Banners';
  if (normalizedValues.category === 'Casino') normalizedValues.category = 'Casino Banners';
  if (!normalizedValues.section && ['Sportsbook Banners', 'Casino Banners'].includes(normalizedValues.category)) {
    normalizedValues.section = normalizedValues.category;
  }
  for (const field of (CONFIG?.fields || [])) {
    if (field.type === 'palette') { setReferencePalette(Array.isArray(normalizedValues[field.id]) ? normalizedValues[field.id] : []); continue; }
    const el = $(`field-${field.id}`);
    if (!el || normalizedValues[field.id] == null) continue;
    if (el.tagName === 'SELECT' && isCustomAllowed(field) && !Array.from(el.options).some(o => o.value === normalizedValues[field.id])) {
      const item = normalizeCustomValue(field, normalizedValues[field.id]);
      if (item && item.value === normalizedValues[field.id]) addCustomValue(field, el, item);
    }
    // Skip values that no longer exist in a select (e.g. removed options from older presets).
    if (el.tagName === 'SELECT' && !Array.from(el.options).some(o => o.value === normalizedValues[field.id])) continue;
    el.value = normalizedValues[field.id];
    if (el.tagName === 'SELECT') updateCustomRemoveState(el);
    if (field.id === 'sceneElements') updatePlacementOptions();
  }
  updatePlacementOptions();
  syncCombos();
  deriveRecommendation(normalizedValues);
}

async function savePreset() {
  const name = $('presetName').value.trim();
  if (!name) { alert('Enter a preset name first.'); $('presetName').focus(); return; }
  const payload = { name, values: getConfigValues(), referenceDescription: $('referenceDescription').value.trim(), prompt: $('finalPrompt').value };
  const res = await fetch('./api/presets', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save preset');
  SAVED_PRESETS = data.presets || SAVED_PRESETS;
  renderPresetOptions();
  $('presetName').value = name;
  $('statusBadge').textContent = 'Preset saved';
  saveBuilderState();
}
async function deletePreset() {
  const name = $('presetName').value.trim();
  if (!name) return;
  const res = await fetch('./api/presets/' + encodeURIComponent(name), { method:'DELETE' });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to delete preset');
  SAVED_PRESETS = data.presets || [];
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
  if ($('analyzeBtn').disabled) return;
  aiActionBusy = true;
  updateBuilderActionStates();
  showAiOverlay('Analyzing reference images with AI…');
  try { await analyzeReferences(); } catch(e) { showConnectionError(`Analysis failed: ${e.message}`); } finally { hideAiOverlay(); aiActionBusy = false; updateBuilderActionStates(); }
};
$('generateBtn').onclick=async()=>{
  if ($('generateBtn').disabled) return;
  aiActionBusy = true;
  updateBuilderActionStates();
  showAiOverlay('Generating final image prompt with AI…');
  try { await generatePrompt(); } finally { hideAiOverlay(); aiActionBusy = false; updateBuilderActionStates(); }
};
$('copyReferencesBtn').onclick=copyReferencesToClipboard;
$('copyGenerationDataBtn').onclick=copyGenerationData;
$('copyPromptBtn').onclick=()=>copyText($('finalPrompt').value, 'Prompt copied to clipboard.');
$('copyPromptIcon').onclick=()=>copyText($('finalPrompt').value, 'Prompt copied to clipboard.');
$('copyJsonBtn').onclick=()=>copyText(JSON.stringify({configuration:getConfigValues(), referenceDescription:$('referenceDescription').value, prompt:$('finalPrompt').value},null,2), 'Builder data copied as JSON.');
$('presetMenuToggle').onclick=togglePresetMenu;
$('presetName').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadPresetByName($('presetName').value.trim()); $('presetMenu').hidden = true; } });
$('presetName').addEventListener('focus', () => { if (SAVED_PRESETS.length) renderPresetOptions(); });
$('presetDeleteBtn').onclick=async()=>{try{await deletePreset();}catch(e){alert(`Could not delete preset: ${e.message}`)}};
$('presetSaveBtn').onclick=async()=>{try{await savePreset();}catch(e){alert(`Could not save preset: ${e.message}`)}};
document.addEventListener('click', e => { const wrap=$('presetPicker'); if (wrap && !wrap.contains(e.target)) { const menu=$('presetMenu'); if(menu) menu.hidden=true; } });
const TOOL_LINKS = {
  'Magnific': { label: 'Magnific', launchKey: 'Magnific' },
  'ChatGPT': { label: 'ChatGPT', launchKey: 'ChatGPT / Codex' },
  'Figma': { label: 'Figma', launchKey: 'Figma AI' }
};
function toolLinkFor(aiTool) {
  const name = String(aiTool || '').toLowerCase();
  if (name.includes('magnific')) return TOOL_LINKS['Magnific'];
  if (name.includes('chatgpt') || name.includes('codex')) return TOOL_LINKS['ChatGPT'];
  if (name.includes('figma')) return TOOL_LINKS['Figma'];
  return null;
}
function updateOpenToolButton() {
  const aiTool = $('field-aiTool')?.value || '';
  const launchUrls = CONFIG?.aiToolLaunchUrls || {};
  const link = toolLinkFor(aiTool);
  const target = { label: link?.label || aiTool || 'AI tool', url: link ? (launchUrls[link.launchKey] || '') : '' };
  if ($('toolName')) $('toolName').textContent = target.label;
  $('openToolBtn').dataset.url = target.url;
}
$('openToolBtn').onclick=async()=>{
  const prompt = $('finalPrompt').value.trim();
  const baseUrl = $('openToolBtn').dataset.url;
  if (!baseUrl) { $('statusBadge').textContent = 'This AI tool has no launch link.'; return; }
  if (!prompt) { $('statusBadge').textContent = 'Generate a prompt first.'; return; }

  // Reserve a tab during the click gesture so the async clipboard write won't trigger popup blocking.
  const chatTab = window.open('about:blank', '_blank');
  if (!chatTab) { $('statusBadge').textContent = 'Allow popups to open the selected AI tool.'; return; }

  try {
    await navigator.clipboard.writeText(prompt);
    const chatUrl = new URL(baseUrl);
    const host = chatUrl.hostname.toLowerCase();
    const isChatGPT = host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'chat.openai.com';
    if (!isChatGPT) {
      chatTab.location.replace(chatUrl.href);
      $('statusBadge').textContent = 'Prompt copied to clipboard.';
      return;
    }
    const fullPromptUrl = new URL(chatUrl.href);
    fullPromptUrl.searchParams.set('q', prompt);

    // Keep the full URL under a conservative 2,000-character limit.
    const query = fullPromptUrl.href.length <= 2000
      ? prompt
      : 'The full prompt is copied to your clipboard. Please paste it into this chat.';
    chatUrl.searchParams.set('q', query);
    chatTab.location.replace(chatUrl.href);
    $('statusBadge').textContent = fullPromptUrl.href.length <= 2000
      ? 'Prompt copied and passed to ChatGPT.'
      : 'Prompt copied. Paste it into ChatGPT from the clipboard.';
  } catch (error) {
    chatTab.close();
    $('statusBadge').textContent = `Could not copy the prompt: ${error.message}`;
  }
};
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
$('referenceDescription').addEventListener('input', handleReferenceDescriptionInput);
$('referenceDescription').addEventListener('paste', handleReferenceAnalysisPaste);
$('finalPrompt').addEventListener('input', updateBuilderActionStates);
updateBuilderActionStates();

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
function bindBuilderStatePersistence(){ ['referenceDescription','finalPrompt','presetName'].forEach(id=>$(id)?.addEventListener('input',saveBuilderState)); window.addEventListener('beforeunload',saveBuilderState); }
loadPresets();
bindBuilderStatePersistence();
$('applyAiSuggestionsBtn')?.addEventListener('click', applyAiSuggestions);
loadAppVersion();
$('templateAddBtn')?.addEventListener('click', addTemplate);
$('addToTemplatesBtn')?.addEventListener('click', addBuilderResultTemplate);
$('templateSaveBtn')?.addEventListener('click', saveTemplateFile);
$('templateDuplicateBtn')?.addEventListener('click', duplicateTemplate);
$('templateDeleteBtn')?.addEventListener('click', deleteTemplate);
$('editorPromptTemplate')?.addEventListener('input', () => { writeTemplateEditorToModel(); syncPromptHighlight(); });
$('editorPromptTemplate')?.addEventListener('scroll', syncPromptHighlight);
['editorTemplateName', 'editorContext', 'editorEvaluation'].forEach(id => $(id)?.addEventListener('input', writeTemplateEditorToModel));
$('editorTemplateRating')?.addEventListener('change', () => { writeTemplateEditorToModel(); updateEditorRatingStars($('editorTemplateRating').value); });
$('copyTemplateBtn')?.addEventListener('click', () => copyText($('editorPromptTemplate')?.value || ''));
$('copyTemplateIcon')?.addEventListener('click', () => copyText($('editorPromptTemplate')?.value || ''));
$('exportUserDataBtn')?.addEventListener('click', exportUserData);
$('importUserDataBtn')?.addEventListener('click', () => $('importUserDataInput')?.click());
$('importUserDataInput')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try { await importUserData(file); } catch (err) { userDataStatus('Could not import user data: ' + err.message, false); }
  finally { e.target.value = ''; }
});

loadTemplates().then(loadConfig).then(()=>{ restoreBuilderState(); updateOpenToolButton(); updateBuilderActionStates(); try { deriveRecommendation(getConfigValues()); } catch (_) {} }).catch(error => {
  console.error('[Prompt Builder] Startup failed:', error);
  const root = $('dynamicFields');
  const hint = location.protocol === 'file:' ? ' The page was opened from a file; serve the folder over HTTP (run "npm start" and open http://localhost:3000) or use GitHub Pages.' : ' Check that the web server is running and reload the page.';
  if (root) root.innerHTML = `<div class=\"muted\">Could not load Builder configuration: ${escapeHtml(error.message)}.${hint}</div>`;
});
