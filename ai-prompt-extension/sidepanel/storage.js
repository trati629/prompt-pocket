/**
 * Prompt Pocket — sidepanel/storage.js
 *
 * Chrome Storage abstraction for templates, libraries, settings and auto-backups.
 *
 * Schema versions:
 *   v1 — original (title, body, category, tags, source, created_at, modified_at)
 *   v2 — adds library_id (null = My Templates) and favorited (bool, library templates only)
 */

const SYNC_KEY          = 'user_templates';
const LOCAL_FALLBACK    = 'user_templates_local';
const LIBRARIES_KEY     = 'user_libraries';
const AUTO_BACKUPS_KEY  = 'auto_backups';
const INIT_MARKER_KEY   = 'has_initialized_defaults';
const CURRENT_SCHEMA    = 2;

function generateId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// ── Low-level template read/write ───────────────────

async function readTemplates() {
  return new Promise(resolve => {
    chrome.storage.sync.get([SYNC_KEY], syncData => {
      if (chrome.runtime.lastError || !syncData[SYNC_KEY]) {
        chrome.storage.local.get([LOCAL_FALLBACK], localData => {
          resolve(localData[LOCAL_FALLBACK] || []);
        });
      } else {
        resolve(syncData[SYNC_KEY] || []);
      }
    });
  });
}

async function writeTemplates(templates, triggerBackup = true) {
  // Monitor storage quota
  chrome.storage.sync.getBytesInUse(null, bytes => {
    if (bytes > 90 * 1024 && typeof window !== 'undefined') {
      if (!window.sessionStorage.getItem('sync_quota_warned')) {
        alert("Storage warning: Approaching Chrome Sync limits. Templates will fall back to local storage.");
        window.sessionStorage.setItem('sync_quota_warned', '1');
      }
    }
  });
  chrome.storage.local.getBytesInUse(null, bytes => {
    if (bytes > 4.5 * 1024 * 1024 && typeof window !== 'undefined') {
      if (!window.sessionStorage.getItem('local_quota_warned')) {
        alert("Storage warning: Approaching 5MB local limit. Please export backups and delete unused templates.");
        window.sessionStorage.setItem('local_quota_warned', '1');
      }
    }
  });
  if (triggerBackup) await createAutoBackup();
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({ [SYNC_KEY]: templates }, () => {
      if (chrome.runtime.lastError) {
        chrome.storage.sync.remove([SYNC_KEY], () => {
          chrome.storage.local.set({ [LOCAL_FALLBACK]: templates }, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
          });
        });
      } else {
        chrome.storage.local.remove([LOCAL_FALLBACK]);
        resolve();
      }
    });
  });
}

// ── Migration ────────────────────────────────────────

async function migrateIfNeeded(templates) {
  let dirty = false;
  const migrated = templates.map(t => {
    const out = { ...t };
    if (out.library_id === undefined) { out.library_id = null;  dirty = true; }
    if (out.favorited  === undefined) { out.favorited  = false; dirty = true; }
    if ((out.schema_version || 1) < CURRENT_SCHEMA) {
      out.schema_version = CURRENT_SCHEMA;
      dirty = true;
    }
    return out;
  });
  if (dirty) await writeTemplates(migrated, false);
  return migrated;
}

// ── Initialisation ───────────────────────────────────

export async function initializeStorage() {
  const localData = await new Promise(r =>
    chrome.storage.local.get([INIT_MARKER_KEY], r)
  );

  if (!localData[INIT_MARKER_KEY]) {
    try {
      const url      = chrome.runtime.getURL('templates/defaults.json');
      const response = await fetch(url);
      const defaults = await response.json();
      const seeded   = defaults.map(t => ({
        schema_version: CURRENT_SCHEMA,
        library_id: null,
        favorited:  false,
        ...t,
      }));
      await writeTemplates(seeded, false);
      await chrome.storage.local.set({ [INIT_MARKER_KEY]: true });
    } catch (err) {
      console.error('[Prompt Pocket] Failed to load defaults.json', err);
    }
  } else {
    // Run migration on every load — idempotent, only writes when something changed
    const existing = await readTemplates();
    await migrateIfNeeded(existing);
  }
}

