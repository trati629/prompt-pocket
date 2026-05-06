/**
 * Universal AI Prompt Templates
 * content/content.js
 * 
 * Central core logic shared by injector.js and overlay.js
 */

const PromptPocketCore = (function() {
  const SELECTORS = {
    'chatgpt.com': [
      '#prompt-textarea',
      'div[contenteditable="true"][data-id]',
      'div[contenteditable="true"]',
      'textarea[data-id]',
    ],
    'copilot.microsoft.com': [
      '#userInput',
      'textarea[placeholder="Message Copilot"]',
      '#composer-input textarea',
      '#composer textarea',
    ],
    'm365.cloud.microsoft': [
      'textarea[aria-label]',
      '#m365-chat-textarea',
      'div[contenteditable="true"][aria-label]',
      'div[contenteditable="true"]',
      'textarea',
    ],
    'gemini.google.com': [
      'div[contenteditable="true"][aria-label]',
      '.ql-editor',
      'rich-textarea div[contenteditable]',
      'div[contenteditable="true"]',
    ],
    'claude.ai': [
      'div[contenteditable="true"][data-placeholder]',
      '.ProseMirror',
      'div[contenteditable="true"]',
    ],
  };

  function getHostKey() {
    const h = window.location.hostname;
    if (h.includes('chatgpt.com') || h.includes('chat.openai.com')) return 'chatgpt.com';
    if (h.includes('copilot.microsoft.com'))  return 'copilot.microsoft.com';
    if (h.includes('m365.cloud.microsoft'))   return 'm365.cloud.microsoft';
    if (h.includes('gemini.google.com'))      return 'gemini.google.com';
    if (h.includes('claude.ai'))              return 'claude.ai';
    return null;
  }

  function getInputBox() {
    const key = getHostKey();
    if (!key) return null;
    for (const sel of SELECTORS[key]) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function insertText(text) {
    const input = getInputBox();
    if (!input) return false;
    
    input.focus();
    if (input.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, text);
    } else {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      ).set;
      nativeSetter.call(input, input.value + text);
      input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    return true;
  }

  return { SELECTORS, getHostKey, getInputBox, insertText };
})();
