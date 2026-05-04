/**
 * Prompt Pocket — sidepanel/sidepanel.js
 *
 * Handles all UI for the side panel: template CRUD, view-use (variable filling),
 * category chips, libraries tab, settings, backup/restore, health banner, theme.
 */

import {
  initializeStorage,
  getTemplates,
  getMyTemplates,
  getLibraryTemplates,
  getFavouritedTemplates,
  addTemplate,
  updateTemplate,
  deleteTemplate,
  moveTemplate,
  toggleFavourite,
  getLibraries,
  createLibrary,
  renameLibrary,
  deleteLibrary,
  getSettings,
  updateSettings,
  getAutoBackups,
  restoreTemplates,
  buildExport,
  parseExportEnvelope,
} from './storage.js';

// ── Category definitions (mirrors design) ──────────
const CATEGORIES = [
  { id: 'general',   label: 'General',   color: '#C4A974' },
  { id: 'developer', label: 'Developer', color: '#7AA8D9' },
  { id: 'writing',   label: 'Writing',   color: '#B689C9' },
  { id: 'research',  label: 'Research',  color: '#7FBF8C' },
  { id: 'marketing', label: 'Marketing', color: '#E29B7D' },
  { id: 'personal',  label: 'Personal',  color: '#D9B86F' },
];

// Bundled library packs (Phase 5 will pull these from a remote registry)
const LIBRARY_PACKS = [
  { id: 'l1', name: 'Senior Engineer Pack', author: 'ppkt/official', count: 18, installed: true,  hue: '#7AA8D9' },
  { id: 'l2', name: 'Editorial Toolkit',    author: '@mira.writes',  count: 24, installed: false, hue: '#B689C9' },
  { id: 'l3', name: 'Founder\'s Inbox',     author: '@hk',           count: 11, installed: false, hue: '#E29B7D' },
  { id: 'l4', name: 'Academic Research',    author: '@nori-lab',     count: 32, installed: true,  hue: '#7FBF8C' },
  { id: 'l5', name: 'Daily Journaling',     author: '@quietmornings',count: 9,  installed: false, hue: '#D9B86F' },
];

// ── AI tool definitions ─────────────────────────────
const AI_TOOLS = [
  { id: 'chatgpt',      label: 'ChatGPT',      url: 'https://chatgpt.com',                  color: '#10a37f', defaultEnabled: true,  comingSoon: false },
  { id: 'copilot',      label: 'Copilot',      url: 'https://copilot.microsoft.com',         color: '#0078d4', defaultEnabled: true,  comingSoon: false },
  { id: 'm365-copilot', label: 'M365 Copilot', url: 'https://m365.cloud.microsoft/chat',     color: '#0078d4', defaultEnabled: true,  comingSoon: false },
  { id: 'gemini',       label: 'Gemini',       url: 'https://gemini.google.com',             color: '#4285f4', defaultEnabled: false, comingSoon: false },
  { id: 'claude',       label: 'Claude',       url: 'https://claude.ai',                     color: '#D97757', defaultEnabled: false, comingSoon: false },
  { id: 'grok',         label: 'Grok',         url: 'https://grok.com',                      color: '#9E9E9E', defaultEnabled: false, comingSoon: true  },
];

// Theme definitions for settings picker
const THEME_OPTIONS = [
  { id: 'navy',      label: 'Navy',  hint: 'Dark + gold',    swatch: ['#0F1320', '#161B2C', '#C4A974'] },
  { id: 'ink',       label: 'Ink',   hint: 'Near-black',     swatch: ['#0B0B0E', '#15151A', '#D8B96B'] },
  { id: 'parchment', label: 'Light', hint: 'Warm parchment', swatch: ['#F5F0E4', '#FBF7EC', '#8C6B2A'] },
];

// ── State ───────────────────────────────────────────
let allTemplates    = [];   // all templates flat (My + library)
let allLibraries    = [];   // library metadata array
let currentEditingId  = null;
let currentUseId      = null;
let varValues         = {};
let activeDensity     = 'compact';
let showBadges        = true;
let libraryPackState  = LIBRARY_PACKS.map(p => ({ ...p }));
let isDormantMode     = false;
let currentLibraryId  = null;  // library open in detail view
let libSort           = 'newest'; // 'az'|'za'|'newest'|'oldest'

// Per-tab persisted filter state
const tabState = {
  my:  { search: '', tags: [] },
  lib: { search: '', tags: [], detailSearch: '', detailTags: [] },
};

const urlParams = new URLSearchParams(window.location.search);

// ── Utility: extract {{vars}} from template body ────
function extractVars(body) {
  const out = [];
  const seen = new Set();
  const re = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
  }
  return out;
}

function fillTemplate(body, values) {
  return body.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_, k) => values[k] || `{{${k}}}`);
}

function categoryOf(id) {
  return CATEGORIES.find(c => c.id === (id || '').toLowerCase()) || CATEGORIES[0];
}

// ── Toast ───────────────────────────────────────────
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  el.style.animation = 'none';
  // Force reflow before re-applying animation
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 1900);
}

// ── View navigation ─────────────────────────────────
function switchView(viewId) {
  document.querySelectorAll('.view').forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('active');
  });
  const target = document.getElementById(viewId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }
  if (viewId === 'view-main') refreshList();
  else if (viewId === 'view-backup') renderAutoBackups();
}

// ── Initialization ──────────────────────────────────
async function init() {
  await initializeStorage();

  if (urlParams.get('source') === 'dormant') {
    isDormantMode = true;
    const banner = document.getElementById('health-banner');
    if (banner) banner.classList.add('hidden');
  }

  const settings = await getSettings();
  activeDensity = settings.density || 'compact';
  showBadges    = settings.show_badges !== false;
  libSort       = settings.library_sort || 'newest';

  // Restore persisted tab filter state
  tabState.my.search  = settings.my_tab_search || '';
  tabState.my.tags    = settings.my_tab_tags   || [];

  applyThemeOverride(settings.theme_override || 'navy');
  populateSettingsForm(settings);

  initCategoryChips();
  initThemeOptions(settings.theme_override || 'navy');
  initDensityOptions(activeDensity);
  initAIToolsSettings(settings.enabled_ai_tools);
  initLibraryPackState();
  renderDormantButtons(settings.enabled_ai_tools);

  // Load both templates and library metadata
  [allTemplates, allLibraries] = await Promise.all([getTemplates(), getLibraries()]);

  renderMyTemplatesPanel();
  updateTabCounts();
  initLibrarySelector();

  if (urlParams.get('view') === 'settings') switchView('view-settings');

  const aboutEl = document.getElementById('about-meta');
  if (aboutEl) {
    const myCount = allTemplates.filter(t => t.library_id === null).length;
    aboutEl.textContent = `v${chrome.runtime.getManifest().version} · ${myCount} template${myCount !== 1 ? 's' : ''}`;
  }

  checkForUpdate();
}

// ── Data refresh ────────────────────────────────────
async function refreshAll() {
  [allTemplates, allLibraries] = await Promise.all([getTemplates(), getLibraries()]);
  updateTabCounts();
  initLibrarySelector();
  const activeTab = document.querySelector('.tab.active')?.dataset.tab || 'my';
  if (activeTab === 'my') renderMyTemplatesPanel();
  else if (currentLibraryId) renderLibraryDetail(currentLibraryId);
  else renderLibraryListPanel();
}

// kept for compatibility with existing callers
async function refreshList() {
  await refreshAll();
}

function updateTabCounts() {
  const myCount  = allTemplates.filter(t => t.library_id === null).length
                 + allTemplates.filter(t => t.library_id !== null && t.favorited).length;
  const libCount = allLibraries.length;
  const myEl  = document.getElementById('tab-count-my');
  const libEl = document.getElementById('tab-count-libs');
  if (myEl)  myEl.textContent  = myCount  || '';
  if (libEl) libEl.textContent = libCount || '';
}

