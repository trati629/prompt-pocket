# 🚀 Prompt Pocket v0.1.0 (Beta Release)

We are thrilled to announce **v0.1.0** of Prompt Pocket! This release introduces our most requested feature: the **Overlay UI**. You can now access, search, and insert your prompt templates directly from inside your favorite AI chat windows without ever opening the side panel. 

This release also brings a massive wave of security hardening, performance optimizations, and critical bug fixes to ensure the extension remains lightweight, safe, and reliable.

## ✨ New Features

* **Floating Action Button (FAB) & Overlay Popover:** A sleek, non-intrusive FAB is now injected into all supported AI platforms (ChatGPT, Copilot, M365 Copilot, Gemini, Claude). 
    * **Context-Aware:** The FAB remains in a small, dormant state until you focus the AI's chat input, springing to life when you need it.
    * **Full UI Isolation:** The overlay is built inside a declarative Shadow DOM, guaranteeing that host-page CSS (like ChatGPT's styles) can never interfere with or break the Prompt Pocket UI.
    * **Keyboard Driven:** Hit `Cmd/Ctrl + K` inside the popover to instantly search your templates.

## 🛡️ Security Hardening

We conducted a ruthless security audit to harden the extension against the OWASP Top 10 and extension-specific attack vectors:
* **Message Verification:** Implemented strict `sender.id` verification across all `chrome.runtime.onMessage` listeners to completely prevent cross-extension message spoofing.
* **Prototype Pollution Guards:** Hardened the JSON parser during bulk imports. The parser now strictly strips `__proto__`, `constructor`, and `prototype` keys before touching storage.
* **XSS Mitigation:** Removed legacy, unescaped mock fields from the overlay HTML builder to close potential stored XSS vectors during import.
* **Data Integrity:** Implemented mandatory SHA-256 signature generation and verification for all exported backup envelopes (V2 Schema) to ensure data cannot be tampered with outside the extension.
* **Resource Exhaustion:** Capped bulk import file sizes at 5MB and hardened Unicode/Hex validation.

## 🐛 Bug Fixes & Optimizations

* **Fixed IPC Flooding (CPU Drain):** The DOM selector canary was continuously transmitting health reports every 500ms while typing. It now tracks state hashes and only dispatches messages to the background worker when a selector's health actually changes.
* **Fixed Search Input Focus:** The overlay list view was rebuilding the entire DOM on every keystroke, causing the search box to drop focus. Refactored `renderListView` to only rebuild the template nodes.
* **Fixed Storage Quota Warning:** The quota monitor was mistakenly checking `chrome.storage.local` limits (5MB) while templates are stored in `chrome.storage.sync`. It now correctly warns you when approaching the strict 100KB Sync limit.
* **Fixed UI Duplication:** Added state guards to `openPopover()` to prevent rapid keyboard shortcuts from mounting duplicate overlay DOM nodes.
* **Fixed Health Banner:** The Side Panel health banner now correctly maps errors for Gemini, Claude, and M365 Copilot instead of silently dropping them.
* **Code Quality:** Centralized duplicate DOM injection and selector logic from `injector.js` and `overlay.js` into a shared `content.js` module running safely within the extension's Isolated World.

## ⚙️ Supported Platforms
* ChatGPT (`chatgpt.com`, `chat.openai.com`)
* Microsoft Copilot (`copilot.microsoft.com`)
* Microsoft 365 Copilot (`m365.cloud.microsoft`)
* Google Gemini (`gemini.google.com`)
* Claude (`claude.ai`)

---

**Installation:** Available via the Chrome Web Store (pending review) or installable locally via Developer Mode using the latest `main` branch.
