/**
 * Universal AI Prompt Templates
 * content/selector-canary.js
 * 
 * An early-warning system that tests if our expected CSS selectors (for the input box and theme)
 * are still valid on the current AI host. It sends a health report to the service worker,
 * allowing the extension to warn the user if a site update has broken the extension.
 */

if (!window.__ai_prompts_canary_injected) {
  window.__ai_prompts_canary_injected = true;

  // Define the exact selectors we depend on for each host
  const CANARY_TARGETS = {
    'chatgpt.com': {
      input: ['#prompt-textarea', 'div[contenteditable="true"][data-id]', 'div[contenteditable="true"]'],
      theme: ['html.dark', 'html[data-theme="dark"]', 'html[data-theme="light"]']
    },
    'copilot.microsoft.com': {
      input: ['#userInput', 'textarea[placeholder="Message Copilot"]', '#composer-input textarea'],
      theme: ['html[data-theme="dark"]', 'html[data-theme="light"]']
    },
    'm365.cloud.microsoft': {
      input: ['textarea[aria-label]', 'div[contenteditable="true"][aria-label]', 'div[contenteditable="true"]'],
      theme: ['html[data-theme="dark"]', 'html[data-theme="light"]', 'html.dark']
    },
    'gemini.google.com': {
      input: ['div[contenteditable="true"][aria-label]', '.ql-editor', 'div[contenteditable="true"]'],
      theme: ['html[data-theme="dark"]', 'html[data-theme="light"]', 'body.dark']
    },
    'claude.ai': {
      input: ['div[contenteditable="true"][data-placeholder]', '.ProseMirror', 'div[contenteditable="true"]'],
      theme: ['html.dark', 'html[data-theme="dark"]', 'html[data-theme="light"]']
    }
  };

  /**
   * Determines which AI host we are currently on.
   * (Duplicated from injector.js to keep modules self-contained in Phase 1)
   * @returns {string|null} The key matching the CANARY_TARGETS map, or null if unsupported.
   */
  function getCanaryHostType() {
    const h = window.location.hostname;
    if (h.includes('chatgpt.com') || h.includes('chat.openai.com')) return 'chatgpt.com';
    if (h.includes('copilot.microsoft.com'))  return 'copilot.microsoft.com';
    if (h.includes('m365.cloud.microsoft'))   return 'm365.cloud.microsoft';
    if (h.includes('gemini.google.com'))      return 'gemini.google.com';
    if (h.includes('claude.ai'))              return 'claude.ai';
    return null;
  }

  /**
   * Executes the health check against the DOM.
   */
  function runCanary() {
    const host = getCanaryHostType();
    if (!host) return; // Not on a supported host
    
    const targets = CANARY_TARGETS[host];
    
    // Build the health report
    const results = {
      host,
      checked_at: new Date().toISOString(),
      // Map over each input selector and test if it exists in the DOM right now
      input: targets.input.map(sel => ({ sel, matched: !!document.querySelector(sel) })),
      // Map over each theme selector and test if it exists
      theme: targets.theme.map(sel => ({ sel, matched: !!document.querySelector(sel) })),
    };
    
    // Evaluate the overall health
    // 'primary_match' is true if the very first (most preferred) input selector works
    results.primary_match = results.input[0].matched;
    // 'any_input_match' is true if AT LEAST ONE fallback selector worked
    results.any_input_match = results.input.some(r => r.matched);
    // 'any_theme_match' is true if AT LEAST ONE theme selector worked
    results.any_theme_match = results.theme.some(r => r.matched);
    
    // Dispatch the report to the background service worker
    if (!chrome.runtime?.id) {
      canaryObserver?.disconnect();
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: 'SELECTOR_HEALTH', results }).catch(() => {});
    } catch (err) {
      canaryObserver?.disconnect();
    }
  }

  // Run the initial canary check shortly after the script loads
  setTimeout(runCanary, 1000);

  // Re-run the canary check when the DOM mutates (e.g., when an SPA navigates or lazy-loads the input)
  let canaryTimer;
  const canaryObserver = new MutationObserver(() => {
    // Debounce the checks to avoid trashing CPU during heavy DOM rendering
    clearTimeout(canaryTimer);
    canaryTimer = setTimeout(runCanary, 500);
  });

  canaryObserver.observe(document.body, { childList: true, subtree: true });

  // Cleanup observer on page unload
  window.addEventListener('beforeunload', () => {
    canaryObserver?.disconnect();
    clearTimeout(canaryTimer);
  });
}