// ── Filter helpers ───────────────────────────────────
function filterTemplates(templates, q, activeTags = []) {
  let list = templates;
  if (q) {
    const lq = q.toLowerCase();
    list = list.filter(t =>
      t.title?.toLowerCase().includes(lq) ||
      t.body?.toLowerCase().includes(lq)  ||
      (t.tags || []).some(tag => tag.toLowerCase().includes(lq)) ||
      categoryOf(t.category).label.toLowerCase().includes(lq)
    );
  }
  if (activeTags.length > 0) {
    // OR logic: template must have at least one of the selected tags
    list = list.filter(t =>
      activeTags.some(at => (t.tags || []).map(x => x.toLowerCase()).includes(at.toLowerCase()))
    );
  }
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

function uniqueTags(templates) {
  const set = new Set();
  templates.forEach(t => (t.tags || []).forEach(tag => set.add(tag)));
  return [...set].sort();
}

let listDelegated = false;

function renderTemplates(templates) {
  const list = document.getElementById('template-list');
  if (!list) return;
  list.innerHTML = '';

  if (!listDelegated) {
    list.addEventListener('click', e => {
      const card = e.target.closest('.template-card');
      if (!card) return;
      const tId = card.dataset.id;
      if (e.target.closest('.template-edit-btn')) {
        openForm(tId);
      } else {
        const t = allTemplates.find(x => x.id === tId);
        if (!t) return;
        // Direct insert when no variables; open preview to fill them when there are
        if (extractVars(t.body).length === 0) {
          insertTextToHost(t.body);
        } else {
          openUseView(tId);
        }
      }
    });
    listDelegated = true;
  }

  if (templates.length === 0) {
    const q = document.getElementById('search-input')?.value;
    list.innerHTML = `
      <div class="empty-state">
        <svg width="56" height="56" viewBox="0 0 32 32" fill="none" style="color:var(--accent);opacity:0.5">
          <path d="M5 6 L5 18 Q5 26 16 27 Q27 26 27 18 L27 6" stroke="currentColor"
                stroke-width="1.4" stroke-linecap="round" stroke-dasharray="3 2.2"/>
        </svg>
        <div class="empty-state-title">${q ? 'No matches' : 'Your pocket is empty'}</div>
        <div class="empty-state-hint">${q
          ? 'Try a different search or clear the filter.'
          : 'Save prompts you use often — they\'ll be one tap away from any tab.'
        }</div>
      </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  const densityClass = activeDensity === 'cozy' ? '' : 'density-compact';
  list.className = `scroll-area ${densityClass}`;

  templates.forEach(t => {
    const cat = categoryOf(t.category);
    const card = document.createElement('div');
    card.className = 'template-card';
    card.dataset.id = t.id;
    card.setAttribute('role', 'listitem');

    const preview = t.body?.split('\n')[0] || '';
    const badgeHtml = showBadges
      ? `<span class="cat-badge" style="background:${cat.color}22;border:0.5px solid ${cat.color}55;color:${cat.color}">
           <span class="cat-badge-dot" style="background:${cat.color}"></span>
           ${escHtml(cat.label)}
         </span>`
      : '';

    const metaDate = t.modified_at
      ? relativeTime(t.modified_at)
      : (t.updated || '');

    // Library badge — shown when a favourited library template appears in My Templates
    const lib = t.library_id ? allLibraries.find(l => l.id === t.library_id) : null;
    const libBadgeHtml = lib
      ? `<span class="lib-badge" data-lib-id="${lib.id}" title="From library: ${escHtml(lib.name)}">
           <svg width="9" height="9" aria-hidden="true"><use href="#ic-sparkle"/></svg>
           ${escHtml(lib.name)}
         </span>`
      : '';

    card.innerHTML = `
      <div class="template-card-inner">
        <div class="template-card-body">
          <div class="template-card-title-row">
            ${t.pinned ? `<svg class="template-pin" width="10" height="10" aria-hidden="true"><use href="#ic-pin"/></svg>` : ''}
            <span class="template-title">${escHtml(t.title)}</span>
            ${libBadgeHtml}
          </div>
          <div class="template-preview">${escHtml(preview)}</div>
          <div class="template-card-meta">
            ${badgeHtml}
            <span class="template-meta-text">${metaDate || ''}</span>
          </div>
        </div>
        <button type="button" class="template-edit-btn" aria-label="Edit ${escHtml(t.title)}">
          <svg width="14" height="14" aria-hidden="true"><use href="#ic-pencil"/></svg>
        </button>
      </div>`;
    frag.appendChild(card);
  });

  list.appendChild(frag);
}

function renderLibraries() {
  const list = document.getElementById('template-list');
  if (!list) return;
  list.innerHTML = '';
  list.className = 'scroll-area';

  const frag = document.createDocumentFragment();
  libraryPackState.forEach(p => {
    const el = document.createElement('div');
    el.className = 'library-pack';
    el.innerHTML = `
      <div class="library-icon" style="background:linear-gradient(135deg,${p.hue}33,${p.hue}11);border:1px solid ${p.hue}44;color:${p.hue}">
        <svg width="18" height="18" aria-hidden="true"><use href="#ic-sparkle"/></svg>
      </div>
      <div class="library-info">
        <div class="library-name">${escHtml(p.name)}</div>
        <div class="library-meta">${escHtml(p.author)} · ${p.count} prompts</div>
      </div>
      <button type="button" class="library-btn ${p.installed ? 'installed' : 'install'}" data-id="${p.id}">
        ${p.installed ? 'Installed' : 'Install'}
      </button>`;
    el.querySelector('.library-btn').addEventListener('click', () => togglePack(p.id));
    frag.appendChild(el);
  });
  list.appendChild(frag);
}

function togglePack(id) {
  libraryPackState = libraryPackState.map(p =>
    p.id === id ? { ...p, installed: !p.installed } : p
  );
  renderLibraries();
}

// ── Use view ────────────────────────────────────────
function openUseView(templateId) {
  const t = allTemplates.find(x => x.id === templateId);
  if (!t) return;
  currentUseId = templateId;

  const vars = extractVars(t.body);
  varValues = Object.fromEntries(vars.map(v => [v, '']));

  // Header
  document.getElementById('use-title').textContent = t.title;

  // Meta
  const cat = categoryOf(t.category);
  const badge = document.getElementById('use-category-badge');
  badge.style.cssText = `background:${cat.color}22;border:0.5px solid ${cat.color}55;color:${cat.color}`;
  badge.innerHTML = `<span class="cat-badge-dot" style="background:${cat.color}"></span>${escHtml(cat.label)}`;
  document.getElementById('use-uses').textContent = `${t.uses || 0} uses`;

  // Variables section
  const varsSection = document.getElementById('use-vars-section');
  const varsList = document.getElementById('use-vars-list');
  if (vars.length > 0) {
    varsSection.classList.remove('hidden');
    varsList.innerHTML = '';
    const frag = document.createDocumentFragment();
    vars.forEach(v => {
      const wrap = document.createElement('div');
      wrap.className = 'var-field';
      const isMultiline = ['code', 'sources', 'notes', 'text', 'content'].includes(v);
      const inputId = `var-${v}`;
      wrap.innerHTML = `
        <label class="var-field-label" for="${inputId}">{{${escHtml(v)}}}</label>
        ${isMultiline
          ? `<textarea id="${inputId}" class="var-field-input" rows="3" placeholder="Enter ${escHtml(v)}…"></textarea>`
          : `<input type="text" id="${inputId}" class="var-field-input" placeholder="Enter ${escHtml(v)}…">`
        }`;
      const input = wrap.querySelector('input, textarea');
      input.addEventListener('input', e => {
        varValues[v] = e.target.value;
        const label = wrap.querySelector('.var-field-label');
        if (label) label.className = `var-field-label${e.target.value.trim() ? ' filled' : ''}`;
        updateUsePreview(t);
      });
      frag.appendChild(wrap);
    });
    varsList.appendChild(frag);
  } else {
    varsSection.classList.add('hidden');
  }

  updateUsePreview(t);

  // Wire edit button
  document.getElementById('btn-edit-use').onclick = () => openForm(templateId);

  switchView('view-use');
}

function updateUsePreview(t) {
  const filled = fillTemplate(t.body, varValues);
  const preview = document.getElementById('use-preview');
  const charCount = document.getElementById('use-char-count');
  if (charCount) charCount.textContent = `${filled.length} chars`;

  // Render preview with unfilled {{tokens}} highlighted
  if (preview) {
    preview.innerHTML = '';
    const parts = filled.split(/(\{\{[^}]+\}\})/g);
    parts.forEach(part => {
      if (/^\{\{.+\}\}$/.test(part)) {
        const span = document.createElement('span');
        span.className = 'preview-token';
        span.textContent = part;
        preview.appendChild(span);
      } else {
        preview.appendChild(document.createTextNode(part));
      }
    });
  }

  // Update copy button label and disabled state
  const vars = extractVars(t.body);
  const allFilled = vars.every(v => varValues[v]?.trim());
  const copyBtn = document.getElementById('btn-copy-filled');
  const sendBtn = document.getElementById('btn-send-filled');
  const remaining = vars.filter(v => !varValues[v]?.trim()).length;

  if (copyBtn) {
    copyBtn.disabled = vars.length > 0 && !allFilled;
    document.getElementById('btn-copy-label').textContent = (vars.length > 0 && !allFilled)
      ? `Fill ${remaining} more to copy`
      : 'Copy filled prompt';
  }
  if (sendBtn) sendBtn.disabled = vars.length > 0 && !allFilled;
}

document.getElementById('btn-back-use')?.addEventListener('click', () => switchView('view-main'));

document.getElementById('btn-copy-filled')?.addEventListener('click', () => {
  const t = allTemplates.find(x => x.id === currentUseId);
  if (!t) return;
  const text = fillTemplate(t.body, varValues);
  navigator.clipboard?.writeText(text).catch(() => {});
  showToast('Copied to clipboard');
});

document.getElementById('btn-send-filled')?.addEventListener('click', () => {
  const t = allTemplates.find(x => x.id === currentUseId);
  if (!t) return;
  const text = fillTemplate(t.body, varValues);
  insertTextToHost(text);
});

// ── Text insertion into AI tab ──────────────────────
function insertTextToHost(text) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs.length) return;
    const tab = tabs[0];
    const supported = tab.url?.includes('chatgpt.com') ||
                      tab.url?.includes('chat.openai.com') ||
                      tab.url?.includes('copilot.microsoft.com');

    if (!supported) {
      alert('Please navigate to ChatGPT or Copilot to insert a template.');
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: 'INSERT', text }).catch(async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/theme-detector.js', 'content/injector.js',
                  'content/selector-canary.js', 'content/content.js']
        });
        chrome.tabs.sendMessage(tab.id, { type: 'INSERT', text }).catch(() => {
          alert('Could not insert. Make sure the page is fully loaded.');
        });
      } catch {
        alert('Could not connect to the page. Try refreshing it.');
      }
    });

    showToast('Sent to active tab');
  });
}

// ── Form ────────────────────────────────────────────
// presetLibraryId: when opening "New Template" from inside a library
async function openForm(templateId = null, presetLibraryId = null) {
  currentEditingId = templateId;
  const btnDelete   = document.getElementById('btn-delete-template');
  const titleInput  = document.getElementById('template-title');
  const bodyInput   = document.getElementById('template-body');
  const favRow      = document.getElementById('form-favourite-row');

  if (templateId) {
    const t = allTemplates.find(x => x.id === templateId);
    if (t) {
      // Library templates open read-only with a "Save as new in My Templates" prompt
      if (t.library_id) {
        document.getElementById('form-title').textContent = 'View Template (Library)';
      } else {
        document.getElementById('form-title').textContent = 'Edit Template';
      }
      titleInput.value = t.title;
      setSelectedCategory(t.category || 'general');
      bodyInput.value  = t.body;
      setFormLibrary(t.library_id, t.favorited);
      btnDelete?.classList.remove('hidden');
    }
  } else {
    document.getElementById('form-title').textContent = 'New Template';
    titleInput.value = '';
    const settings = await getSettings();
    setSelectedCategory(
      CATEGORIES.find(c => c.label.toLowerCase() === (settings.default_category || 'general').toLowerCase())?.id || 'general'
    );
    bodyInput.value = '';
    setFormLibrary(presetLibraryId, false);
    btnDelete?.classList.add('hidden');
  }

  // Show/hide favourite toggle based on current library selection
  const libSel = document.getElementById('template-library');
  favRow?.classList.toggle('hidden', !libSel?.value);

  updateDetectedVars(bodyInput.value);
  switchView('view-form');
}

function setFormLibrary(libraryId, favorited) {
  const sel  = document.getElementById('template-library');
  const fav  = document.getElementById('template-favourite');
  const favRow = document.getElementById('form-favourite-row');
  if (sel) sel.value = libraryId || '';
  if (fav) fav.checked = !!favorited;
  favRow?.classList.toggle('hidden', !libraryId);
}

function initLibrarySelector() {
  const sel = document.getElementById('template-library');
  if (!sel) return;
  // Preserve current value across refreshes
  const current = sel.value;
  sel.innerHTML = '<option value="">My Templates</option>';
  allLibraries.forEach(lib => {
    const opt = document.createElement('option');
    opt.value = lib.id;
    opt.textContent = lib.name;
    sel.appendChild(opt);
  });
  // + New Library option
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ New Library…';
  sel.appendChild(newOpt);
  sel.value = current || '';
}

// Category chip selection
function setSelectedCategory(id) {
  const hidden = document.getElementById('template-category');
  if (hidden) hidden.value = id;
  document.querySelectorAll('.cat-chip').forEach(chip => {
    const isActive = chip.dataset.id === id;
    chip.classList.toggle('active', isActive);
    const dotEl = chip.querySelector('.cat-chip-dot');
    if (dotEl) {
      dotEl.style.background = isActive ? chip.dataset.color : 'transparent';
    }
    chip.style.color = isActive ? chip.dataset.color : '';
    chip.style.borderColor = isActive ? `${chip.dataset.color}55` : '';
    chip.style.background = isActive ? `${chip.dataset.color}22` : '';
  });
}

function initCategoryChips() {
  const grid = document.getElementById('category-chips');
  if (!grid) return;
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-chip';
    btn.dataset.id = cat.id;
    btn.dataset.color = cat.color;
    btn.innerHTML = `<span class="cat-chip-dot" style="width:5px;height:5px;border-radius:50%;background:${cat.color}"></span>${escHtml(cat.label)}`;
    btn.addEventListener('click', () => setSelectedCategory(cat.id));
    grid.appendChild(btn);
  });
}

// Detect {{vars}} while typing in body textarea
document.getElementById('template-body')?.addEventListener('input', e => {
  updateDetectedVars(e.target.value);
});

function updateDetectedVars(body) {
  const vars = extractVars(body);
  const section = document.getElementById('detected-vars-section');
  const list = document.getElementById('detected-vars-list');
  if (!section || !list) return;
  if (vars.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  list.innerHTML = vars.map(v => `<span class="var-chip">{{${escHtml(v)}}}</span>`).join('');
}

document.getElementById('btn-new-template')?.addEventListener('click', () => openForm());
document.getElementById('btn-cancel-form')?.addEventListener('click', () => switchView('view-main'));

// Library selector change — show/hide favourite toggle + handle "+ New Library"
document.getElementById('template-library')?.addEventListener('change', async e => {
  const val = e.target.value;
  const favRow = document.getElementById('form-favourite-row');
  if (val === '__new__') {
    const name = prompt('New library name:')?.trim();
    if (!name) { e.target.value = currentEditingId
      ? (allTemplates.find(t => t.id === currentEditingId)?.library_id || '')
      : ''; return; }
    if (allLibraries.find(l => l.name.toLowerCase() === name.toLowerCase())) {
      alert('A library with that name already exists.'); e.target.value = ''; return;
    }
    const lib = await createLibrary(name);
    allLibraries.push(lib);
    initLibrarySelector();
    e.target.value = lib.id;
  }
  favRow?.classList.toggle('hidden', !e.target.value);
});

document.getElementById('btn-send-from-edit')?.addEventListener('click', () => {
  const body = document.getElementById('template-body')?.value.trim();
  if (!body) return;
  insertTextToHost(body);
});

document.getElementById('btn-copy-from-edit')?.addEventListener('click', () => {
  const body = document.getElementById('template-body')?.value.trim();
  if (!body) return;
  navigator.clipboard?.writeText(body).catch(() => {});
  showToast('Copied to clipboard');
});

document.getElementById('btn-save-template')?.addEventListener('click', async () => {
  const title    = document.getElementById('template-title')?.value.trim();
  const body     = document.getElementById('template-body')?.value.trim();
  if (!title || !body) { alert('Title and Body are required.'); return; }

  const category   = document.getElementById('template-category')?.value || 'general';
  const tagsRaw    = document.getElementById('template-tags')?.value || '';
  const tags       = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const libraryId  = document.getElementById('template-library')?.value || null;
  const favorited  = document.getElementById('template-favourite')?.checked || false;

  try {
    if (currentEditingId) {
      const existing = allTemplates.find(t => t.id === currentEditingId);
      if (existing?.library_id) {
        // Library templates save as NEW in My Templates — confirmed by user
        if (!confirm('Library templates cannot be edited directly.\n\nSave a copy to My Templates?')) return;
        await addTemplate({ title, body, category, tags, library_id: null, favorited: false });
        showToast('Saved as new in My Templates');
      } else {
        const newLibId = libraryId === '' ? null : (libraryId || null);
        await updateTemplate(currentEditingId, { title, body, category, tags, library_id: newLibId, favorited });
        // Handle move if library changed
        if (newLibId !== existing?.library_id) {
          await moveTemplate(currentEditingId, newLibId);
        }
        showToast('Changes saved');
      }
    } else {
      const newLibId = libraryId === '' ? null : (libraryId || null);
      await addTemplate({ title, body, category, tags, library_id: newLibId, favorited });
      showToast('Template saved');
    }
    await refreshAll();
    switchView('view-main');
  } catch (err) {
    console.error(err);
    alert('Failed to save. Storage quota might be exceeded.');
  }
});

document.getElementById('btn-delete-template')?.addEventListener('click', async () => {
  if (!currentEditingId) return;
  if (!confirm('Delete this template?')) return;
  try {
    await deleteTemplate(currentEditingId);
    showToast('Template deleted');
    switchView('view-main');
  } catch (err) {
    console.error(err);
    alert('Failed to delete template.');
  }
});

// ── Search (My Templates tab) ────────────────────────
document.getElementById('search-input')?.addEventListener('input', e => {
  tabState.my.search = e.target.value;
  document.getElementById('btn-search-clear')?.classList.toggle('hidden', !e.target.value);
  renderMyTemplatesPanel();
  updateSettings({ my_tab_search: tabState.my.search });
});

document.getElementById('btn-search-clear')?.addEventListener('click', () => {
  tabState.my.search = '';
  const input = document.getElementById('search-input');
  if (input) { input.value = ''; input.focus(); }
  document.getElementById('btn-search-clear')?.classList.add('hidden');
  renderMyTemplatesPanel();
  updateSettings({ my_tab_search: '' });
});

// ── Tabs ────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.disabled) return;
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');

    const id = tab.dataset.tab;
    document.getElementById('panel-my')?.classList.toggle('hidden', id !== 'my');
    document.getElementById('panel-my')?.classList.toggle('active', id === 'my');
    document.getElementById('panel-libs')?.classList.toggle('hidden', id !== 'libs');
    document.getElementById('panel-libs')?.classList.toggle('active', id === 'libs');
    document.getElementById('my-fab-wrap')?.classList.toggle('hidden', id !== 'my');

    if (id === 'my') {
      renderMyTemplatesPanel();
    } else {
      if (currentLibraryId) renderLibraryDetail(currentLibraryId);
      else renderLibraryListPanel();
    }
  });
});

// ── Settings ────────────────────────────────────────
document.getElementById('btn-settings')?.addEventListener('click', () => switchView('view-settings'));
document.getElementById('btn-close-settings')?.addEventListener('click', () => {
  if (isDormantMode && urlParams.get('view') === 'settings') {
    window.location.href = 'dormant.html';
  } else {
    switchView('view-main');
  }
});

function populateSettingsForm(settings) {
  const themeSelect = document.getElementById('setting-theme');
  if (themeSelect) themeSelect.value = settings.theme_override || 'navy';

  const catInput = document.getElementById('setting-category');
  if (catInput) catInput.value = settings.default_category || 'General';

  const inlineChk = document.getElementById('setting-inline');
  if (inlineChk) inlineChk.checked = !!settings.inline_overlay_enabled;

  const badgesChk = document.getElementById('setting-badges');
  if (badgesChk) badgesChk.checked = settings.show_badges !== false;
}

function initThemeOptions(currentTheme) {
  const container = document.getElementById('theme-options');
  if (!container) return;
  container.innerHTML = '';
  THEME_OPTIONS.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `theme-row${currentTheme === opt.id ? ' selected' : ''}`;
    btn.dataset.theme = opt.id;
    btn.innerHTML = `
      <div class="theme-swatch" aria-hidden="true">
        <span style="background:${opt.swatch[0]}"></span>
        <span style="background:${opt.swatch[1]}"></span>
        <span class="theme-swatch-accent" style="background:${opt.swatch[2]}"></span>
      </div>
      <div class="theme-row-info">
        <div class="theme-row-label">${escHtml(opt.label)}</div>
        <div class="theme-row-hint">${escHtml(opt.hint)}</div>
      </div>
      <div class="theme-radio" aria-hidden="true">
        ${currentTheme === opt.id ? `<svg width="10" height="10"><use href="#ic-check"/></svg>` : ''}
      </div>`;
    btn.addEventListener('click', () => selectTheme(opt.id));
    container.appendChild(btn);
  });
}

function selectTheme(id) {
  document.querySelectorAll('.theme-row').forEach(row => {
    const sel = row.dataset.theme === id;
    row.classList.toggle('selected', sel);
    const radio = row.querySelector('.theme-radio');
    if (radio) radio.innerHTML = sel ? `<svg width="10" height="10"><use href="#ic-check"/></svg>` : '';
  });
  const sel = document.getElementById('setting-theme');
  if (sel) { sel.value = id; sel.dispatchEvent(new Event('change')); }
  applyThemeOverride(id);
  updateSettings({ theme_override: id });
}

function initDensityOptions(current) {
  const container = document.getElementById('density-options');
  if (!container) return;
  const opts = [
    { id: 'cozy',    label: 'Cozy',    hint: 'With description preview', rows: [false, false], cozy: true },
    { id: 'compact', label: 'Compact', hint: 'More on screen',           rows: [false, false, false], cozy: false },
  ];
  opts.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `density-card${current === opt.id ? ' selected' : ''}`;
    btn.dataset.density = opt.id;
    const rowsHtml = opt.rows.map(() =>
      `<div class="density-mock-row${opt.cozy ? ' cozy' : ''}">
        <div class="density-mock-dot"></div>
        <div class="density-mock-line"></div>
      </div>`
    ).join('');
    btn.innerHTML = `
      <div class="density-preview" aria-hidden="true">${rowsHtml}</div>
      <div class="density-card-footer">
        <div>
          <div class="density-label">${opt.label}</div>
          <div class="density-hint">${opt.hint}</div>
        </div>
        <div class="density-radio">
          ${current === opt.id ? `<svg width="9" height="9"><use href="#ic-check"/></svg>` : ''}
        </div>
      </div>`;
    btn.addEventListener('click', () => selectDensity(opt.id));
    container.appendChild(btn);
  });
}

function selectDensity(id) {
  activeDensity = id;
  document.querySelectorAll('.density-card').forEach(card => {
    const sel = card.dataset.density === id;
    card.classList.toggle('selected', sel);
    const radio = card.querySelector('.density-radio');
    if (radio) radio.innerHTML = sel ? `<svg width="9" height="9"><use href="#ic-check"/></svg>` : '';
  });
  updateSettings({ density: id });
  refreshList();
}

// Behavior toggles — auto-save on change
document.getElementById('setting-badges')?.addEventListener('change', async e => {
  showBadges = e.target.checked;
  await updateSettings({ show_badges: showBadges });
  refreshList();
});

document.getElementById('setting-inline')?.addEventListener('change', async e => {
  await updateSettings({ inline_overlay_enabled: e.target.checked });
});

document.getElementById('setting-category')?.addEventListener('change', async e => {
  await updateSettings({ default_category: e.target.value.trim() });
});

// ── Backup & Restore ────────────────────────────────
document.getElementById('btn-open-backup')?.addEventListener('click', () => switchView('view-backup'));
document.getElementById('btn-close-backup')?.addEventListener('click', () => switchView('view-settings'));

document.getElementById('btn-export-templates')?.addEventListener('click', async () => {
  const scopeEl = document.querySelector('input[name="export-scope"]:checked');
  const scope   = scopeEl?.value || 'my';
  const envelope = await buildExport(scope);
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `prompt-pocket-${scope}-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── Full-backup import (Backup & Restore view) ───────
const fileImport = document.getElementById('file-import');
document.getElementById('btn-import-templates')?.addEventListener('click', () => fileImport?.click());

fileImport?.addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const raw = JSON.parse(ev.target.result);
      const { templates: importedTemplates, libraries: importedLibs } = parseExportEnvelope(raw);
      const current = await getTemplates();
      const merged  = [...current];
      let count = 0;
      for (const imp of importedTemplates) {
        if (imp?.id && imp.title && imp.body) {
          const idx = merged.findIndex(t => t.id === imp.id);
          if (idx !== -1) merged[idx] = imp; else merged.push(imp);
          count++;
        }
      }
      await restoreTemplates(merged);
      // Restore library metadata that doesn't already exist
      if (importedLibs.length) {
        const existingLibs = await getLibraries();
        for (const lib of importedLibs) {
          if (!existingLibs.find(l => l.id === lib.id)) {
            await createLibrary(lib.name);
          }
        }
      }
      await refreshAll();
      showToast(`${count} template${count !== 1 ? 's' : ''} imported`);
      switchView('view-main');
    } catch (err) {
      alert('Failed to parse file. ' + err.message);
    } finally {
      e.target.value = '';
    }
  };
  reader.onerror = () => alert('Could not read file.');
  reader.readAsText(file);
});

