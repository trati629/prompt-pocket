/**
 * Universal AI Prompt Templates
 * background/service-worker.js
 * 
 * This service worker acts as the central coordinator for the extension.
 * It is responsible for:
 * 1. Routing the side panel to the correct UI (active vs dormant) based on the current tab's URL.
 * 2. Managing the extension icon's visual state (active vs inactive).
 * 3. Aggregating 'SELECTOR_HEALTH' reports from content scripts to ensure DOM selectors are still valid.
 */

// Configure the side panel to open when the extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

/**
 * Safely determines if a URL matches an allowed hostname.
 */
function isAllowedHost(tabUrl, allowedHostname) {
  if (!tabUrl) return false;
  try {
    const targetHost = new URL(tabUrl).hostname;
    return targetHost === allowedHostname || targetHost.endsWith('.' + allowedHostname);
  } catch(e) {
    return false;
  }
}

/**
 * Updates the side panel and icon state for a given tab.
 * @param {number} tabId - The ID of the tab to update.
 * @param {string} url - The URL of the tab to check if it's a supported AI.
 */
async function updatePanel(tabId, url) {
  // Check if the current URL matches one of our supported AI platforms
  const isSupportedAI =
    isAllowedHost(url, 'chatgpt.com') ||
    isAllowedHost(url, 'chat.openai.com') ||
    isAllowedHost(url, 'copilot.microsoft.com') ||
    isAllowedHost(url, 'm365.cloud.microsoft') ||
    isAllowedHost(url, 'gemini.google.com') ||
    isAllowedHost(url, 'claude.ai') ||
    isAllowedHost(url, 'grok.com');

  try {
    const targetPath = isSupportedAI ? 'sidepanel/sidepanel.html' : 'sidepanel/dormant.html';
    
    // WORKAROUND FOR CHROME MV3 SIDE PANEL BUG:
    // When a user opens a new tab via `chrome.tabs.create` while the side panel is open, 
    // Chrome automatically tries to clone the current panel over to the new tab. 
    // If we only use `tabId` below, Chrome often ignores the command because it's caught in the middle of 
    // a tab transition. By forcefully setting the GLOBAL path first (without tabId), we bypass the glitch 
    // and force the new UI to immediately override whatever Chrome thought it should do.
    await chrome.sidePanel.setOptions({
      path: targetPath,
      enabled: true
    });
    
    // 2. Also bind it to the specific tab to keep internal state strictly correct
    await chrome.sidePanel.setOptions({
      tabId,
      path: targetPath,
      enabled: true
    });
  } catch (err) {
    console.warn(`[Universal AI Prompt Templates] Error setting side panel for tab ${tabId}`, err);
  }

  // Update the extension icon to reflect active/inactive state
  chrome.action.setIcon({
    tabId,
    path: isSupportedAI
      ? { "128": "/icons/icon-active-128.png" }
      : { "128": "/icons/icon-inactive-128.png" }
  });

  // Update the tooltip title
  chrome.action.setTitle({
    tabId,
    title: isSupportedAI
      ? 'Universal AI Prompt Templates'
      : 'Prompt Templates — Navigate to a supported AI to use'
  });
}

// Listen for tab activation (when a user switches tabs)
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await updatePanel(tabId, tab.pendingUrl || tab.url);
  } catch (error) {
    console.warn("[Universal AI Prompt Templates] Could not update panel on tab activation", error);
  }
});

// Listen for tab updates (e.g., when a page loads or URL changes)
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // Trigger update immediately if the URL changes, or when the page finishes loading
  if (info.url || info.status === 'complete' || info.status === 'loading') {
    updatePanel(tabId, tab.pendingUrl || tab.url);
  }
});

/**
 * Message Broker
 * Listens for messages from content scripts and other extension parts.
 */
chrome.runtime.onMessage.addListener((message, sender, _sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;

  // Handle selector health reports from content/selector-canary.js
  if (message.type === 'SELECTOR_HEALTH') {
    // Store the health result in local storage keyed by the host
    chrome.storage.local.get(['selector_health'], (data) => {
      const health = data.selector_health || {};
      health[message.results.host] = message.results;
      chrome.storage.local.set({ selector_health: health });
    });
  }
});

/**
 * Auto-inject content scripts into existing tabs when the extension is installed or reloaded.
 * This prevents the "Receiving end does not exist" error on old tabs.
 */
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const allTabs = await chrome.tabs.query({});
    
    for (const tab of allTabs) {
      // 1. Sync the side panel UI state for every existing tab
      if (tab.id && tab.url) {
        updatePanel(tab.id, tab.url).catch(err => console.warn(`Could not update panel for tab ${tab.id}`, err));
      }
      
      // 2. Auto-inject content scripts into supported AI tabs
      const isSupportedAI =
        isAllowedHost(tab.url, 'chatgpt.com') ||
        isAllowedHost(tab.url, 'chat.openai.com') ||
        isAllowedHost(tab.url, 'copilot.microsoft.com') ||
        isAllowedHost(tab.url, 'm365.cloud.microsoft') ||
        isAllowedHost(tab.url, 'gemini.google.com') ||
        isAllowedHost(tab.url, 'claude.ai') ||
        isAllowedHost(tab.url, 'grok.com');
      
      if (isSupportedAI && !tab.discarded) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [
              "content/theme-detector.js",
              "content/injector.js",
              "content/selector-canary.js",
              "content/content.js"
            ]
          });
          console.log(`[Universal AI Prompt Templates] Auto-injected content scripts into tab ${tab.id}`);
        } catch (err) {
          console.warn(`[Universal AI Prompt Templates] Could not inject into tab ${tab.id}`, err);
        }
      }
    }
  } catch (err) {
    console.error("[Universal AI Prompt Templates] Failed to sync tabs on install", err);
  }
});
