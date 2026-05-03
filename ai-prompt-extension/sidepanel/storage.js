/**
 * Universal AI Prompt Templates
 * sidepanel/storage.js
 * 
 * Abstraction layer for Chrome Storage. Handles CRUD operations for templates,
 * sync vs local fallback, and maintains auto-backups.
 */

const SYNC_KEY = 'user_templates';
const LOCAL_FALLBACK_KEY = 'user_templates_local';
const AUTO_BACKUPS_KEY = 'auto_backups';
const INIT_MARKER_KEY = 'has_initialized_defaults';

// Helper to generate a simple UUID
function generateUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
}

/**
 * Initializes the database. If this is the first run, it loads defaults.json.
 */
export async function initializeStorage() {
  const localData = await chrome.storage.local.get([INIT_MARKER_KEY]);
  if (!localData[INIT_MARKER_KEY]) {
    try {
      const url = chrome.runtime.getURL('templates/defaults.json');
      const response = await fetch(url);
      const defaults = await response.json();
      
      // Save defaults to storage
      await saveTemplates(defaults, false); // false to avoid initial auto-backup noise, or true if we want it
      
      // Mark as initialized
      await chrome.storage.local.set({ [INIT_MARKER_KEY]: true });
      console.log('Starter templates loaded successfully.');
    } catch (err) {
      console.error('Failed to load defaults.json', err);
    }
  }
}

/**
 * Retrieves all user templates. Checks sync storage first, then local fallback.
 * @returns {Array} Array of template objects.
 */
export async function getTemplates() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([SYNC_KEY], (syncData) => {
      if (chrome.runtime.lastError || !syncData[SYNC_KEY]) {
        // Fallback to local
        chrome.storage.local.get([LOCAL_FALLBACK_KEY], (localData) => {
          resolve(localData[LOCAL_FALLBACK_KEY] || []);
        });
      } else {
        resolve(syncData[SYNC_KEY] || []);
      }
    });
  });
}

/**
 * Internal function to save the templates array to storage.
 * Attempts sync first, falls back to local if quota exceeded.
 */
async function saveTemplates(templatesArray, triggerBackup = true) {
  if (triggerBackup) {
    // Await the backup creation before saving new state
    await createAutoBackup();
  }

  return new Promise((resolve, reject) => {
    chrome.storage.sync.set({ [SYNC_KEY]: templatesArray }, () => {
      if (chrome.runtime.lastError) {
        console.warn('Sync storage failed (likely quota exceeded). Falling back to local storage.', chrome.runtime.lastError);
        // Clear sync key to avoid split brain, then save to local
        chrome.storage.sync.remove([SYNC_KEY], () => {
          chrome.storage.local.set({ [LOCAL_FALLBACK_KEY]: templatesArray }, () => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve();
            }
          });
        });
      } else {
        // Clean up local fallback if sync succeeded
        chrome.storage.local.remove([LOCAL_FALLBACK_KEY]);
        resolve();
      }
    });
  });
}

/**
 * Creates a snapshot of the CURRENT state and pushes it to the auto_backups array.
 * Keeps only the last 3 snapshots.
 */
async function createAutoBackup() {
  const currentTemplates = await getTemplates();
  if (!currentTemplates || currentTemplates.length === 0) return; // Don't backup empty state

  const snapshot = {
    timestamp: new Date().toISOString(),
    templates: JSON.parse(JSON.stringify(currentTemplates)) // Deep copy
  };

  return new Promise((resolve) => {
    chrome.storage.local.get([AUTO_BACKUPS_KEY], (data) => {
      let backups = data[AUTO_BACKUPS_KEY] || [];
      backups.unshift(snapshot); // Add to beginning
      if (backups.length > 3) {
        backups = backups.slice(0, 3); // Keep only the latest 3
      }
      chrome.storage.local.set({ [AUTO_BACKUPS_KEY]: backups }, resolve);
    });
  });
}

export async function getAutoBackups() {
  return new Promise((resolve) => {
    chrome.storage.local.get([AUTO_BACKUPS_KEY], (data) => {
      resolve(data[AUTO_BACKUPS_KEY] || []);
    });
  });
}

export async function restoreTemplates(templatesArray) {
  // Use true to trigger a backup of the current state BEFORE restoring the old one
  await saveTemplates(templatesArray, true);
}

// --- CRUD Operations ---

export async function addTemplate(templateData) {
  const templates = await getTemplates();
  const newTemplate = {
    schema_version: 1,
    id: generateUUID(),
    ...templateData,
    source: 'user',
    created_at: new Date().toISOString(),
    modified_at: new Date().toISOString()
  };
  templates.push(newTemplate);
  await saveTemplates(templates);
  return newTemplate;
}

export async function updateTemplate(id, templateData) {
  const templates = await getTemplates();
  const index = templates.findIndex(t => t.id === id);
  if (index !== -1) {
    templates[index] = {
      ...templates[index],
      ...templateData,
      modified_at: new Date().toISOString()
    };
    await saveTemplates(templates);
    return templates[index];
  }
  throw new Error(`Template with ID ${id} not found.`);
}

export async function deleteTemplate(id) {
  let templates = await getTemplates();
  templates = templates.filter(t => t.id !== id);
  await saveTemplates(templates);
}

// --- Settings Operations ---

export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings'], (data) => {
      resolve(data.settings || {
        schema_version: 1,
        theme_override: 'follow',
        default_category: 'General',
        inline_overlay_enabled: true
      });
    });
  });
}

export async function updateSettings(newSettings) {
  const settings = await getSettings();
  const updated = { ...settings, ...newSettings };
  return new Promise((resolve) => {
    chrome.storage.local.set({ settings: updated }, () => resolve(updated));
  });
}