async function renderAutoBackups() {
  const listEl = document.getElementById('auto-backups-list');
  if (!listEl) return;
  const backups = await getAutoBackups();
  if (!backups.length) {
    listEl.innerHTML = '<div class="backup-hint">No auto-backups yet.</div>';
    return;
  }
  listEl.innerHTML = '';
  backups.forEach((backup, i) => {
    const d = new Date(backup.timestamp);
    const el = document.createElement('div');
    el.className = 'backup-item';
    el.innerHTML = `
      <div>
        <div class="backup-item-title">Snapshot ${i + 1}</div>
        <div class="backup-item-meta">${d.toLocaleString()} · ${backup.templates.length} items</div>
      </div>
      <button type="button" class="btn-ghost-sm">Restore</button>`;
    el.querySelector('button').addEventListener('click', async () => {
      if (!confirm('Restore this snapshot? Current templates will be overwritten (a backup is saved first).')) return;
      await restoreTemplates(backup.templates);
      showToast('Backup restored');
      switchView('view-main');
    });
    listEl.appendChild(el);
  });
}

// ── Theme & health (Phase 1) ────────────────────────
function applyThemeOverride(override) {
  if (override === 'parchment') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else if (override === 'follow') {
    chrome.storage.local.get(['extension_theme'], result => {
      if (result.extension_theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    });
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'THEME_CHANGE') {
    chrome.storage.local.get(['settings'], data => {
      const override = data.settings?.theme_override || 'navy';
      if (override === 'follow') applyThemeOverride('follow');
    });
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.selector_health) {
    updateHealthBanner(changes.selector_health.newValue);
  }
});

