/**
 * Universal AI Prompt Templates
 * content/injector.js
 * 
 * Responsible for listening to insert commands from the sidepanel.
 * Relies on content.js for core DOM logic.
 */

if (!window.__ai_prompts_injector_injected) {
  window.__ai_prompts_injector_injected = true;

  // Listen for messages from the side panel requesting an insertion
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    
    if (message.type === 'INSERT') {
      const ok = PromptPocketCore.insertText(message.text);
      sendResponse({ success: ok });
    }
  });
}
