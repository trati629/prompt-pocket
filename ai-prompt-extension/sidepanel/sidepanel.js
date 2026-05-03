/**
 * Prompt Pocket — sidepanel/sidepanel.js
 *
 * Handles all UI for the side panel: template CRUD, view-use (variable filling),
 * category chips, libraries tab, settings, backup/restore, health banner, theme.
 */

import {
  initializeStorage,
  getTemplates,
  addTemplate,
  updateTemplate,
  deleteTemplate,
  getSettings,
  updateSettings,
  getAutoBackups,
  restoreTemplates
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

// Theme definitions for settings picker
const THEME_OPTIONS = [
  { id: 'navy',      label: 'Navy',  hint: 'Dark + gold',    swatch: ['#0F1320', '#161B2C', '#C4A974'] },
  { id: 'ink',       label: 'Ink',   hint: 'Near-black',     swatch: ['#0B0B0E', '#15151A', '#D8B96B'] },
  { id: 'parchment', label: 'Light', hint: 'Warm parchment', swatch: ['#F5F0E4', '#FBF7EC', '#8C6B2A'] },
];

// ── State ───────────────────────────────────────────
let allTemplates = [];
let currentEditingId = null;
let currentUseId = null;
let varValues = {};
let activeDensity = 'compact';
let showBadges = true;
let libraryPackState = LIBRARY_PACKS.map(p => ({ ...p }));
let isDormantMode = false;

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
  showBadges = settings.show_badges !== false;

  applyThemeOverride(settings.theme_override || 'navy');
  populateSettingsForm(settings);

  initCategoryChips();
  initThemeOptions(settings.theme_override || 'navy');
  initDensityOptions(activeDensity);
  initLibraryPackState();

  await refreshList();

  if (urlParams.get('view') === 'settings') switchView('view-settings');

  // Update about meta
  const aboutEl = document.getElementById('about-meta');
  if (aboutEl) aboutEl.textContent = `v${chrome.runtime.getManifest().version} · ${allTemplates.length} template${allTemplates.length !== 1 ? 's' : ''}`;

  checkForUpdate();
}

// ── Rendering: template list ────────────────────────
async function refreshList() {
  allTemplates = await getTemplates();
  const tab = document.querySelector('.tab.active')?.dataset.tab || 'my';
  renderTab(tab);
  updateTabCount();
}

function updateTabCount() {
  const el = document.getElementById('tab-count-my');
  if (el) el.textContent = allTemplates.length;
}

function renderTab(tab) {
  if (tab === 'my') {
    const q = document.getElementById('search-input')?.value.toLowerCase() || '';
    const filtered = filterTemplates(allTemplates, q);
    renderTemplates(filtered);
  } else {
    renderLibraries();
  }
}