chrome.storage.local.get(['selector_health'], result => {
  if (result.selector_health) updateHealthBanner(result.selector_health);
});

function updateHealthBanner(healthData) {
  if (isDormantMode) return;
  const banner = document.getElementById('health-banner');
  if (!banner) return;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs?.length) return;
    const url = tabs[0].url;
    let host = null;
    if (url?.includes('chatgpt.com') || url?.includes('chat.openai.com')) host = 'chatgpt.com';
    else if (url?.includes('copilot.microsoft.com')) host = 'copilot.microsoft.com';
    if (!host || !healthData[host]) { banner.className = 'banner'; return; }
    const h = healthData[host];
    banner.className = 'banner';
    if (!h.any_input_match) {
      banner.classList.add('error');
      banner.textContent = 'Cannot find the AI\'s input box — please update the extension.';
    } else if (!h.primary_match) {
      banner.classList.add('warning');
      banner.textContent = 'Using fallback input selector — extension may need an update soon.';
    }
  });
}

// ── Dormant UI handlers ─────────────────────────────
document.getElementById('btn-open-chatgpt')?.addEventListener('click', () => chrome.tabs.create({ url: 'https://chatgpt.com' }));
document.getElementById('btn-open-copilot')?.addEventListener('click', () => chrome.tabs.create({ url: 'https://copilot.microsoft.com' }));
document.getElementById('btn-manage-templates')?.addEventListener('click', () => { window.location.href = 'sidepanel.html?source=dormant'; });
document.getElementById('btn-settings-dormant')?.addEventListener('click', () => { window.location.href = 'sidepanel.html?view=settings&source=dormant'; });
document.getElementById('btn-back-dormant')?.addEventListener('click', () => { window.location.href = 'dormant.html'; });

// ── Helpers ─────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function initLibraryPackState() {
  // Preserve state if already initialized
  if (libraryPackState.length !== LIBRARY_PACKS.length) {
    libraryPackState = LIBRARY_PACKS.map(p => ({ ...p }));
  }
}

// ════════════════════════════════════════════════════
// BULK IMPORT
// ════════════════════════════════════════════════════

