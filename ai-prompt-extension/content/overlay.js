/**
 * Prompt Pocket — content/overlay.js
 *
 * Floating Action Button + Popover overlay.
 * Injected as a content script on all supported AI pages.
 * Uses Shadow DOM so host-page CSS cannot interfere.
 *
 * Features:
 *  - FAB is always present in a dormant state, springing to life when the AI chat input is focused
 *  - Popover: list view (search + pinned/all) + use view (variable fill + live preview)
 *  - Themes sync with sidebar (navy / ink / parchment)
 *  - Toggle via Settings or ⌘⇧P / Ctrl⇧P (relayed from service worker)
 */

if (!window.__pp_overlay_injected) {
  window.__pp_overlay_injected = true;

  // ── Category definitions (mirrors sidepanel.js) ──────────
  const CATEGORIES = [
    { id: 'general',   label: 'General',   color: '#C4A974' },
    { id: 'developer', label: 'Developer', color: '#7AA8D9' },
    { id: 'writing',   label: 'Writing',   color: '#B689C9' },
    { id: 'research',  label: 'Research',  color: '#7FBF8C' },
    { id: 'marketing', label: 'Marketing', color: '#E29B7D' },
    { id: 'personal',  label: 'Personal',  color: '#D9B86F' },
  ];

  function categoryOf(id) {
    return CATEGORIES.find(c => c.id === (id || '').toLowerCase()) || CATEGORIES[0];
  }

  // ── Text insertion (via content.js core) ─────────────────
  function insertTextToActiveInput(text) {
    return typeof PromptPocketCore !== 'undefined' ? PromptPocketCore.insertText(text) : false;
  }
  
  function getInputBox() {
    return typeof PromptPocketCore !== 'undefined' ? PromptPocketCore.getInputBox() : null;
  }

  // ── Template helpers ─────────────────────────────────────
  function extractVars(body) {
    const out = [], seen = new Set();
    const re = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
    }
    return out;
  }

  function fillTemplate(body, values) {
    return body.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g,
      (_, k) => values[k] || `{{${k}}}`);
  }

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeHex(color) {
    return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#888888';
  }

  // ── Storage helpers ──────────────────────────────────────
  function readTemplates() {
    return new Promise(resolve => {
      chrome.storage.sync.get(['user_templates'], d => {
        if (chrome.runtime.lastError || !d.user_templates) {
          chrome.storage.local.get(['user_templates_local'], ld => {
            resolve(ld.user_templates_local || []);
          });
        } else {
          resolve(d.user_templates || []);
        }
      });
    });
  }

  function readSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get(['settings'], d => resolve(d.settings || {}));
    });
  }

  // ── Overlay state ────────────────────────────────────────
  let shadow         = null;
  let hostEl         = null;
  let fabEl          = null;
  let popoverEl      = null;
  let scrimEl        = null;
  let hintEl         = null;
  let templates      = [];
  let popoverOpen    = false;
  let currentView    = 'list'; // 'list' | 'use'
  let currentTmpl    = null;
  let searchQuery    = '';
  let focusedRowIdx  = -1;
  let hideTimer      = null;
  let watchedInput   = null;
  let overlayEnabled = true;

  // ── Build the Shadow DOM host ────────────────────────────
  async function buildOverlay() {
    if (hostEl) return; // already built

    // Load CSS into shadow
    const cssUrl = chrome.runtime.getURL('content/overlay.css');
    let cssText = '';
    try {
      const res = await fetch(cssUrl);
      cssText = await res.text();
    } catch (_) { /* fallback: no styles */ }

    hostEl = document.createElement('div');
    hostEl.id = 'pp-overlay-host';
    hostEl.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(hostEl);

    shadow = hostEl.attachShadow({ mode: 'open' });

    // Prevent keyboard events from escaping the shadow boundary.
    // AI pages (ChatGPT etc.) have global keydown listeners that re-route keystrokes
    // to their own textarea when document.activeElement is not a recognised input.
    // Shadow DOM reports the host <div> as document.activeElement, so they steal the keys.
    // stopPropagation() here stops events reaching hostEl and the document while still
    // allowing our own shadow-root listener (onKeyDown) to run on the same element.
    shadow.addEventListener('keydown',  e => e.stopPropagation());
    shadow.addEventListener('keyup',    e => e.stopPropagation());
    shadow.addEventListener('keypress', e => e.stopPropagation());

    const styleEl = document.createElement('style');
    styleEl.textContent = cssText;
    shadow.appendChild(styleEl);

    buildFAB();
    applyTheme();
  }

  function destroyOverlay() {
    if (hostEl) {
      hostEl.remove();
      hostEl = null;
      shadow = null;
      fabEl = null;
      popoverEl = null;
      scrimEl = null;
      hintEl = null;
    }
    if (watchedInput) {
      watchedInput.removeEventListener('focus', onInputFocus, true);
      watchedInput.removeEventListener('blur',  onInputBlur,  true);
      watchedInput = null;
    }
  }

  // ── FAB ──────────────────────────────────────────────────
  function buildFAB() {
    fabEl = document.createElement('button');
    fabEl.id = 'pp-fab';
    fabEl.setAttribute('aria-label', 'Open Prompt Pocket');

    // Pocket logo SVG
    fabEl.innerHTML = `
      <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M5 6 L5 18 Q5 26 16 27 Q27 26 27 18 L27 6"
              stroke="currentColor" stroke-width="2.2"
              stroke-linecap="round" stroke-dasharray="3 2.4" fill="none"/>
      </svg>
      <span id="pp-fab-badge" style="display:none"></span>`;

    fabEl.addEventListener('click', togglePopover);
    shadow.appendChild(fabEl);
    updateBadge();
  }

  async function updateBadge() {
    if (!fabEl) return;
    const badge = shadow.getElementById('pp-fab-badge');
    if (!badge) return;
    const t = await readTemplates();
    templates = t;
    const count = t.length;
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  function showFAB() {
    if (!fabEl || !overlayEnabled) return;
    clearTimeout(hideTimer);
    fabEl.classList.add('pp-fab--active');
    showHint();
  }

  function hideFAB() {
    if (!fabEl) return;
    fabEl.classList.remove('pp-fab--active', 'pp-fab--open');
    if (hintEl) hintEl.remove();
    hintEl = null;
    if (popoverOpen) closePopover();
  }

  // ── Hint bubble (first run) ──────────────────────────────
  function showHint() {
    if (!shadow) return;
    if (sessionStorage.getItem('pp_hint_dismissed')) return;
    if (popoverOpen) return;
    if (hintEl) return;

    hintEl = document.createElement('div');
    hintEl.id = 'pp-hint';
    hintEl.innerHTML =
      `Press <span class="pp-kbd">⌘⇧P</span> or tap the pocket`;
    shadow.appendChild(hintEl);

    // Auto-dismiss after 4 s
    setTimeout(dismissHint, 4000);
  }

  function dismissHint() {
    sessionStorage.setItem('pp_hint_dismissed', '1');
    if (hintEl) { hintEl.remove(); hintEl = null; }
  }

  // ── Input focus detection ────────────────────────────────
  function onInputFocus() {
    clearTimeout(hideTimer);
    showFAB();
  }

  function onInputBlur() {
    hideTimer = setTimeout(() => {
      if (!popoverOpen) hideFAB();
    }, 400);
  }

  function attachInputListeners(el) {
    if (watchedInput === el) return;
    if (watchedInput) {
      watchedInput.removeEventListener('focus', onInputFocus, true);
      watchedInput.removeEventListener('blur',  onInputBlur,  true);
    }
    watchedInput = el;
    el.addEventListener('focus', onInputFocus, true);
    el.addEventListener('blur',  onInputBlur,  true);
  }

  function findAndWatch() {
    const el = getInputBox();
    if (el) attachInputListeners(el);
  }

  // Debounced MutationObserver watches for SPA navigation creating the input
  let watchDebounce = null;
  const inputWatcher = new MutationObserver(() => {
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(findAndWatch, 300);
  });

  // ── Popover open / close ─────────────────────────────────
  async function openPopover() {
    if (!shadow || !fabEl) return;
    if (popoverOpen) return;
    dismissHint();
    popoverOpen = true;
    fabEl.classList.add('pp-fab--open');
    clearTimeout(hideTimer);

    // Refresh templates each open
    templates = await readTemplates();
    updateBadge();

    // Build scrim
    scrimEl = document.createElement('div');
    scrimEl.id = 'pp-scrim';
    scrimEl.addEventListener('click', closePopover);
    shadow.appendChild(scrimEl);

    // Build popover
    popoverEl = document.createElement('div');
    popoverEl.id = 'pp-popover';
    popoverEl.setAttribute('role', 'dialog');
    popoverEl.setAttribute('aria-label', 'Prompt Pocket');
    shadow.appendChild(popoverEl);

    currentView = 'list';
    searchQuery = '';
    focusedRowIdx = -1;
    renderListView();

    // Keyboard handler
    shadow.addEventListener('keydown', onKeyDown);
  }

  function closePopover() {
    if (!popoverOpen) return;
    popoverOpen = false;
    currentView = 'list';
    currentTmpl = null;
    if (popoverEl) { popoverEl.remove(); popoverEl = null; }
    if (scrimEl)   { scrimEl.remove();   scrimEl   = null; }
    shadow.removeEventListener('keydown', onKeyDown);
    if (fabEl) fabEl.classList.remove('pp-fab--open');
    // Return to dormant (small) unless the input is still focused
    if (document.activeElement !== watchedInput) {
      hideTimer = setTimeout(hideFAB, 400);
    }
  }

  function togglePopover() {
    if (popoverOpen) closePopover();
    else openPopover();
  }

  // ── List view ────────────────────────────────────────────
  function renderListView() {
    if (!popoverEl) return;
    currentView = 'list';
    
    // Only build header and footer once
    if (!popoverEl.querySelector('.pp-header')) {
      popoverEl.innerHTML = '';

      // ── Header ──
      const header = document.createElement('div');
      header.className = 'pp-header';
      header.innerHTML = `
        <div class="pp-header-row">
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M5 6 L5 18 Q5 26 16 27 Q27 26 27 18 L27 6"
                  stroke="currentColor" stroke-width="1.6"
                  stroke-linecap="round" stroke-dasharray="3 2.2" fill="none"
                  style="color:var(--accent)"/>
          </svg>
          <span class="pp-brand-label">Prompt Pocket</span>
          <button class="pp-esc-btn" aria-label="Close">ESC</button>
        </div>
        <div class="pp-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
               stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
          </svg>
          <input class="pp-search-input" type="text" placeholder="Search prompts…"
                 value="${escHtml(searchQuery)}" autocomplete="off" spellcheck="false"/>
          <span class="pp-cmd-kbd">⌘K</span>
        </div>`;
      popoverEl.appendChild(header);

      header.querySelector('.pp-esc-btn').addEventListener('click', closePopover);

      const searchInput = header.querySelector('.pp-search-input');
      searchInput.addEventListener('input', e => {
        searchQuery   = e.target.value;
        focusedRowIdx = -1;
        renderListBody();
      });
      // Auto-focus search
      setTimeout(() => searchInput.focus(), 50);

      // ── Body Container ──
      const body = document.createElement('div');
      body.className = 'pp-list-body';
      popoverEl.appendChild(body);

      // ── Footer ──
      const footer = document.createElement('div');
      footer.className = 'pp-footer';
      footer.innerHTML = `
        <span class="pp-key-hint">
          <span class="pp-kbd">↵</span> Insert
        </span>
        <span class="pp-key-hint">
          <span class="pp-kbd">↑</span><span class="pp-kbd">↓</span> Navigate
        </span>
        <button class="pp-new-btn">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New
        </button>`;
      footer.querySelector('.pp-new-btn').addEventListener('click', () => {
        closePopover();
        chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL_NEW_TEMPLATE' }).catch(() => {});
      });
      popoverEl.appendChild(footer);
    }
    
    renderListBody();
  }

  function renderListBody() {
    if (!popoverEl) return;
    const body = popoverEl.querySelector('.pp-list-body');
    if (!body) return;
    
    const q = searchQuery.trim().toLowerCase();
    let filtered = templates;
    if (q) {
      filtered = templates.filter(t =>
        t.title?.toLowerCase().includes(q) ||
        t.body?.toLowerCase().includes(q)  ||
        categoryOf(t.category).label.toLowerCase().includes(q)
      );
    }
    const pinned = filtered.filter(t => t.pinned);
    const rest   = filtered.filter(t => !t.pinned);
    const allRows = [...pinned, ...rest];

    body.innerHTML = '';

    if (allRows.length === 0) {
      body.innerHTML = `
        <div class="pp-empty">
          <svg width="36" height="36" viewBox="0 0 32 32" fill="none" style="color:var(--accent);opacity:0.5">
            <path d="M5 6 L5 18 Q5 26 16 27 Q27 26 27 18 L27 6"
                  stroke="currentColor" stroke-width="1.4"
                  stroke-linecap="round" stroke-dasharray="3 2.2" fill="none"/>
          </svg>
          <div class="pp-empty-title">${q ? `No matches for "${escHtml(q)}"` : 'No templates yet'}</div>
        </div>`;
    } else {
      if (pinned.length > 0) body.appendChild(buildSection('Pinned', pinned, allRows));
      if (rest.length > 0) {
        body.appendChild(buildSection(
          pinned.length > 0 ? 'All Templates' : 'Templates', rest, allRows
        ));
      }
    }
    
    updateFocusedRow();
  }



  function buildSection(label, rows, allRows) {
    const section = document.createElement('div');
    section.className = 'pp-section';
    const lbl = document.createElement('div');
    lbl.className = 'pp-section-label';
    lbl.textContent = label;
    section.appendChild(lbl);
    rows.forEach(t => section.appendChild(buildRow(t, allRows)));
    return section;
  }

  function buildRow(t, allRows) {
    const cat = categoryOf(t.category);
    const c   = safeHex(cat.color);
    const idx = allRows.indexOf(t);

    const btn = document.createElement('button');
    btn.className = 'pp-row';
    btn.dataset.idx = idx;

    btn.innerHTML = `
      <span class="pp-row-icon"
            style="background:${c}22;border:0.5px solid ${c}44;color:${c}">
        ${t.pinned
          ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
               <path d="M9 10.76V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v5.76a2 2 0 0 0 .59 1.41l1 1A2 2 0 0 1 17 14.59V16a1 1 0 0 1-1 1h-3v5h-2v-5H8a1 1 0 0 1-1-1v-1.41a2 2 0 0 1 .41-1.42l1-1A2 2 0 0 0 9 10.76Z"/>
             </svg>`
          : `<span class="pp-row-icon-dot" style="background:${c}"></span>`}
      </span>
      <div class="pp-row-body">
        <div class="pp-row-title">${escHtml(t.title || 'Untitled')}</div>
        <div class="pp-row-meta">${escHtml(cat.label)}</div>
      </div>
      <svg class="pp-row-send" width="13" height="13" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="1.8"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/>
      </svg>`;

    btn.addEventListener('click', () => pickTemplate(t));
    return btn;
  }

  function pickTemplate(t) {
    const vars = extractVars(t.body || '');
    if (vars.length === 0) {
      insertTextToActiveInput(t.body || '');
      closePopover();
    } else {
      currentTmpl = t;
      renderUseView(t);
    }
  }

  function updateFocusedRow() {
    if (!popoverEl) return;
    popoverEl.querySelectorAll('.pp-row').forEach((btn, i) => {
      btn.classList.toggle('pp-row--focused', i === focusedRowIdx);
    });
  }

  // ── Use view ─────────────────────────────────────────────
  function renderUseView(t) {
    if (!popoverEl) return;
    currentView = 'use';
    popoverEl.innerHTML = '';

    const vars   = extractVars(t.body || '');
    const values = Object.fromEntries(vars.map(v => [v, '']));

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'pp-use-header';
    header.innerHTML = `
      <button class="pp-back-btn" aria-label="Back">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6"/>
        </svg>
      </button>
      <div>
        <div class="pp-use-title">${escHtml(t.title || 'Untitled')}</div>
        <div class="pp-use-meta">${escHtml(categoryOf(t.category).label)} · ${vars.length} variable${vars.length === 1 ? '' : 's'}</div>
      </div>`;
    header.querySelector('.pp-back-btn').addEventListener('click', () => {
      currentTmpl = null;
      renderListView();
      const inp = popoverEl?.querySelector('.pp-search-input');
      if (inp) inp.focus();
    });
    popoverEl.appendChild(header);

    // ── Body ──
    const body = document.createElement('div');
    body.className = 'pp-use-body';

    // Variable inputs
    vars.forEach((v, i) => {
      const wrap = document.createElement('div');
      const lbl  = document.createElement('div');
      lbl.className = 'pp-var-label';
      lbl.dataset.var = v;
      lbl.textContent = `{{${v}}}`;

      const isMultiline = ['code', 'sources', 'notes', 'text', 'content'].includes(v);
      const input = document.createElement('textarea');
      input.className  = 'pp-var-input';
      input.rows       = isMultiline ? 3 : 1;
      input.placeholder = `Enter ${v}…`;
      input.dataset.var = v;

      if (i === 0) setTimeout(() => input.focus(), 50);

      input.addEventListener('input', () => {
        values[v] = input.value;
        lbl.classList.toggle('pp-var--filled', !!input.value.trim());
        updatePreview();
        updateInsertBtn();
      });

      wrap.appendChild(lbl);
      wrap.appendChild(input);
      body.appendChild(wrap);
    });

    // Live preview
    const preview = document.createElement('div');
    preview.className = 'pp-preview-block';
    preview.id = 'pp-preview';
    body.appendChild(preview);

    popoverEl.appendChild(body);

    // ── Footer ──
    const footer = document.createElement('div');
    footer.className = 'pp-use-footer';
    const btn = document.createElement('button');
    btn.className = 'pp-insert-btn';
    btn.id = 'pp-insert-btn';
    btn.disabled = true;
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/>
      </svg>
      <span id="pp-insert-label">Fill ${vars.length} variable${vars.length === 1 ? '' : 's'}</span>
      <span class="pp-insert-kbd" style="display:none" id="pp-insert-kbd">↵</span>`;
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const filled = fillTemplate(t.body || '', values);
      insertTextToActiveInput(filled);
      closePopover();
    });
    footer.appendChild(btn);
    popoverEl.appendChild(footer);

    function updatePreview() {
      const el = shadow.getElementById('pp-preview');
      if (!el) return;
      const filled = fillTemplate(t.body || '', values);
      el.innerHTML = '';
      filled.split(/(\{\{[^}]+\}\})/g).forEach(part => {
        if (/^\{\{.+\}\}$/.test(part)) {
          const span = document.createElement('span');
          span.className = 'pp-var-token';
          span.textContent = part;
          el.appendChild(span);
        } else {
          el.appendChild(document.createTextNode(part));
        }
      });
    }

    function updateInsertBtn() {
      const b      = shadow.getElementById('pp-insert-btn');
      const lbl    = shadow.getElementById('pp-insert-label');
      const kbd    = shadow.getElementById('pp-insert-kbd');
      if (!b) return;
      const unfilled = vars.filter(v => !values[v]?.trim()).length;
      b.disabled = unfilled > 0;
      if (unfilled > 0) {
        lbl.textContent = `Fill ${unfilled} more variable${unfilled === 1 ? '' : 's'}`;
        if (kbd) kbd.style.display = 'none';
      } else {
        lbl.textContent = 'Insert into editor';
        if (kbd) kbd.style.display = '';
      }
    }

    // Initial render
    updatePreview();
    updateInsertBtn();
  }

  // ── Keyboard navigation ──────────────────────────────────
  function onKeyDown(e) {
    if (!popoverOpen) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      if (currentView === 'use') {
        currentTmpl = null;
        renderListView();
        setTimeout(() => {
          const inp = popoverEl?.querySelector('.pp-search-input');
          if (inp) inp.focus();
        }, 30);
      } else {
        closePopover();
      }
      return;
    }

    if (currentView !== 'list') return;

    const rows = popoverEl ? [...popoverEl.querySelectorAll('.pp-row')] : [];
    if (rows.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusedRowIdx = Math.min(focusedRowIdx + 1, rows.length - 1);
      updateFocusedRow();
      rows[focusedRowIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (focusedRowIdx <= 0) {
        focusedRowIdx = -1;
        updateFocusedRow();
        popoverEl.querySelector('.pp-search-input')?.focus();
      } else {
        focusedRowIdx--;
        updateFocusedRow();
        rows[focusedRowIdx]?.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'Enter' && focusedRowIdx >= 0) {
      e.preventDefault();
      rows[focusedRowIdx]?.click();
    }
  }

  // ── Theme sync ───────────────────────────────────────────
  function applyTheme() {
    if (!hostEl) return;
    readSettings().then(settings => {
      const t = settings.theme_override || 'navy';
      if (t === 'parchment') hostEl.setAttribute('data-theme', 'light');
      else if (t === 'ink')  hostEl.setAttribute('data-theme', 'ink');
      else                   hostEl.removeAttribute('data-theme');
    });
  }

  // ── Init ─────────────────────────────────────────────────
  async function init() {
    const settings = await readSettings();
    overlayEnabled = settings.inline_overlay_enabled !== false;
    if (!overlayEnabled) return;

    await buildOverlay();
    findAndWatch();

    // Watch for the AI input to appear (SPA async load)
    inputWatcher.observe(document.body, { childList: true, subtree: true });

    // If input is already focused when the overlay loads
    const input = getInputBox();
    if (input && document.activeElement === input) showFAB();
  }

  // ── Storage change listener ──────────────────────────────
  chrome.storage.onChanged.addListener((changes, ns) => {
    // Settings changed
    if (ns === 'local' && changes.settings) {
      const newSettings = changes.settings.newValue || {};
      const wasEnabled = overlayEnabled;
      overlayEnabled = newSettings.inline_overlay_enabled !== false;

      if (!wasEnabled && overlayEnabled) {
        // Toggled on — build and start watching
        buildOverlay().then(() => {
          findAndWatch();
          inputWatcher.observe(document.body, { childList: true, subtree: true });
        });
      } else if (wasEnabled && !overlayEnabled) {
        // Toggled off — tear down
        inputWatcher.disconnect();
        destroyOverlay();
      } else if (overlayEnabled) {
        // Theme may have changed
        applyTheme();
      }
    }

    // Templates changed — refresh badge
    if ((ns === 'sync' && changes.user_templates) ||
        (ns === 'local' && changes.user_templates_local)) {
      updateBadge();
    }
  });

  // ── Message listener (keyboard shortcut relay) ───────────
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'TOGGLE_OVERLAY') {
      if (!overlayEnabled) return;
      if (!fabEl) {
        buildOverlay().then(() => { findAndWatch(); openPopover(); });
      } else {
        togglePopover();
        if (!popoverOpen) showFAB();
      }
    }
  });

  // ── Cleanup ──────────────────────────────────────────────
  window.addEventListener('beforeunload', () => {
    inputWatcher.disconnect();
    clearTimeout(hideTimer);
    clearTimeout(watchDebounce);
  });

  // Kick off
  init();
}
