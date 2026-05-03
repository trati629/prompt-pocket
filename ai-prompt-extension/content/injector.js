/**
 * Universal AI Prompt Templates
 * content/injector.js
 * 
 * Responsible for locating the AI's chat input box and safely injecting text into it.
 * Uses a robust array of fallback selectors in case the host AI updates its UI.
 */

if (!window.__ai_prompts_injector_injected) {
  window.__ai_prompts_injector_injected = true;

  // Mapping of supported AI hosts to their potential input box CSS selectors
  const SELECTORS = {
    'chatgpt.com': [
      '#prompt-textarea',
      'div[contenteditable="true"][data-id]',
      'div[contenteditable="true"]',
      'textarea[data-id]'
    ],
    'copilot.microsoft.com': [
      '#userInput',
      'textarea[placeholder="Message Copilot"]',
      '#composer-input textarea',
      '#composer textarea'
    ]
  };

  /**
   * Determines which AI host we are currently on.
   * @returns {string|null} The key matching the SELECTORS map, or null if unsupported.
   */
  function getHostType() {
    if (window.location.hostname.includes('chatgpt.com') || window.location.hostname.includes('chat.openai.com')) return 'chatgpt.com';
    if (window.location.hostname.includes('copilot.microsoft.com')) return 'copilot.microsoft.com';
    return null;
  }

  /**
   * Scans the DOM for the AI's input box using the configured fallback selectors.
   * Note: Future updates might require Shadow DOM piercing here for Copilot.
   * @returns {HTMLElement|null} The input element, or null if not found.
   */
  function getInputBox() {
    const host = getHostType();
    if (!host) return null;
    
    for (const selector of SELECTORS[host]) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  /**
   * Injects text into the identified input box and triggers native input events
   * so that React/UI frameworks pick up the change.
   * @param {string} text - The prompt text to insert.
   * @returns {boolean} true on success, false if the input box was not found.
   */
  function insertText(text) {
    const input = getInputBox();

    if (!input) {
      console.error('[Universal AI Prompt Templates] Could not find the AI input box to insert text.');
      if (chrome.runtime?.id) {
        try {
          chrome.runtime.sendMessage({ type: 'INJECT_ERROR', reason: 'input_not_found' }).catch(() => {});
        } catch (err) {
          // Context invalidated
        }
      }
      return false;
    }

    input.focus();

    if (input.isContentEditable) {
      // ChatGPT uses a contenteditable div. execCommand requires an active cursor
      // inside the element — focus() alone doesn't place one, so we set it manually.
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false); // collapse to end
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, text);
    } else {
      // Copilot uses a React-controlled <textarea>. React intercepts synthetic events
      // but ignores direct .value mutations unless we go through the native setter.
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set;
      nativeSetter.call(input, input.value + text);
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }

    return true;
  }

  // Listen for messages from the side panel or overlay requesting an insertion
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'INSERT') {
      const ok = insertText(message.text);
      sendResponse({ success: ok });
    }
  });

  // Watch for DOM changes to detect when the input box finally renders (SPA async load).
  // Disconnects once found — Phase 4 will re-attach its own observer for the overlay trigger.
  const inputObserver = new MutationObserver(() => {
    if (getInputBox()) {
      inputObserver.disconnect();
    }
  });
  inputObserver.observe(document.body, { childList: true, subtree: true });

  // Cleanup observer on page unload
  window.addEventListener('beforeunload', () => {
    inputObserver?.disconnect();
  });
}