// ── Field alias map ─────────────────────────────────
const FIELD_ALIASES = {
  title:    ['title', 'name'],
  body:     ['body', 'prompt', 'content', 'text'],
  category: ['category', 'cat', 'type'],
  tags:     ['tags', 'tag', 'labels', 'keywords'],
};

function resolveField(obj, aliases) {
  for (const alias of aliases) {
    // Exact match
    if (obj[alias] !== undefined && obj[alias] !== null && String(obj[alias]).trim() !== '') {
      return obj[alias];
    }
    // Case-insensitive match
    const key = Object.keys(obj).find(k => k.toLowerCase() === alias.toLowerCase());
    if (key && obj[key] !== undefined && String(obj[key]).trim() !== '') return obj[key];
  }
  return undefined;
}

function normaliseRow(raw, rowIndex) {
  const title    = resolveField(raw, FIELD_ALIASES.title);
  const body     = resolveField(raw, FIELD_ALIASES.body);
  let   category = resolveField(raw, FIELD_ALIASES.category);
  let   tags     = resolveField(raw, FIELD_ALIASES.tags);

  // Normalise category to a known id
  if (category) {
    const slug = String(category).toLowerCase().trim();
    const exact = CATEGORIES.find(c => c.id === slug);
    const byLabel = CATEGORIES.find(c => c.label.toLowerCase() === slug);
    category = (exact || byLabel)?.id || undefined;
  }

  // Normalise tags to string[]
  if (typeof tags === 'string') {
    tags = tags.split(',').map(t => t.trim()).filter(Boolean);
  } else if (!Array.isArray(tags)) {
    tags = [];
  } else {
    tags = tags.map(String).filter(Boolean);
  }

  return {
    _row: rowIndex,
    title:    typeof title === 'string' ? title.trim() : title,
    body:     typeof body  === 'string' ? body.trim()  : body,
    category: category || undefined,
    tags,
  };
}

// ── Parsers ─────────────────────────────────────────
function parseImportJSON(text) {
  const data = JSON.parse(text); // throws on bad JSON
  if (!Array.isArray(data)) throw new Error('JSON must be an array of objects.');
  if (data.length === 0)    throw new Error('JSON array is empty — nothing to import.');
  return data.map((item, i) => normaliseRow(item || {}, i + 1));
}

function parseImportCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV needs a header row plus at least one data row.');

  const headers = splitCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  if (headers.length === 0) throw new Error('CSV header row is empty.');

  return lines.slice(1)
    .filter(l => l.trim()) // skip blank lines
    .map((line, i) => {
      const vals = splitCSVLine(line);
      const raw  = Object.fromEntries(headers.map((h, idx) => [h, vals[idx] ?? '']));
      return normaliseRow(raw, i + 2); // +2: row 1 is header
    });
}

function splitCSVLine(line) {
  const cells = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      cells.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

function detectFormat(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'json') return 'json';
  if (ext === 'csv')  return 'csv';
  return null;
}

// ── Partition into valid / invalid ──────────────────
function partitionRows(rows) {
  const valid = [], invalid = [];
  rows.forEach(row => {
    const errors = [];
    if (!row.title?.trim()) errors.push('missing title');
    if (!row.body?.trim())  errors.push('missing body');
    (errors.length ? invalid : valid).push({ ...row, _errors: errors });
  });
  return { valid, invalid };
}

// ── Apply import-level defaults (fill gaps only) ────
function applyImportDefaults(rows, defaults) {
  return rows.map(row => ({
    ...row,
    category: row.category || defaults.category || 'general',
    tags:     (row.tags?.length ? row.tags : (defaults.tags || [])),
  }));
}

// ── Conflict detection ───────────────────────────────
function detectImportConflicts(rows, existing) {
  const conflicts = [], clean = [];
  rows.forEach(row => {
    const match = existing.find(
      t => t.title?.trim().toLowerCase() === row.title.trim().toLowerCase()
    );
    if (match) conflicts.push({ incoming: row, existing: match });
    else       clean.push(row);
  });
  return { conflicts, clean };
}

// ── Import state ─────────────────────────────────────
let importParsedValid = [];

// ── Entry point — file picker ────────────────────────
document.getElementById('btn-bulk-import')?.addEventListener('click', () => {
  document.getElementById('file-bulk-import')?.click();
});

document.getElementById('file-bulk-import')?.addEventListener('change', e => {
  const file = e.target.files?.[0];
  e.target.value = ''; // reset so same file can be re-selected
  if (!file) return;

  const fmt = detectFormat(file.name);
  if (!fmt) {
    showImportParseError('Unrecognised file type. Please use a .json or .csv file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const rows = fmt === 'json'
        ? parseImportJSON(ev.target.result)
        : parseImportCSV(ev.target.result);
      const { valid, invalid } = partitionRows(rows);
      importParsedValid = valid;
      openImportReview(valid, invalid);
    } catch (err) {
      showImportParseError(err.message);
    }
  };
  reader.onerror = () => showImportParseError('Could not read the file.');
  reader.readAsText(file);
});

function showImportParseError(msg) {
  // Show inline under the Import button in Settings
  const existing = document.getElementById('import-parse-error');
  if (existing) existing.remove();
  const p = document.createElement('p');
  p.id = 'import-parse-error';
  p.className = 'import-parse-error';
  p.textContent = msg;
  document.getElementById('btn-bulk-import')?.insertAdjacentElement('afterend', p);
}

// ── Review screen ────────────────────────────────────
function openImportReview(valid, invalid) {
  // Summary bar
  document.getElementById('import-valid-count').textContent = `${valid.length} valid`;
  const invalEl = document.getElementById('import-invalid-count');
  if (invalid.length > 0) {
    invalEl.textContent = `${invalid.length} invalid`;
    invalEl.classList.remove('hidden');
    document.getElementById('import-invalid-badge').textContent = invalid.length;
    document.getElementById('import-invalid-section')?.classList.remove('hidden');
  } else {
    invalEl.classList.add('hidden');
    document.getElementById('import-invalid-section')?.classList.add('hidden');
  }

  document.getElementById('btn-confirm-import').disabled = valid.length === 0;

  // Reset category default
  document.getElementById('import-default-category').value = '';
  initImportCategoryChips();

  // Reset tag chips
  importTagChips = [];
  renderImportTagChips();

  // Reset destination to My Templates
  const myRadio = document.getElementById('import-dest-my');
  if (myRadio) myRadio.checked = true;
  document.getElementById('import-new-lib-wrap')?.classList.add('hidden');
  document.getElementById('import-existing-lib-wrap')?.classList.add('hidden');
  document.getElementById('import-lib-name-error')?.classList.add('hidden');
  document.getElementById('import-new-lib-name') && (document.getElementById('import-new-lib-name').value = '');

  // Populate existing library dropdown (hide option if no libraries)
  const existingOption = document.getElementById('import-dest-existing-option');
  const existingSel    = document.getElementById('import-existing-lib-select');
  if (existingOption) existingOption.classList.toggle('hidden', allLibraries.length === 0);
  if (existingSel)    existingSel.innerHTML = allLibraries
    .map(l => `<option value="${l.id}">${escHtml(l.name)}</option>`).join('');

  updateImportConfirmLabel();

  renderImportValidList(valid);
  renderImportInvalidList(invalid);
  switchView('view-import-review');
}

function initImportCategoryChips() {
  const grid = document.getElementById('import-category-chips');
  if (!grid) return;
  grid.innerHTML = '';
  // "None" option first
  const noneBtn = document.createElement('button');
  noneBtn.type = 'button';
  noneBtn.className = 'cat-chip active'; // default = none selected
  noneBtn.dataset.id = '';
  noneBtn.textContent = 'None (keep per-prompt)';
  noneBtn.addEventListener('click', () => setImportDefaultCategory(''));
  grid.appendChild(noneBtn);

  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-chip';
    btn.dataset.id = cat.id;
    btn.dataset.color = cat.color;
    btn.innerHTML = `<span style="width:5px;height:5px;border-radius:50%;background:${cat.color}"></span>${escHtml(cat.label)}`;
    btn.addEventListener('click', () => setImportDefaultCategory(cat.id));
    grid.appendChild(btn);
  });
}

function setImportDefaultCategory(id) {
  document.getElementById('import-default-category').value = id;
  document.querySelectorAll('#import-category-chips .cat-chip').forEach(chip => {
    const sel = chip.dataset.id === id;
    chip.classList.toggle('active', sel);
    if (chip.dataset.color) {
      chip.style.color       = sel ? chip.dataset.color : '';
      chip.style.borderColor = sel ? `${chip.dataset.color}55` : '';
      chip.style.background  = sel ? `${chip.dataset.color}22` : '';
    }
  });
}

function renderImportValidList(rows) {
  const list = document.getElementById('import-valid-list');
  if (!list) return;
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  rows.forEach(row => {
    const cat = categoryOf(row.category);
    const badgeHtml = row.category
      ? `<span class="cat-badge" style="background:${cat.color}22;border:0.5px solid ${cat.color}55;color:${cat.color}">
           <span class="cat-badge-dot" style="background:${cat.color}"></span>${escHtml(cat.label)}
         </span>`
      : '';
    const tagsHtml = (row.tags || []).length
      ? row.tags.map(t => `<span class="conflict-tag">${escHtml(t)}</span>`).join('')
      : '';

    const el = document.createElement('div');
    el.className = 'import-row-valid';
    el.setAttribute('role', 'listitem');
    el.innerHTML = `
      <span class="import-row-valid-num">${row._row}</span>
      <div class="import-row-valid-body">
        <div class="import-row-title">${escHtml(row.title)}</div>
        <div class="import-row-meta">
          ${badgeHtml}
          ${tagsHtml ? `<div class="conflict-tags">${tagsHtml}</div>` : ''}
        </div>
        <div class="import-row-preview">${escHtml((row.body || '').substring(0, 50))}${(row.body || '').length > 50 ? '…' : ''}</div>
      </div>`;
    frag.appendChild(el);
  });
  list.appendChild(frag);
}

