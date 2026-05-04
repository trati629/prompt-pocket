/**
 * Universal AI Prompt Templates
 * content/theme-detector.js
 * 
 * Detects whether the host AI page (ChatGPT or Copilot) is currently in light or dark mode.
 * Broadcasts changes to the side panel so the UI theme matches seamlessly.
 */

if (!window.__ai_prompts_theme_injected) {
  window.__ai_prompts_theme_injected = true;

  /**
   * Determines the current theme of the host page based on specific DOM attributes.
   * @returns {string} 'dark' or 'light'
   */
  function detectTheme() {
    const html = document.documentElement;
    const h = window.location.hostname;

    // ChatGPT — class="dark" or data-theme="dark"
    if (h.includes('chatgpt.com') || h.includes('chat.openai.com')) {
      return (html.classList.contains('dark') || html.getAttribute('data-theme') === 'dark')
        ? 'dark' : 'light';
    }
    // Copilot (standard) — data-theme="dark|light"
    if (h.includes('copilot.microsoft.com')) {
      return html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }
    // M365 Copilot — data-theme or class-based
    if (h.includes('m365.cloud.microsoft')) {
      return (html.getAttribute('data-theme') === 'dark' || html.classList.contains('dark'))
        ? 'dark' : 'light';
    }
    // Gemini — data-theme or body class
    if (h.includes('gemini.google.com')) {
      return (html.getAttribute('data-theme') === 'dark' ||
              document.body?.classList.contains('dark'))
        ? 'dark' : 'light';
    }
    // Claude — html class="dark"
    if (h.includes('claude.ai')) {
      return html.classList.contains('dark') ? 'dark' : 'light';
    }

    // Generic fallback: respect system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /**
   * Broadcasts the detected theme to the extension storage and other components.
   */
  function broadcastTheme() {
    const theme = detectTheme();
    
    // Store the theme in local storage for components that initialize later
    chrome.storage.local.set({ extension_theme: theme });
    
    // Send a message to immediately notify active components (like the side panel)
    if (!chrome.runtime?.id) {
      themeObserver?.disconnect();
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: 'THEME_CHANGE', theme }).catch(() => {
        // Catch errors when no listeners are active (e.g., side panel is closed)
      });
    } catch (err) {
      themeObserver?.disconnect();
    }
  }

  // Initial detection when the script loads
  broadcastTheme();

  // Set up an observer to watch for theme toggles by the user on the host page
  const themeObserver = new MutationObserver(() => {
    broadcastTheme();
  });

  // Watch the <html> element for class or data-theme changes
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme']
  });

  // Cleanup observer on page unload to prevent memory leaks
  window.addEventListener('beforeunload', () => {
    themeObserver?.disconnect();
  });
}