// ── Public template reads ────────────────────────────

/** All templates (My Templates + all library templates). */
export async function getTemplates() {
  const raw = await readTemplates();
  return migrateIfNeeded(raw);
}

/** Only My Templates (library_id === null). */
export async function getMyTemplates() {
  const all = await getTemplates();
  return all.filter(t => t.library_id === null);
}

/** Templates in a specific library. */
export async function getLibraryTemplates(libraryId) {
  const all = await getTemplates();
  return all.filter(t => t.library_id === libraryId);
}

/** Favourited library templates (shown in My Templates tab). */
export async function getFavouritedTemplates() {
  const all = await getTemplates();
  return all.filter(t => t.library_id !== null && t.favorited === true);
}

// ── Template CRUD ────────────────────────────────────

export async function addTemplate(templateData) {
  if (templateData.title && templateData.title.length > 500) templateData.title = templateData.title.substring(0, 500);
  if (templateData.body && templateData.body.length > 100000) templateData.body = templateData.body.substring(0, 100000);
  const templates = await getTemplates();
  const newT = {
    schema_version: CURRENT_SCHEMA,
    id:         generateId(),
    library_id: templateData.library_id ?? null,
    favorited:  false,
    source:     'user',
    created_at: new Date().toISOString(),
    modified_at: new Date().toISOString(),
    ...templateData,
  };
  templates.push(newT);
  await writeTemplates(templates);
  return newT;
}

export async function updateTemplate(id, templateData) {
  if (templateData.title && templateData.title.length > 500) templateData.title = templateData.title.substring(0, 500);
  if (templateData.body && templateData.body.length > 100000) templateData.body = templateData.body.substring(0, 100000);
  const templates = await getTemplates();
  const idx = templates.findIndex(t => t.id === id);
  if (idx === -1) throw new Error(`Template ${id} not found.`);
  templates[idx] = { ...templates[idx], ...templateData, modified_at: new Date().toISOString() };
  await writeTemplates(templates);
  return templates[idx];
}

export async function deleteTemplate(id) {
  let templates = await getTemplates();
  templates = templates.filter(t => t.id !== id);
  await writeTemplates(templates);
}

/** Move a template to a different library (or null = My Templates). */
export async function moveTemplate(id, libraryId) {
  const templates = await getTemplates();
  const idx = templates.findIndex(t => t.id === id);
  if (idx === -1) throw new Error(`Template ${id} not found.`);
  templates[idx] = {
    ...templates[idx],
    library_id: libraryId,
    favorited:  libraryId === null ? false : templates[idx].favorited,
    modified_at: new Date().toISOString(),
  };
  await writeTemplates(templates);
  return templates[idx];
}

/** Toggle the favorited flag on a library template. */
export async function toggleFavourite(id) {
  const templates = await getTemplates();
  const idx = templates.findIndex(t => t.id === id);
  if (idx === -1) throw new Error(`Template ${id} not found.`);
  templates[idx] = { ...templates[idx], favorited: !templates[idx].favorited };
  await writeTemplates(templates, false); // favouriting doesn't need a backup
  return templates[idx];
}

// ── Library CRUD ─────────────────────────────────────

export async function getLibraries() {
  return new Promise(resolve =>
    chrome.storage.local.get([LIBRARIES_KEY], d =>
      resolve(d[LIBRARIES_KEY] || [])
    )
  );
}

export async function createLibrary(name) {
  const libs = await getLibraries();
  const newLib = { id: generateId(), name: name.trim(), created_at: new Date().toISOString() };
  libs.push(newLib);
  await new Promise(r => chrome.storage.local.set({ [LIBRARIES_KEY]: libs }, r));
  return newLib;
}

export async function renameLibrary(id, name) {
  const libs = await getLibraries();
  const idx  = libs.findIndex(l => l.id === id);
  if (idx === -1) throw new Error(`Library ${id} not found.`);
  libs[idx] = { ...libs[idx], name: name.trim() };
  await new Promise(r => chrome.storage.local.set({ [LIBRARIES_KEY]: libs }, r));
  return libs[idx];
}

/**
 * Delete a library. Its templates are moved to My Templates and favorited is reset.
 */