function renderImportInvalidList(rows) {
  const list = document.getElementById('import-invalid-list');
  if (!list) return;
  list.innerHTML = '';
  if (!rows.length) return;
  const frag = document.createDocumentFragment();
  rows.forEach(row => {
    const el = document.createElement('div');
    el.className = 'import-row-invalid';
    el.setAttribute('role', 'listitem');
    el.innerHTML = `
      <span class="import-row-invalid-icon">
        <svg width="14" height="14" aria-hidden="true"><use href="#ic-alert"/></svg>
      </span>
      <div>
        <div class="import-row-title">${row.title ? escHtml(row.title) : `<em style="color:var(--text-mute)">Row ${row._row} — no title</em>`}</div>
        <div class="import-row-error">${(row._errors || []).join(' · ')}</div>
      </div>`;
    frag.appendChild(el);
  });
  list.appendChild(frag);
}

document.getElementById('btn-back-import')?.addEventListener('click', () => switchView('view-settings'));
document.getElementById('btn-cancel-import')?.addEventListener('click', () => switchView('view-settings'));

document.getElementById('btn-confirm-import')?.addEventListener('click', async () => {
  // Resolve destination
  const destRadio = document.querySelector('input[name="import-dest"]:checked')?.value || 'my';
  let targetLibraryId = null;

  if (destRadio === 'new') {
    const name = document.getElementById('import-new-lib-name')?.value.trim();
    if (!name) {
      document.getElementById('import-lib-name-error')?.classList.remove('hidden');
      return;
    }
    if (allLibraries.find(l => l.name.toLowerCase() === name.toLowerCase())) {
      document.getElementById('import-lib-name-error').textContent = 'A library with that name already exists.';
      document.getElementById('import-lib-name-error')?.classList.remove('hidden');
      return;
    }
    const lib = await createLibrary(name);
    allLibraries.push(lib);
    targetLibraryId = lib.id;
  } else if (destRadio === 'existing') {
    targetLibraryId = document.getElementById('import-existing-lib-select')?.value || null;
  }

  const defaultCat  = document.getElementById('import-default-category')?.value || '';
  const defaultTags = importTagChips.slice(); // built by tag chip builder

  const withDefaults = applyImportDefaults(importParsedValid, { category: defaultCat, tags: defaultTags });
  await runImport(withDefaults, targetLibraryId);
});

// ── Run the import with conflict resolution ──────────
async function runImport(rows, targetLibraryId = null) {
  const confirmBtn = document.getElementById('btn-confirm-import');
  if (confirmBtn) confirmBtn.disabled = true;

  // Conflict detection: only check against the target destination
  const destTemplates = allTemplates.filter(t =>
    targetLibraryId ? t.library_id === targetLibraryId : t.library_id === null
  );
  const { conflicts, clean } = detectImportConflicts(rows, destTemplates);

  let imported = 0, skipped = 0;

  for (const row of clean) {
    await addTemplate({ title: row.title, body: row.body, category: row.category,
                        tags: row.tags, library_id: targetLibraryId });
    imported++;
  }

  if (conflicts.length > 0) {
    const resolutions = await resolveConflictsSequentially(conflicts);
    for (const r of resolutions) {
      if (r.choice === 'skip') {
        skipped++;
      } else if (r.choice === 'overwrite') {
        await updateTemplate(r.existing.id, {
          title: r.incoming.title, body: r.incoming.body,
          category: r.incoming.category, tags: r.incoming.tags,
        });
        imported++;
      } else {
        await addTemplate({ title: r.incoming.title, body: r.incoming.body,
                            category: r.incoming.category, tags: r.incoming.tags,
                            library_id: targetLibraryId });
        imported++;
      }
    }
  }

  hideConflictModal();
  await refreshAll();
  switchView('view-main');
  showToast(`${imported} imported${skipped > 0 ? `, ${skipped} skipped` : ''}`);
}

// ── Conflict modal — Promise-based sequential flow ───
function resolveConflictsSequentially(conflicts) {
  return new Promise(resolve => {
    const resolutions = [];
    let batchChoice   = null; // set when "apply to all" is checked
    let index = 0;

    function next() {
      if (index >= conflicts.length) {
        resolve(resolutions);
        return;
      }

      if (batchChoice) {
        // Apply the batch choice to all remaining without showing the modal
        for (let i = index; i < conflicts.length; i++) {
          resolutions.push({ ...conflicts[i], choice: batchChoice });
        }
        resolve(resolutions);
        return;
      }

      const conflict = conflicts[index];
      const remaining = conflicts.length - index;
      showConflictModal(conflict, remaining, (choice, applyAll) => {
        resolutions.push({ ...conflict, choice });
        if (applyAll) batchChoice = choice;
        index++;
        next();
      });
    }

    next();
  });
}

function showConflictModal(conflict, remaining, onChoice) {
  const modal = document.getElementById('conflict-modal');
  if (!modal) return;

  // Subtitle
  document.getElementById('conflict-remaining').textContent =
    remaining > 1 ? `${remaining} conflicts remaining` : '1 conflict remaining';

  // Helper to populate one side
  function populateSide(prefix, t) {
    document.getElementById(`conflict-${prefix}-title`).textContent = t.title || '';
    document.getElementById(`conflict-${prefix}-body`).textContent  =
      (t.body || '').substring(0, 30) + ((t.body || '').length > 30 ? '…' : '');

    const cat    = categoryOf(t.category);
    const catEl  = document.getElementById(`conflict-${prefix}-cat`);
    catEl.style.cssText = `background:${cat.color}22;border:0.5px solid ${cat.color}55;color:${cat.color}`;
    catEl.innerHTML     = `<span class="cat-badge-dot" style="background:${cat.color}"></span>${escHtml(cat.label)}`;

    const tagsEl = document.getElementById(`conflict-${prefix}-tags`);
    tagsEl.innerHTML = (t.tags || [])
      .map(tag => `<span class="conflict-tag">${escHtml(tag)}</span>`)
      .join('');
  }

  populateSide('existing', conflict.existing);
  populateSide('incoming', conflict.incoming);

  // Reset apply-all checkbox
  const applyAll = document.getElementById('conflict-apply-all');
  if (applyAll) applyAll.checked = false;

  // Wire action buttons — remove old listeners by cloning
  function wire(id, choice) {
    const old = document.getElementById(id);
    const btn = old.cloneNode(true);
    old.replaceWith(btn);
    btn.addEventListener('click', () => {
      const all = document.getElementById('conflict-apply-all')?.checked || false;
      hideConflictModal();
      onChoice(choice, all);
    });
  }

  wire('btn-conflict-skip',      'skip');
  wire('btn-conflict-overwrite', 'overwrite');
  wire('btn-conflict-keep',      'keep');

  modal.classList.remove('hidden');
}

function hideConflictModal() {
  document.getElementById('conflict-modal')?.classList.add('hidden');
}

// ── Help dialog ──────────────────────────────────────
document.getElementById('btn-import-help')?.addEventListener('click', () => {
  document.getElementById('help-dialog')?.classList.remove('hidden');
});

document.getElementById('btn-close-help')?.addEventListener('click', () => {
  document.getElementById('help-dialog')?.classList.add('hidden');
});

// Close help on overlay click (outside modal box)
document.getElementById('help-dialog')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.add('hidden');
  }
});

// Help tabs
document.querySelectorAll('.help-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.help-tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.help-content').forEach(c => c.classList.add('hidden'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById(`help-content-${tab.dataset.tab}`)?.classList.remove('hidden');
  });
});

// ── AI Tools settings section ───────────────────────
function getEnabledTools(storedList) {
  if (Array.isArray(storedList)) return storedList;
  return AI_TOOLS.filter(t => t.defaultEnabled).map(t => t.id);
}

function initAIToolsSettings(storedList) {
  const container = document.getElementById('ai-tools-list');
  if (!container) return;
  container.innerHTML = '';
  const enabled = getEnabledTools(storedList);

  AI_TOOLS.forEach((tool, idx) => {
    const isLast   = idx === AI_TOOLS.length - 1;
    const isOn     = enabled.includes(tool.id);
    const row      = document.createElement('div');
    row.className  = `setting-row${!isLast ? ' divider' : ''}`;

    if (tool.comingSoon) {
      // Greyed out with a "Soon" badge — no toggle
      row.innerHTML = `
        <div class="setting-info ai-tool-info">
          <span class="ai-tool-dot" style="background:${tool.color}"></span>
          <span class="setting-name ai-tool-name" style="color:var(--text-mute)">${escHtml(tool.label)}</span>
        </div>
        <span class="ai-tool-soon">W.P.F.</span>`;
    } else {
      row.innerHTML = `
        <label class="setting-info ai-tool-info" for="ai-tool-${tool.id}">
          <span class="ai-tool-dot" style="background:${tool.color}"></span>
          <span class="setting-name ai-tool-name">${escHtml(tool.label)}</span>
        </label>
        <label class="switch">
          <input type="checkbox" id="ai-tool-${tool.id}" ${isOn ? 'checked' : ''}>
          <span class="switch-track" aria-hidden="true"></span>
        </label>`;

      row.querySelector('input').addEventListener('change', async () => {
        const allInputs = document.querySelectorAll('#ai-tools-list input[type="checkbox"]');
        const newEnabled = [...allInputs]
          .filter(i => i.checked)
          .map(i => i.id.replace('ai-tool-', ''));
        await updateSettings({ enabled_ai_tools: newEnabled });
        renderDormantButtons(newEnabled);
      });
    }

    container.appendChild(row);
  });
}