function filterTemplates(templates, q) {
  if (!q) return [...templates].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  return templates
    .filter(t =>
      t.title?.toLowerCase().includes(q) ||
      t.body?.toLowerCase().includes(q) ||
      (t.tags || []).some(tag => tag.toLowerCase().includes(q)) ||
      categoryOf(t.category).label.toLowerCase().includes(q)
    )
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
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

    card.innerHTML = `
      <div class="template-card-inner">
        <div class="template-card-body">
          <div class="template-card-title-row">
            ${t.pinned ? `<svg class="template-pin" width="10" height="10" aria-hidden="true"><use href="#ic-pin"/></svg>` : ''}
            <span class="template-title">${escHtml(t.title)}</span>
          </div>
          <div class="template-preview">${escHtml(preview)}</div>
          <div class="template-card-meta">
            ${badgeHtml}
            <span class="template-meta-text">${(t.uses || 0)} uses${metaDate ? ' · ' + metaDate : ''}</span>
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
async function openForm(templateId = null) {
  currentEditingId = templateId;
  const btnDelete = document.getElementById('btn-delete-template');
  const titleInput = document.getElementById('template-title');
  const bodyInput = document.getElementById('template-body');

  if (templateId) {
    document.getElementById('form-title').textContent = 'Edit Template';
    const t = allTemplates.find(x => x.id === templateId);
    if (t) {
      titleInput.value = t.title;
      setSelectedCategory(t.category || 'general');
      bodyInput.value = t.body;
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
    btnDelete?.classList.add('hidden');
  }

  updateDetectedVars(bodyInput.value);
  switchView('view-form');
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
  const title = document.getElementById('template-title')?.value.trim();
  const body = document.getElementById('template-body')?.value.trim();
  if (!title || !body) { alert('Title and Body are required.'); return; }

  const category = document.getElementById('template-category')?.value || 'general';
  const tagsRaw = document.getElementById('template-tags')?.value || '';
  const tags = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);

  try {
    if (currentEditingId) {
      await updateTemplate(currentEditingId, { title, body, category, tags });
      showToast('Changes saved');
    } else {
      await addTemplate({ title, body, category, tags });
      showToast('Template saved');
    }
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

// ── Search ──────────────────────────────────────────
document.getElementById('search-input')?.addEventListener('input', e => {
  const q = e.target.value;
  const clear = document.getElementById('btn-search-clear');
  if (clear) clear.classList.toggle('hidden', !q);
  const tab = document.querySelector('.tab.active')?.dataset.tab || 'my';
  if (tab === 'my') renderTemplates(filterTemplates(allTemplates, q.toLowerCase()));
});

document.getElementById('btn-search-clear')?.addEventListener('click', () => {
  const input = document.getElementById('search-input');
  if (input) { input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); }
  document.getElementById('btn-search-clear')?.classList.add('hidden');
});

// ── Tabs ────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');

    const id = tab.dataset.tab;
    const fabBtn = document.getElementById('btn-new-template');
    if (id === 'libs') {
      renderLibraries();
      if (fabBtn) fabBtn.style.display = 'none';
    } else {
      if (fabBtn) fabBtn.style.display = '';
      renderTemplates(filterTemplates(allTemplates, document.getElementById('search-input')?.value.toLowerCase() || ''));
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
  const templates = await getTemplates();
  const blob = new Blob([JSON.stringify(templates, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `prompt-pocket-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const fileImport = document.getElementById('file-import');
document.getElementById('btn-import-templates')?.addEventListener('click', () => fileImport?.click());

fileImport?.addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!Array.isArray(imported)) throw new Error('Expected a JSON array.');
      const current = await getTemplates();
      const merged = [...current];
      let count = 0;
      for (const imp of imported) {
        if (imp?.id && imp.title && imp.body) {
          const idx = merged.findIndex(t => t.id === imp.id);
          if (idx !== -1) merged[idx] = imp;
          else merged.push(imp);
          count++;
        }
      }
      await restoreTemplates(merged);
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
  document.getElementById('import-valid-count').textContent  = `${valid.length} valid`;
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

  // Confirm button label
  document.getElementById('btn-confirm-import-label').textContent = `Import ${valid.length}`;
  document.getElementById('btn-confirm-import').disabled = valid.length === 0;

  // Reset defaults
  document.getElementById('import-default-category').value = '';
  document.getElementById('import-default-tags').value = '';
  initImportCategoryChips();

  // Render valid rows
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
  const defaultCat  = document.getElementById('import-default-category')?.value || '';
  const defaultTags = (document.getElementById('import-default-tags')?.value || '')
    .split(',').map(t => t.trim()).filter(Boolean);

  const withDefaults = applyImportDefaults(importParsedValid, {
    category: defaultCat,
    tags:     defaultTags,
  });

  await runImport(withDefaults);
});

// ── Run the import with conflict resolution ──────────
async function runImport(rows) {
  // Disable the button to prevent double-submit
  const confirmBtn = document.getElementById('btn-confirm-import');
  if (confirmBtn) confirmBtn.disabled = true;

  const { conflicts, clean } = detectImportConflicts(rows, allTemplates);

  let imported = 0;
  let skipped  = 0;

  // 1. Add clean (no conflict) rows
  for (const row of clean) {
    await addTemplate({ title: row.title, body: row.body, category: row.category, tags: row.tags });
    imported++;
  }

  // 2. Resolve conflicts one by one
  if (conflicts.length > 0) {
    const resolutions = await resolveConflictsSequentially(conflicts);
    for (const r of resolutions) {
      if (r.choice === 'skip') {
        skipped++;
      } else if (r.choice === 'overwrite') {
        await updateTemplate(r.existing.id, {
          title:    r.incoming.title,
          body:     r.incoming.body,
          category: r.incoming.category,
          tags:     r.incoming.tags,
        });
        imported++;
      } else { // 'keep'
        await addTemplate({ title: r.incoming.title, body: r.incoming.body, category: r.incoming.category, tags: r.incoming.tags });
        imported++;
      }
    }
  }

  hideConflictModal();
  switchView('view-main');
  await refreshList();
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