export async function deleteLibrary(id) {
  // Move all library templates to My Templates
  const templates = await getTemplates();
  const updated   = templates.map(t =>
    t.library_id === id ? { ...t, library_id: null, favorited: false } : t
  );
  await writeTemplates(updated, false);

  // Remove library metadata
  const libs = await getLibraries();
  await new Promise(r =>
    chrome.storage.local.set({ [LIBRARIES_KEY]: libs.filter(l => l.id !== id) }, r)
  );
}

// ── Settings ─────────────────────────────────────────

export async function getSettings() {
  return new Promise(resolve =>
    chrome.storage.local.get(['settings'], d =>
      resolve(d.settings || {
        schema_version:          CURRENT_SCHEMA,
        theme_override:          'navy',
        default_category:        'General',
        inline_overlay_enabled:  true,
        density:                 'compact',
        show_badges:             true,
        enabled_ai_tools:        ['chatgpt', 'copilot', 'm365-copilot'],
        library_sort:            'newest',
        my_tab_search:           '',
        my_tab_categories:       [],
      })
    )
  );
}

export async function updateSettings(newSettings) {
  const settings = await getSettings();
  const updated  = { ...settings, ...newSettings };
  return new Promise(resolve =>
    chrome.storage.local.set({ settings: updated }, () => resolve(updated))
  );
}

// ── Auto-backups ─────────────────────────────────────

async function createAutoBackup() {
  const current = await readTemplates();
  if (!current?.length) return;
  const libs     = await getLibraries();
  const snapshot = {
    timestamp: new Date().toISOString(),
    templates: JSON.parse(JSON.stringify(current)),
    libraries: JSON.parse(JSON.stringify(libs)),
  };
  return new Promise(resolve =>
    chrome.storage.local.get([AUTO_BACKUPS_KEY], d => {
      let backups = d[AUTO_BACKUPS_KEY] || [];
      backups.unshift(snapshot);
      if (backups.length > 3) backups = backups.slice(0, 3);
      chrome.storage.local.set({ [AUTO_BACKUPS_KEY]: backups }, resolve);
    })
  );
}

export async function getAutoBackups() {
  return new Promise(resolve =>
    chrome.storage.local.get([AUTO_BACKUPS_KEY], d =>
      resolve(d[AUTO_BACKUPS_KEY] || [])
    )
  );
}

export async function restoreTemplates(templatesArray) {
  await writeTemplates(templatesArray, true);
}

// ── Export / Import helpers ───────────────────────────

/**
 * Build an export envelope.
 * @param {'my'|'all'} scope  'my' = My Templates only, 'all' = templates + libraries
 */
export async function buildExport(scope = 'my') {
  const templates = await getTemplates();
  const exported  = scope === 'all'
    ? templates
    : templates.filter(t => t.library_id === null);

  const envelope = {
    export_version: 2,
    exported_at:    new Date().toISOString(),
    scope,
    templates:      exported,
  };

  if (scope === 'all') {
    envelope.libraries = await getLibraries();
  }

  // Generate SHA-256 integrity hash
  const payloadStr = JSON.stringify({ templates: envelope.templates, libraries: envelope.libraries || [] });
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadStr));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  envelope.integrity_hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return envelope;
}

export async function verifyExportIntegrity(envelope) {
  if (!envelope) return true;
  if (envelope.export_version >= 2) {
    if (!envelope.integrity_hash) return false; // Reject missing hash on modern schemas
  } else {
    if (!envelope.integrity_hash) return true; // Allow legacy to bypass
  }
  const payloadStr = JSON.stringify({ templates: envelope.templates || [], libraries: envelope.libraries || [] });
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payloadStr));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const expected = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === envelope.integrity_hash;
}

/**
 * Restore from an export envelope (supports both v1 bare arrays and v2 envelopes).
 * Returns { templates, libraries } ready for the caller to merge.
 */
export function parseExportEnvelope(raw) {
  // Legacy: bare array of templates
  if (Array.isArray(raw)) return { templates: raw, libraries: [] };
  // v2 envelope
  return {
    templates: raw.templates || [],
    libraries: raw.libraries || [],
  };
}