// ── Dormant pane — dynamic AI buttons ───────────────
function renderDormantButtons(storedList) {
  const container = document.getElementById('dormant-ai-buttons');
  if (!container) return;
  const enabled = getEnabledTools(storedList);
  const tools   = AI_TOOLS.filter(t => !t.comingSoon && enabled.includes(t.id));
  container.innerHTML = '';

  // Update the hint to name the enabled tools
  const hint = document.getElementById('dormant-hint');
  if (hint) {
    const names = tools.map(t => t.label);
    hint.textContent = tools.length
      ? `Open ${names.join(', ')} to start using your prompt templates.`
      : 'Enable AI tools in Settings to see quick-launch buttons here.';
  }

  tools.forEach((tool, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'listitem');
    btn.className = idx === 0 ? 'btn-primary full-width' : 'btn-ghost full-width btn-centered';
    btn.innerHTML = `
      <span class="ai-tool-dot" style="background:${tool.color};width:8px;height:8px;border-radius:50%;flex-shrink:0"></span>
      Open ${escHtml(tool.label)}`;
    btn.addEventListener('click', () => chrome.tabs.create({ url: tool.url }));
    container.appendChild(btn);
  });
}

// ════════════════════════════════════════════════════
// MY TEMPLATES PANEL
// ════════════════════════════════════════════════════

function renderMyTemplatesPanel() {
  const searchInput = document.getElementById('search-input');
  if (searchInput && searchInput.value !== tabState.my.search) {
    searchInput.value = tabState.my.search;
    document.getElementById('btn-search-clear')?.classList.toggle('hidden', !tabState.my.search);
  }

  const myTemplates = allTemplates.filter(t => t.library_id === null);
  const favourited  = allTemplates.filter(t => t.library_id !== null && t.favorited);
  const combined    = [...myTemplates, ...favourited];

  const allTags = uniqueTags(combined);
  buildTagFilter('my-tag-filter', allTags, tabState.my.tags, tag => {
    if (tag === null) {
      tabState.my.tags = [];
    } else {
      const idx = tabState.my.tags.indexOf(tag);
      if (idx === -1) tabState.my.tags.push(tag);
      else tabState.my.tags.splice(idx, 1);
    }
    updateSettings({ my_tab_tags: tabState.my.tags });
    renderMyTemplatesPanel();
  });

  const filtered = filterTemplates(combined, tabState.my.search, tabState.my.tags);
  showResultCount('my-result-count', filtered.length, combined.length, tabState.my.search, tabState.my.tags);
  renderTemplates(filtered);
}

// ════════════════════════════════════════════════════
// SHARED TAG FILTER
// ════════════════════════════════════════════════════

function buildTagFilter(containerId, allTags, activeTags, onToggle) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  if (!allTags.length) return;

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = `tag-chip${activeTags.length === 0 ? ' active' : ''}`;
  allChip.textContent = 'All';
  allChip.addEventListener('click', () => onToggle(null));
  container.appendChild(allChip);

  allTags.forEach(tag => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tag-chip${activeTags.includes(tag) ? ' active' : ''}`;
    btn.textContent = tag;
    btn.addEventListener('click', () => onToggle(tag));
    container.appendChild(btn);
  });
}

function showResultCount(countId, filtered, total, search, tags) {
  const el = document.getElementById(countId);
  if (!el) return;
  const isFiltered = (search && search.length > 0) || (tags && tags.length > 0);
  if (isFiltered && filtered < total) {
    el.textContent = `Showing ${filtered} of ${total}`;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// ════════════════════════════════════════════════════
// LIBRARY LIST PANEL
// ════════════════════════════════════════════════════

function renderLibraryListPanel() {
  currentLibraryId = null;
  document.getElementById('lib-list-view')?.classList.remove('hidden');
  document.getElementById('lib-detail-view')?.classList.add('hidden');

  const list = document.getElementById('library-list');
  if (!list) return;

  const q       = tabState.lib.search.toLowerCase();
  const sorted  = sortLibraries(allLibraries, libSort);
  const visible = q ? sorted.filter(l => l.name.toLowerCase().includes(q)) : sorted;

  list.innerHTML = '';
  if (!visible.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-state-title">${allLibraries.length ? 'No matches' : 'No libraries yet'}</div>
      <div class="empty-state-hint">${allLibraries.length
        ? 'Try a different search.'
        : 'Import prompts to create a library, or use the button below.'}</div>
    </div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  visible.forEach(lib => {
    const count = allTemplates.filter(t => t.library_id === lib.id).length;
    const el = document.createElement('div');
    el.className = 'library-card';
    el.setAttribute('role', 'listitem');
    el.innerHTML = `
      <div class="library-card-info">
        <div class="library-card-name">${escHtml(lib.name)}</div>
        <div class="library-card-meta">${count} prompt${count !== 1 ? 's' : ''}</div>
      </div>
      <div class="library-card-actions">
        <button type="button" class="btn-ghost-sm lib-enter-btn" data-id="${lib.id}">Open →</button>
        <button type="button" class="icon-btn danger lib-delete-btn" data-id="${lib.id}" aria-label="Delete ${escHtml(lib.name)}">
          <svg width="14" height="14" aria-hidden="true"><use href="#ic-trash"/></svg>
        </button>
      </div>`;
    frag.appendChild(el);
  });
  list.appendChild(frag);

  list.querySelectorAll('.lib-enter-btn').forEach(btn =>
    btn.addEventListener('click', () => renderLibraryDetail(btn.dataset.id))
  );
  list.querySelectorAll('.lib-delete-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
      const lib   = allLibraries.find(l => l.id === btn.dataset.id);
      if (!lib) return;
      const count = allTemplates.filter(t => t.library_id === lib.id).length;
      if (!confirm(`Delete "${lib.name}"? Its ${count} prompt${count !== 1 ? 's' : ''} will be moved to My Templates.`)) return;
      await deleteLibrary(lib.id);
      await refreshAll();
    })
  );
}

function sortLibraries(libs, sort) {
  return [...libs].sort((a, b) => {
    if (sort === 'az')     return a.name.localeCompare(b.name);
    if (sort === 'za')     return b.name.localeCompare(a.name);
    if (sort === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

// ── Library list search ──────────────────────────────
document.getElementById('lib-search-input')?.addEventListener('input', e => {
  tabState.lib.search = e.target.value;
  document.getElementById('btn-lib-search-clear')?.classList.toggle('hidden', !e.target.value);
  renderLibraryListPanel();
});

document.getElementById('btn-lib-search-clear')?.addEventListener('click', () => {
  tabState.lib.search = '';
  const input = document.getElementById('lib-search-input');
  if (input) { input.value = ''; input.focus(); }
  document.getElementById('btn-lib-search-clear')?.classList.add('hidden');
  renderLibraryListPanel();
});

document.getElementById('btn-new-library')?.addEventListener('click', async () => {
  const name = prompt('New library name:')?.trim();
  if (!name) return;
  if (allLibraries.find(l => l.name.toLowerCase() === name.toLowerCase())) {
    alert('A library with that name already exists.'); return;
  }
  const lib = await createLibrary(name);
  allLibraries.push(lib);
  renderLibraryListPanel();
  updateTabCounts();
});

// ════════════════════════════════════════════════════
// LIBRARY DETAIL PANEL
// ════════════════════════════════════════════════════

function renderLibraryDetail(libId) {
  currentLibraryId = libId;
  const lib = allLibraries.find(l => l.id === libId);
  if (!lib) { renderLibraryListPanel(); return; }

  document.getElementById('lib-list-view')?.classList.add('hidden');
  document.getElementById('lib-detail-view')?.classList.remove('hidden');

  const titleEl = document.getElementById('lib-detail-title');
  if (titleEl) titleEl.textContent = lib.name;

  renderLibSortControls(libId);

  const libTemplates = allTemplates.filter(t => t.library_id === libId);
  const allTags      = uniqueTags(libTemplates);

  buildTagFilter('lib-tag-filter', allTags, tabState.lib.detailTags, tag => {
    if (tag === null) {
      tabState.lib.detailTags = [];
    } else {
      const idx = tabState.lib.detailTags.indexOf(tag);
      if (idx === -1) tabState.lib.detailTags.push(tag);
      else tabState.lib.detailTags.splice(idx, 1);
    }
    renderLibraryDetail(libId);
  });

  const filtered = filterTemplates(libTemplates, tabState.lib.detailSearch, tabState.lib.detailTags);
  showResultCount('lib-result-count', filtered.length, libTemplates.length,
                  tabState.lib.detailSearch, tabState.lib.detailTags);
  renderLibraryTemplateCards(filtered, libId);
}

function renderLibraryTemplateCards(templates, libId) {
  const list = document.getElementById('lib-template-list');
  if (!list) return;
  list.innerHTML = '';

  if (!templates.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-state-title">No prompts here</div>
      <div class="empty-state-hint">Use the button below to add one, or import to this library.</div>
    </div>`;
    return;
  }

  const densityClass = activeDensity === 'cozy' ? '' : 'density-compact';
  list.className = `scroll-area ${densityClass}`;

  const frag = document.createDocumentFragment();
  templates.forEach(t => {
    const cat    = categoryOf(t.category);
    const card   = document.createElement('div');
    card.className   = 'template-card';
    card.dataset.id  = t.id;
    card.setAttribute('role', 'listitem');

    const preview  = t.body?.split('\n')[0] || '';
    const badgeHtml = showBadges
      ? `<span class="cat-badge" style="background:${cat.color}22;border:0.5px solid ${cat.color}55;color:${cat.color}">
           <span class="cat-badge-dot" style="background:${cat.color}"></span>${escHtml(cat.label)}
         </span>`
      : '';
    const tagsHtml = (t.tags || []).map(tg =>
      `<span class="conflict-tag">${escHtml(tg)}</span>`
    ).join('');

    card.innerHTML = `
      <div class="template-card-inner">
        <div class="template-card-body">
          <div class="template-card-title-row">
            <span class="template-title">${escHtml(t.title)}</span>
          </div>
          <div class="template-preview">${escHtml(preview)}</div>
          <div class="template-card-meta">
            ${badgeHtml}
            ${tagsHtml ? `<div class="conflict-tags">${tagsHtml}</div>` : ''}
          </div>
        </div>
        <div class="lib-card-actions">
          <button type="button"
                  class="lib-fav-btn icon-btn${t.favorited ? ' fav-active' : ''}"
                  data-id="${t.id}"
                  title="${t.favorited ? 'Remove from My Templates' : 'Show in My Templates'}"
                  aria-label="${t.favorited ? 'Remove from My Templates' : 'Show in My Templates'}">
            <svg width="14" height="14" aria-hidden="true"><use href="${t.favorited ? '#ic-star' : '#ic-star-outline'}"/></svg>
          </button>
          <button type="button" class="template-edit-btn" data-id="${t.id}" aria-label="Edit ${escHtml(t.title)}">
            <svg width="14" height="14" aria-hidden="true"><use href="#ic-pencil"/></svg>
          </button>
        </div>
      </div>`;
    frag.appendChild(card);
  });
  list.appendChild(frag);

  list.querySelectorAll('.lib-fav-btn').forEach(btn =>
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await toggleFavourite(btn.dataset.id);
      allTemplates = await getTemplates();
      updateTabCounts();
      renderLibraryDetail(libId);
    })
  );

  list.querySelectorAll('.template-card').forEach(card =>
    card.addEventListener('click', e => {
      if (e.target.closest('.lib-fav-btn') || e.target.closest('.template-edit-btn')) return;
      const t = allTemplates.find(x => x.id === card.dataset.id);
      if (!t) return;
      if (extractVars(t.body).length === 0) insertTextToHost(t.body);
      else openUseView(card.dataset.id);
    })
  );

  list.querySelectorAll('.template-edit-btn').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openForm(btn.dataset.id);
    })
  );
}

// ── Sort controls ────────────────────────────────────
const LIB_SORTS = [
  { id: 'newest', symbol: '↓N', title: 'Newest first' },
  { id: 'oldest', symbol: '↑N', title: 'Oldest first' },
  { id: 'az',     symbol: 'Az', title: 'A → Z'        },
  { id: 'za',     symbol: 'Za', title: 'Z → A'        },
];

function renderLibSortControls(libId) {
  const container = document.getElementById('lib-sort-controls');
  if (!container) return;
  // Rebuild every time so active class stays in sync
  container.innerHTML = '';
  LIB_SORTS.forEach(s => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sort-btn${libSort === s.id ? ' active' : ''}`;
    btn.dataset.sort = s.id;
    btn.title = s.title;
    btn.textContent = s.symbol;
    btn.addEventListener('click', async () => {
      libSort = s.id;
      await updateSettings({ library_sort: libSort });
      renderLibraryDetail(libId);
    });
    container.appendChild(btn);
  });
}

// ── Library detail navigation ─────────────────────────
document.getElementById('lib-detail-search')?.addEventListener('input', e => {
  tabState.lib.detailSearch = e.target.value;
  document.getElementById('btn-lib-detail-clear')?.classList.toggle('hidden', !e.target.value);
  if (currentLibraryId) renderLibraryDetail(currentLibraryId);
});

document.getElementById('btn-lib-detail-clear')?.addEventListener('click', () => {
  tabState.lib.detailSearch = '';
  const input = document.getElementById('lib-detail-search');
  if (input) { input.value = ''; input.focus(); }
  document.getElementById('btn-lib-detail-clear')?.classList.add('hidden');
  if (currentLibraryId) renderLibraryDetail(currentLibraryId);
});

document.getElementById('btn-back-lib')?.addEventListener('click', () => {
  currentLibraryId          = null;
  tabState.lib.detailSearch = '';
  tabState.lib.detailTags   = [];
  renderLibraryListPanel();
});

document.getElementById('btn-new-in-lib')?.addEventListener('click', () => openForm(null, currentLibraryId));

// ════════════════════════════════════════════════════
// IMPORT TAG CHIP BUILDER
// ════════════════════════════════════════════════════

let importTagChips = [];

function renderImportTagChips() {
  const container = document.getElementById('import-tag-chips');
  if (!container) return;
  container.innerHTML = '';
  importTagChips.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'import-added-tag';
    chip.innerHTML = `${escHtml(tag)}<button type="button" class="import-tag-remove" aria-label="Remove ${escHtml(tag)}">×</button>`;
    chip.querySelector('.import-tag-remove').addEventListener('click', () => {
      importTagChips = importTagChips.filter(t => t !== tag);
      renderImportTagChips();
    });
    container.appendChild(chip);
  });
}

function addImportTag(raw) {
  const tag = raw.trim().toLowerCase();
  if (!tag || importTagChips.includes(tag)) return;
  importTagChips.push(tag);
  renderImportTagChips();
  const input = document.getElementById('import-tag-input');
  if (input) input.value = '';
}

document.getElementById('btn-add-import-tag')?.addEventListener('click', () =>
  addImportTag(document.getElementById('import-tag-input')?.value || '')
);

document.getElementById('import-tag-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addImportTag(e.target.value); }
});

// ════════════════════════════════════════════════════
// IMPORT DESTINATION HANDLERS
// ════════════════════════════════════════════════════

document.querySelectorAll('input[name="import-dest"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.getElementById('import-new-lib-wrap')?.classList.toggle('hidden', radio.value !== 'new');
    document.getElementById('import-existing-lib-wrap')?.classList.toggle('hidden', radio.value !== 'existing');
    document.getElementById('import-lib-name-error')?.classList.add('hidden');
    updateImportConfirmLabel();
  });
});

document.getElementById('import-new-lib-name')?.addEventListener('input', () => {
  document.getElementById('import-lib-name-error')?.classList.add('hidden');
  updateImportConfirmLabel();
});

function updateImportConfirmLabel() {
  const label   = document.getElementById('btn-confirm-import-label');
  const destVal = document.querySelector('input[name="import-dest"]:checked')?.value || 'my';
  const libName = document.getElementById('import-new-lib-name')?.value.trim();
  const selEl   = document.getElementById('import-existing-lib-select');
  const selName = selEl?.options[selEl.selectedIndex]?.text || '';
  const count   = importParsedValid.length;

  let dest = 'My Templates';
  if (destVal === 'new' && libName)      dest = `"${libName}"`;
  else if (destVal === 'existing' && selName) dest = `"${selName}"`;

  if (label) label.textContent = `Import ${count} to ${dest}`;
}

// ── Update check ────────────────────────────────────
const REPO          = 'trati629/prompt-pocket';
const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours in ms — throttle per session

function parseVersion(tag) {
  return String(tag).replace(/^v/, '').trim();
}

function isNewer(latest, current) {
  const toNums = v => v.split('.').map(n => parseInt(n, 10) || 0);
  const [la, lb, lc] = toNums(latest);
  const [ca, cb, cc] = toNums(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

async function checkForUpdate() {
  try {
    const current = chrome.runtime.getManifest().version;

    // Read cached result — skip fetch if checked recently
    const stored = await new Promise(resolve =>
      chrome.storage.local.get(['update_check'], d => resolve(d.update_check || {}))
    );

    const age = Date.now() - (stored.checked_at || 0);
    if (age < CHECK_INTERVAL && stored.checked_at) {
      // Use cached result without hitting the network
      if (stored.latest && isNewer(stored.latest, current) && !stored.dismissed) {
        showUpdateBar(stored.latest, stored.url);
      }
      return;
    }

    // Fetch latest release from GitHub
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) return; // silently skip if API unavailable

    const data = await res.json();
    const latest = parseVersion(data.tag_name || '');
    const url    = data.html_url || `https://github.com/${REPO}/releases/latest`;

    chrome.storage.local.set({
      update_check: { latest, url, checked_at: Date.now(), dismissed: false }
    });

    if (latest && isNewer(latest, current)) {
      showUpdateBar(latest, url);
    }
  } catch {
    // Network unavailable or API error — fail silently
  }
}

function showUpdateBar(version, url) {
  const bar   = document.getElementById('update-bar');
  const label = document.getElementById('update-bar-label');
  const link  = document.getElementById('update-bar-link');
  if (!bar || !label || !link) return;

  label.textContent = `v${version} available`;
  link.href = url;
  bar.classList.remove('hidden');
  document.body.classList.add('has-update');
}

document.getElementById('btn-dismiss-update')?.addEventListener('click', () => {
  document.getElementById('update-bar')?.classList.add('hidden');
  document.body.classList.remove('has-update');
  // Mark dismissed so it doesn't re-appear this session for the same version
  chrome.storage.local.get(['update_check'], d => {
    if (d.update_check) {
      chrome.storage.local.set({
        update_check: { ...d.update_check, dismissed: true }
      });
    }
  });
});

// ── Bootstrap ───────────────────────────────────────
init();
