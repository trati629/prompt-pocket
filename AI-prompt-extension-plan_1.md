# Universal AI Prompt Templates — Chrome Extension Plan

> Developer-mode Chrome extension for managing and inserting prompt templates into various AI web interfaces (ChatGPT, Microsoft Copilot, and extensible for future AIs).

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [High Level Design (HLD)](#2-high-level-design-hld)
3. [Low Level Design (LLD)](#3-low-level-design-lld)
4. [Phase Structure Overview](#4-phase-structure-overview)
5. [Phase 1 — Core Extension Framework](#5-phase-1--core-extension-framework)
6. [Phase 2 — Template Management](#6-phase-2--template-management)
7. [Phase 3 — Backup & Restore](#7-phase-3--backup--restore)
8. [Phase 4 — Inline Insertion Surface](#8-phase-4--inline-insertion-surface)
9. [Phase 5 — Library Harvest & Import](#9-phase-5--library-harvest--import)
10. [Phase 6 — Community Submission Pipeline](#10-phase-6--community-submission-pipeline)
11. [Action Flows](#11-action-flows)
12. [Known Gaps & Open Decisions](#12-known-gaps--open-decisions)
13. [Deferred Features](#13-deferred-features)
14. [Developer Mode Notes](#14-developer-mode-notes)

---

## 1. Project Overview

A Chrome extension running in developer mode (not published to the Chrome Web Store) that sits alongside supported AI web apps and allows the user to:

- Insert predefined or custom prompt templates directly into the AI's chat input box — either from the side panel **or** from an inline icon next to the input (Grammarly / 1Password style)
- Save, edit, and organise personal prompt templates
- Submit new prompts to a community library via a moderated GitHub Issues pipeline
- Browse and import community prompt libraries sourced and harvested from GitHub repos

**Target URLs:** 
- `https://chatgpt.com/*`
- `https://chat.openai.com/*`
- `https://copilot.microsoft.com/*`
- *(Architecture designed to allow easy addition of future AI platforms)*

**Mode:** Developer mode — Load Unpacked. PWA web app window supported.
**Not published to the Chrome Web Store.**

---

## 2. High Level Design (HLD)

### 2.1 System Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    CHROME BROWSER                       │
│                                                         │
│  ┌──────────────────────┐   ┌────────────────────────┐  │
│  │   Active AI Tab      │   │   Side Panel           │  │
│  │   (ChatGPT/Copilot)  │◄──┤                        │  │
│  │  content.js          │   │  sidepanel.html/js/css │  │
│  │  injector.js         │   │  (Main UI)             │  │
│  │  theme-detector.js   │   │                        │  │
│  │  overlay.js (inline  │   │  dormant.html          │  │
│  │   icon + picker)     │   │  (Off Supported UI)    │  │
│  │  selector-canary.js  │   │                        │  │
│  └──────────┬───────────┘   └──────────┬─────────────┘  │
│             │  chrome.runtime.messages │                │
│             ▼                          ▼                │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Service Worker (background)         │   │
│  │  - Panel routing (active vs dormant)             │   │
│  │  - Icon state management                         │   │
│  │  - Selector-health aggregation                   │   │
│  │  - Message broker between content and side panel │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │                               │
│             ┌───────────┴────────────┐                  │
│             ▼                        ▼                  │
│  ┌─────────────────┐    ┌────────────────────────────┐  │
│  │ chrome.storage  │    │ chrome.storage.local       │  │
│  │ .sync           │    │                            │  │
│  │ - user_templates│    │ - settings                 │  │
│  │ - schema_version│    │ - extension_theme          │  │
│  └─────────────────┘    │ - library_meta             │  │
│                         │ - library_prompts          │  │
│                         │ - auto_backups             │  │
│                         │ - selector_health          │  │
│                         └────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    GITHUB (Remote)                      │
│                                                         │
│  ┌────────────────┐   ┌───────────────────────────────┐ │
│  │  GitHub Issues │   │  GitHub Actions               │ │
│  │  (Submissions) │──►│  - screen-submission.yml      │ │
│  │                │   │  - process-approval.yml       │ │
│  └────────────────┘   │  - harvest-prompts.yml        │ │
│                       └───────────────┬───────────────┘ │
│                                       │                 │
│                       ┌───────────────▼───────────────┐ │
│                       │  Repository Files             │ │
│                       │  - registry.json              │ │
│                       │  - dist/libraries/*.json      │ │
│                       │  - filter-report.json         │ │
│                       │  - manual-blocklist.json      │ │
│                       │  - manual-allowlist.json      │ │
│                       └───────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Component Responsibilities

| Component | Responsibility |
|---|---|
| `content.js` | Entry point for page injection. Coordinates injector, theme detector, overlay, and canary. |
| `injector.js` | Detects current AI host and target input box. Inserts text into specific input element. |
| `theme-detector.js` | Reads AI DOM for light/dark state based on current host. Broadcasts to storage and side panel. |
| `overlay.js` | Renders the inline picker icon next to the AI input box and its dropdown picker UI. |
| `selector-canary.js` | On load and on DOM mutation, runs candidate selectors and reports which (if any) matched. |
| `service-worker.js` | Routes side panel between active and dormant. Manages icon state. Aggregates selector health. Brokers messages. |
| `sidepanel.html/js` | Main UI. Template list, search, CRUD, library browser, settings, backup, selector-health badge. |
| `dormant.html` | Minimal UI shown when not on a supported AI site. Links to open AI platforms. |
| `harvest.js` (GitHub) | Fetches source repos, normalises, filters, writes output JSON files. |
| `screen-submission.js` (GitHub) | Parses Issue form, runs NSFW and injection filters, posts report comment. |
| `add-to-library.js` (GitHub) | Validates, deduplicates, appends approved submission to community JSON. |

### 2.3 Data Flow — Template Insert (Side Panel)

```
User clicks template in side panel
        ↓
sidepanel.js sends chrome.runtime.sendMessage({ type: 'INSERT', text })
        ↓
service-worker.js forwards to content script via chrome.tabs.sendMessage
        ↓
injector.js determines host (ChatGPT/Copilot) and calls insertText(text)
        ↓
Target AI input receives text and native input event
        ↓
React/UI state updates — user sees text in input box
```

### 2.4 Data Flow — Template Insert (Inline Overlay)

```
overlay.js positions icon near input box
        ↓
User clicks inline icon (or presses keyboard shortcut while focused in input)
        ↓
overlay.js renders picker dropdown anchored to icon
        ↓
overlay.js requests templates list via chrome.runtime.sendMessage({ type: 'LIST_TEMPLATES' })
        ↓
service-worker.js or sidepanel resolves from chrome.storage and replies
        ↓
User searches / clicks template title in dropdown
        ↓
overlay.js calls injector.insertText(text) directly (same module, same page context)
        ↓
Target AI input receives text and native input event — overlay closes
```

### 2.5 Data Flow — Theme Detection

```
AI page loads (ChatGPT or Copilot)
        ↓
theme-detector.js checks host and reads appropriate DOM attributes
        ↓
Stored in chrome.storage.local as extension_theme
        ↓
chrome.runtime.sendMessage({ type: 'THEME_CHANGE', theme }) broadcast
        ↓
sidepanel.js and overlay.js both receive message
        ↓
data-theme attribute set on relevant root → CSS variables switch
```

### 2.6 Data Flow — Library Download

```
User opens Libraries tab
        ↓
Fetch registry.json from GitHub raw URL
        ↓
Display available libraries with metadata
        ↓
User toggles library and clicks Download
        ↓
Fetch dist/libraries/{id}.json
        ↓
Store in chrome.storage.local under library_prompts[id]
        ↓
Update library_meta[id] with downloaded_at and version
        ↓
Prompts appear in template list with source badge
```

### 2.7 Data Flow — Community Submission

```
User creates GitHub Issue using structured form
        ↓
screen-submission.yml fires
        ↓
NSFW and injection filters run
        ↓
Issue labelled and screening report posted as comment
        ↓
Maintainer reviews and comments /approve or /reject
        ↓
process-approval.yml fires
        ↓
add-to-library.js writes to community-submissions.json
        ↓
Committed to repo
        ↓
Available to extension users on next library download
```

### 2.8 Data Flow — Selector Health Canary

```
content.js loads on supported AI tab
        ↓
selector-canary.js runs every selector for the host's input + theme attrs
        ↓
chrome.runtime.sendMessage({ type: 'SELECTOR_HEALTH', host, results })
        ↓
service-worker.js writes chrome.storage.local.selector_health[host] = results
        ↓
sidepanel.js subscribes via storage.onChanged
        ↓
If primary_match === false → side panel shows amber banner:
    "ChatGPT input not detected — selectors may be out of date"
        ↓
MutationObserver re-runs canary on DOM changes; banner clears when match restored
```

---

## 3. Low Level Design (LLD)

### 3.1 Manifest

```json
{
  "manifest_version": 3,
  "name": "Universal AI Prompt Templates",
  "version": "1.0.0",
  "description": "Insert, manage and import prompt templates across supported AI web apps",
  "permissions": ["sidePanel", "storage", "activeTab", "scripting", "tabs"],
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "action": {
    "default_title": "Universal AI Prompt Templates",
    "default_icon": {
      "128": "icons/icon-inactive-128.png"
    }
  },
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_scripts": [
    {
      "matches": [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://copilot.microsoft.com/*"
      ],
      "js": ["content/content.js"],
      "css": ["content/overlay.css"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["sidepanel/*", "icons/*", "content/overlay-icon.svg"],
      "matches": [
        "https://chatgpt.com/*",
        "https://copilot.microsoft.com/*"
      ]
    }
  ]
}
```

### 3.2 Folder Structure

```
/ai-prompt-extension
├── manifest.json
├── background/
│   └── service-worker.js
├── content/
│   ├── content.js               ← entry point, coordinates modules
│   ├── injector.js              ← input detection and text insertion
│   ├── theme-detector.js        ← light/dark mode detection
│   ├── selector-canary.js       ← selector-health self-test (Phase 1)
│   ├── overlay.js               ← inline icon + picker dropdown (Phase 4)
│   ├── overlay.css              ← overlay shadow-DOM styles (Phase 4)
│   └── overlay-icon.svg         ← inline icon glyph
├── sidepanel/
│   ├── sidepanel.html           ← main UI
│   ├── sidepanel.js
│   ├── sidepanel.css
│   └── dormant.html             ← minimal UI (off supported AI)
├── scripts/                     ← GitHub Action scripts (not in extension bundle)
│   ├── harvest.js
│   ├── screen-submission.js
│   ├── add-to-library.js
│   ├── remove-from-library.js
│   └── filters/
│       ├── nsfw.js
│       └── injection.js
├── icons/
│   ├── icon-active-128.png
│   └── icon-inactive-128.png
├── templates/
│   └── defaults.json            ← bundled starter templates
├── HTMLTestframe/                ← real saved pages used as DOM fixtures
│   ├── ChatGPT.html              ← live save of chatgpt.com (input + theme attrs intact)
│   ├── ChatGPT_files/            ← supporting CSS/JS/images
│   ├── Microsoft Copilot_ Your AI companion.html
│   └── Microsoft Copilot_ Your AI companion_files/
├── test/
│   ├── fixtures/
│   │   ├── prompts-should-pass.json
│   │   ├── prompts-should-block.json
│   │   ├── backup-golden.backup
│   │   ├── harvest-input-csv.csv
│   │   ├── harvest-input-json.json
│   │   └── community-submissions-seed.json
│   └── unit/                    ← Vitest specs (load HTMLTestframe pages via jsdom)
├── dist/                        ← generated by harvest Action
│   └── libraries/
│       ├── awesome-chatgpt-prompts.json
│       └── community-submissions.json
├── registry.json                ← generated by harvest Action
├── filter-report.json           ← generated by harvest Action
├── manual-blocklist.json        ← maintained manually
├── manual-allowlist.json        ← maintained manually
├── CONTRIBUTING.md
└── README.md
```

### 3.3 Core Data Schemas

Every persisted schema carries an explicit `schema_version` integer (see [3.11 Schema Versioning](#311-schema-versioning-strategy)).

#### User Template
```json
{
  "schema_version": 1,
  "id": "uuid-v4",
  "title": "Explain Like I'm 5",
  "body": "Explain the following in simple terms...",
  "category": "General",
  "tags": ["explain", "simple"],
  "source": "user",
  "created_at": "2026-05-02T10:00:00Z",
  "modified_at": "2026-05-02T10:00:00Z"
}
```

#### Library Prompt
```json
{
  "schema_version": 1,
  "id": "abc123",
  "title": "Act as a Linux Terminal",
  "body": "I want you to act as a linux terminal...",
  "category": "Developer",
  "tags": ["linux", "terminal"],
  "source": "awesome-chatgpt-prompts",
  "contributor": null,
  "last_updated": "2026-05-02T02:00:00Z"
}
```

#### Community Submission Prompt
```json
{
  "schema_version": 1,
  "id": "abc456",
  "title": "Explain a Pull Request",
  "body": "Explain this pull request in plain English...",
  "category": "Developer",
  "tags": ["git", "code-review"],
  "source": "community-submissions",
  "contributor": "github-username",
  "approved_at": "2026-05-02T10:00:00Z",
  "issue_number": 42
}
```

#### Settings Schema
```json
{
  "schema_version": 1,
  "theme_override": "follow",
  "default_category": "General",
  "keyboard_shortcut": "Ctrl+Shift+P",
  "inline_overlay_enabled": true,
  "library_toggles": {
    "awesome-chatgpt-prompts": true,
    "community-submissions": false
  }
}
```

#### Library Meta Schema
```json
{
  "schema_version": 1,
  "libraries": {
    "awesome-chatgpt-prompts": {
      "enabled": true,
      "downloaded_at": "2026-05-01T10:00:00Z",
      "last_updated": "2026-05-01",
      "prompt_count": 153
    }
  }
}
```

#### Backup File Schema
```json
{
  "sha256": "e3b0c44298fc1c149afb4c8996fb924...",
  "backup_version": 1,
  "schema_version": 1,
  "created_at": "2026-05-02T10:00:00Z",
  "extension_version": "1.0.0",
  "metadata": {
    "template_count": 24,
    "description": "Optional user note"
  },
  "data": {
    "user_templates": [],
    "settings": {}
  }
}
```

`backup_version` describes the **envelope format** (hash field, metadata block, etc). `schema_version` describes the **inner data shapes** (templates, settings). They are independent — a future `schema_version` bump does not require a `backup_version` bump.

#### Registry File (Repo-Side)
```json
{
  "schema_version": 1,
  "generated": "2026-05-02T02:00:00Z",
  "libraries": [ /* see Phase 5 */ ]
}
```

### 3.4 chrome.storage Layout

```
chrome.storage.sync                   ← syncs across Chrome profiles
├── user_templates[]                  ← 100KB total / 8KB per item limit
│                                       falls back to local if exceeded
└── schema_version                    ← integer, drives migrations on extension upgrade

chrome.storage.local                  ← device only, larger capacity
├── extension_theme                   ← "dark" or "light"
├── settings{}                        ← user preferences (incl. inline_overlay_enabled)
├── library_meta{}                    ← toggle state per library
├── library_prompts{}                 ← downloaded prompt arrays keyed by library id
├── auto_backups[]                    ← last 3 rolling snapshots (created in Phase 2,
│                                       surfaced as Recovery Points in Phase 3)
└── selector_health{}                 ← per-host last-known canary result (Phase 1)
```

### 3.5 Input Box Detection and Insertion

```js
// content/injector.js

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
// Selectors verified against HTMLTestframe/Microsoft Copilot_ Your AI companion.html
// (saved 2026-05). Replace if Copilot's composer DOM changes — the canary in 3.12
// will surface drift within one user session.

function getHostType() {
  if (window.location.hostname.includes('chatgpt.com') || window.location.hostname.includes('chat.openai.com')) return 'chatgpt.com';
  if (window.location.hostname.includes('copilot.microsoft.com')) return 'copilot.microsoft.com';
  return null;
}

function getInputBox() {
  const host = getHostType();
  if (!host) return null;
  for (const selector of SELECTORS[host]) {
    // Note: Copilot might need shadow DOM piercing depending on their Web Components setup
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function insertText(text) {
  const input = getInputBox();
  if (!input) {
    chrome.runtime.sendMessage({ type: 'INJECT_ERROR', reason: 'input_not_found' });
    return;
  }
  input.focus();
  document.execCommand('insertText', false, text);
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

const inputObserver = new MutationObserver(() => {
  if (getInputBox()) attachTrigger();
});
inputObserver.observe(document.body, { childList: true, subtree: true });

function cleanup() {
  inputObserver?.disconnect();
  themeObserver?.disconnect();
  clearTimeout(retryTimer);
}
window.addEventListener('beforeunload', cleanup);
```

### 3.6 Theme Detection

```js
// content/theme-detector.js

function detectTheme() {
  const html = document.documentElement;
  let isDark = false;
  
  if (window.location.hostname.includes('chatgpt.com') || window.location.hostname.includes('chat.openai.com')) {
    isDark = html.classList.contains('dark') || html.getAttribute('data-theme') === 'dark';
  } else if (window.location.hostname.includes('copilot.microsoft.com')) {
    // Copilot uses <html data-theme="dark|light">, verified against
    // HTMLTestframe/Microsoft Copilot_ Your AI companion.html (saved 2026-05).
    isDark = html.getAttribute('data-theme') === 'dark';
  }
  
  return isDark ? 'dark' : 'light';
}

function broadcastTheme() {
  const theme = detectTheme();
  chrome.storage.local.set({ extension_theme: theme });
  chrome.runtime.sendMessage({ type: 'THEME_CHANGE', theme });
}

broadcastTheme();

const themeObserver = new MutationObserver(() => broadcastTheme());
themeObserver.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class', 'data-theme']
});
```

### 3.7 Side Panel Routing

```js
// background/service-worker.js

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

async function updatePanel(tabId, url) {
  const isSupportedAI =
    url?.includes('chatgpt.com') ||
    url?.includes('chat.openai.com') ||
    url?.includes('copilot.microsoft.com');

  await chrome.sidePanel.setOptions({
    tabId,
    path: isSupportedAI
      ? 'sidepanel/sidepanel.html'
      : 'sidepanel/dormant.html',
    enabled: true
  });

  chrome.action.setIcon({
    tabId,
    path: isSupportedAI
      ? { 128: 'icons/icon-active-128.png' }
      : { 128: 'icons/icon-inactive-128.png' }
  });

  chrome.action.setTitle({
    tabId,
    title: isSupportedAI
      ? 'Universal AI Prompt Templates'
      : 'Prompt Templates — Navigate to a supported AI to use'
  });
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  updatePanel(tabId, tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete') updatePanel(tabId, tab.url);
});
```

### 3.8 CSS Token System

```css
/* sidepanel/sidepanel.css */

/* Dark mode — default, matches ChatGPT dark theme */
:root {
  --bg-primary:     #212121;
  --bg-secondary:   #2f2f2f;
  --bg-surface:     #3a3a3a;
  --bg-hover:       #404040;
  --text-primary:   #ececec;
  --text-secondary: #8e8ea0;
  --text-muted:     #5e5e6e;
  --border-color:   rgba(255,255,255,0.1);
  --border-focus:   rgba(255,255,255,0.25);
  --accent:         #10a37f;
  --accent-hover:   #0d8a6b;
  --accent-text:    #ffffff;
  --shadow:         rgba(0,0,0,0.4);
  --radius:         12px;
  --radius-sm:      8px;
  --font: 'Söhne', ui-sans-serif, system-ui, -apple-system,
          'Segoe UI', Helvetica, Arial, sans-serif;
}

/* Light mode override */
:root[data-theme="light"] {
  --bg-primary:     #ffffff;
  --bg-secondary:   #f7f7f8;
  --bg-surface:     #efefef;
  --bg-hover:       #e5e5e5;
  --text-primary:   #0d0d0d;
  --text-secondary: #6e6e80;
  --text-muted:     #acacbe;
  --border-color:   rgba(0,0,0,0.1);
  --border-focus:   rgba(0,0,0,0.25);
  --shadow:         rgba(0,0,0,0.1);
}
```

Theme priority order:
```
1. User manual override (settings.theme_override in chrome.storage.sync)
2. Detected AI host DOM theme (extension_theme in chrome.storage.local)
3. OS prefers-color-scheme
4. Dark — final default, prevents white flash on open
```

The same token set is reused inside the inline overlay's Shadow DOM (Phase 4), so theme switches stay coherent across both UIs.

### 3.9 SHA-256 Backup Integrity

```js
// Deterministic stringify — required for reproducible hash
function sortedStringify(obj) {
  return JSON.stringify(obj, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value).sort().reduce((sorted, k) => {
        sorted[k] = value[k];
        return sorted;
      }, {});
    }
    return value;
  });
}

async function computeHash(data) {
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sortedStringify(data))
  );
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Validation — hash check runs before all other checks
async function validateBackupFile(fileContent) {
  let parsed;
  try { parsed = JSON.parse(fileContent); }
  catch { return { valid: false, errors: ['File could not be read — may be corrupt'] }; }

  if (!parsed.sha256)
    return { valid: false, errors: ['Backup is missing its integrity hash'] };

  const computed = await computeHash(parsed.data);
  if (computed !== parsed.sha256)
    return { valid: false, errors: ['Backup has been modified or corrupted'] };

  const errors = [];
  if (!parsed.backup_version)
    errors.push('Missing backup version');
  if (parsed.backup_version > CURRENT_BACKUP_VERSION)
    errors.push('Backup made with newer extension version — update first');
  if (!Array.isArray(parsed.data?.user_templates))
    errors.push('Templates data missing or corrupt');
  parsed.data?.user_templates?.forEach((t, i) => {
    if (!t.title) errors.push(`Template ${i + 1} missing title`);
    if (!t.body)  errors.push(`Template ${i + 1} missing body`);
  });

  return { valid: errors.length === 0, errors, parsed };
}
```

### 3.10 Safety Filters

```js
// scripts/filters/nsfw.js
const NSFW_PATTERNS = [
  /\b(porn|xxx|nude|nsfw|explicit|erotic|hentai)\b/i,
  /\bact as .*(girlfriend|boyfriend|lover|dominant|submissive)\b/i,
  /\b(18\+|adults only|sexual(ly)?|fetish)\b/i,
];

export function isNSFW(prompt) {
  const text = `${prompt.title} ${prompt.body}`;
  return NSFW_PATTERNS.some(p => p.test(text));
}
```

```js
// scripts/filters/injection.js

const INJECTION_PATTERNS = [
  /ignore (all )?(previous|above|prior) instructions/i,
  /disregard (your )?(previous|prior|all|any)/i,
  /forget (everything|all|what).*(told|said|instructed)/i,
  /you are now (a |an )?(new|different|unrestricted|jailbroken)/i,
  /pretend (you have no|you don't have|there are no) (restrictions|limits|rules)/i,
  /\[system\]/i,
  /\[developer\]/i,
  /<\|im_start\|>/i,
  /repeat (everything|all|the|your) (above|previous|system)/i,
  /output (your|the) (system prompt|instructions|context)/i,
  /\bDAN\b/,
  /jailbreak/i,
  /developer mode/i,
  /do anything now/i,
];

const INJECTION_WARNINGS = [
  /\[.*\]/,
  /<<<|>>>/,
  /you must (now|always|never)/i,
];

export function checkInjection(prompt) {
  const text = `${prompt.title} ${prompt.body}`;
  const blocked = INJECTION_PATTERNS.find(p => p.test(text));
  if (blocked) return { blocked: true, pattern: String(blocked) };
  const warnings = INJECTION_WARNINGS.filter(p => p.test(text));
  if (warnings.length) return { blocked: false, warning: true, patterns: warnings.map(String) };
  return { blocked: false };
}
```

**Trusted external filter sources:**

| Source | Type |
|---|---|
| OWASP LLM Cheat Sheet | Pattern list and reference code |
| OWASP AI Testing Guide | Attack taxonomy |
| LLM Guard — ProtectAI | Open source ML scanner |
| Llama Prompt Guard 2 — Meta | BERT classifier, open source |
| Garak — NVIDIA | Probe library |

**Known filter limitations:**
- Obfuscated text and non-English injections bypass regex
- Non-ASCII-dominant prompts flagged in filter-report.json for manual review
- Typoglycemia attacks partially caught via fuzzy word matching

### 3.11 Schema Versioning Strategy

Every persisted blob carries a `schema_version` integer that starts at `1`. The version is the contract — code reads any blob and either understands it directly or runs it through a migration step before use.

**Rules:**
- A bump means **breaking change** to the inner shape (rename, remove, type change). Pure additive changes (adding an optional field) do **not** bump.
- Migration code lives in `sidepanel/migrations.js` (and equivalent in `scripts/` for repo-side data). Functions named `migrate_v1_to_v2(blob)`, `migrate_v2_to_v3(blob)`, etc.
- On extension load, `runMigrations(blob)` walks from the blob's `schema_version` to the current version, applying each step. Failure → block with a "data migration failed" UI, never silently drop data.
- Old migration functions are **kept forever**. A user upgrading from v1 to v4 still needs v1→v2→v3→v4 to run.

**Versioned blobs:**

| Blob | Storage | Versions live where |
|---|---|---|
| `user_templates[]` items | `chrome.storage.sync` | Per-item `schema_version` field |
| `settings{}` | `chrome.storage.local` | Top-level `schema_version` field |
| `library_meta{}` | `chrome.storage.local` | Top-level wrapper `{ schema_version, libraries: {...} }` |
| `library_prompts[]` items | `chrome.storage.local` | Per-item `schema_version` field (carried through from library JSON) |
| Library JSON file (`dist/libraries/*.json`) | Repo | Top-level `{ schema_version, prompts: [...] }` |
| `registry.json` | Repo | Top-level `schema_version` |
| `.backup` envelope | File | Top-level `backup_version` (envelope) **and** `schema_version` (inner data) — see [3.3](#33-core-data-schemas) |

**Cross-version compatibility:**
- Extension reads a backup whose `schema_version` is **older** than current → run forward migrations on the inner data, then import.
- Extension reads a backup whose `schema_version` is **newer** than current → block with "this backup was made with a newer extension — please update first".
- Library JSON downloaded from registry whose `schema_version` is newer than what the extension knows → skip download with a UI hint to update the extension.

**Why a separate field per blob, not a global one:** different blobs evolve independently. Templates may bump while settings stay untouched. A single global counter forces unrelated migrations on every change.

### 3.12 Selector Health Canary

Goal: detect ChatGPT or Copilot DOM changes that break input/theme detection within one user session, instead of waiting for a bug report.

```js
// content/selector-canary.js

const CANARY_TARGETS = {
  'chatgpt.com': {
    input: ['#prompt-textarea', 'div[contenteditable="true"][data-id]', 'div[contenteditable="true"]'],
    theme: ['html.dark', 'html[data-theme="dark"]', 'html[data-theme="light"]']
  },
  'copilot.microsoft.com': {
    input: ['#userInput', 'textarea[placeholder="Message Copilot"]', '#composer-input textarea'],
    theme: ['html[data-theme="dark"]', 'html[data-theme="light"]']
  }
};
// Targets verified against HTMLTestframe/Microsoft Copilot_ Your AI companion.html.

function runCanary() {
  const host = getHostType();
  if (!host) return;
  const targets = CANARY_TARGETS[host];
  const results = {
    host,
    checked_at: new Date().toISOString(),
    input: targets.input.map(sel => ({ sel, matched: !!document.querySelector(sel) })),
    theme: targets.theme.map(sel => ({ sel, matched: !!document.querySelector(sel) })),
  };
  results.primary_match = results.input[0].matched;
  results.any_input_match = results.input.some(r => r.matched);
  results.any_theme_match = results.theme.some(r => r.matched);
  chrome.runtime.sendMessage({ type: 'SELECTOR_HEALTH', results });
}

runCanary();

// Re-run on significant DOM changes (debounced)
let canaryTimer;
new MutationObserver(() => {
  clearTimeout(canaryTimer);
  canaryTimer = setTimeout(runCanary, 500);
}).observe(document.body, { childList: true, subtree: true });
```

**Service worker** stores the latest result per host in `chrome.storage.local.selector_health` and emits a `SELECTOR_HEALTH_CHANGED` event when the `any_input_match` flag flips.

**Side panel** subscribes and renders three states:

| `any_input_match` | `primary_match` | UI |
|---|---|---|
| `true` | `true` | Hidden — everything's working |
| `true` | `false` | Yellow toast: "Using fallback input selector — extension may need an update soon" |
| `false` | `false` | Red banner: "Cannot find the AI's input box — please update the extension" — disables Insert buttons |

Canary results persist between sessions, so the banner appears immediately on side panel open if the last known state was unhealthy.

### 3.13 Inline Insertion Surface — Overlay

The overlay is a content-script-injected UI element rendered next to the AI's input box, similar to the floating icon Grammarly and password managers attach to text fields. Provides a second insertion path alongside the side panel.

**Architecture:**

```js
// content/overlay.js — sketch

const overlayHost = document.createElement('div');
overlayHost.id = '__uap_overlay_root';
const shadow = overlayHost.attachShadow({ mode: 'closed' });
// Shadow DOM isolates our styles from the AI page and theirs from us.

const icon = document.createElement('button');
icon.id = 'uap-icon';
icon.setAttribute('aria-label', 'Insert prompt template');
icon.innerHTML = /* svg */;
shadow.appendChild(icon);

document.body.appendChild(overlayHost);

function positionIcon() {
  const input = getInputBox();
  if (!input) { overlayHost.style.display = 'none'; return; }
  const rect = input.getBoundingClientRect();
  Object.assign(overlayHost.style, {
    position: 'fixed',
    top: `${rect.top + rect.height / 2 - 12}px`,
    left: `${rect.right - 36}px`,
    zIndex: 2147483646,
    display: 'block'
  });
}

new ResizeObserver(positionIcon).observe(document.body);
window.addEventListener('scroll', positionIcon, { passive: true });
window.addEventListener('resize', positionIcon);

icon.addEventListener('click', () => openPicker());
```

**Picker dropdown:**
- Renders inside the same shadow root, anchored under the icon
- Search box at top, list of templates (matching the side panel layout but compact)
- Click → calls `injector.insertText(template.body)` directly (same module already loaded as content script)
- Esc / click-outside / focus-loss → closes
- Theme variables read from the same CSS token set as the side panel ([3.8](#38-css-token-system))

**Settings:**
- `settings.inline_overlay_enabled` — boolean, default `true`. When `false`, the icon is never injected. Toggle in side panel Settings.

**Keyboard shortcut:** when enabled, the configured shortcut (`settings.keyboard_shortcut`) opens the picker if focus is in the AI input box. Shipped in Phase 4.

**Why Shadow DOM (closed):**
- Isolates styles both ways — ChatGPT/Copilot CSS cannot bleed in, and the overlay's CSS cannot break the host page
- `closed` mode means page scripts cannot reach into the picker (defends against the host page accidentally interfering with our DOM)

**Why a button overlay, not modifying the AI's own DOM:**
- Inserting our nodes into the AI's React tree risks instant React re-renders blowing them away
- The `position: fixed` + `body` mount survives re-renders; `ResizeObserver` keeps it tracked

---

## 4. Phase Structure Overview

```
Phase 1 — Core Framework            → working shell, injection proven, theme live, canary live
       ↓
Phase 2 — Template Management       → genuinely useful as a personal tool, auto-backups running
       ↓
Phase 3 — Backup & Restore          → explicit export/import; data protected before any new UX surface
       ↓
Phase 4 — Inline Insertion Surface  → Grammarly-style icon — second insertion path
       ↓
Phase 5 — Library Harvest & Import  → users can browse and download community libraries
       ↓
Phase 6 — Community Submission      → moderated GitHub workflow extends the library system
```

Each phase ends with something complete and independently usable. No phase depends on a later one.

### Phase Alignment Rationale

| Feature | Previous Placement | Assigned Phase | Reason |
|---|---|---|---|
| Side panel setup | No phase | Phase 1 | Foundational architecture — affects everything |
| Theme detection | No phase | Phase 1 | Must exist before any UI is written |
| Off-host (dormant) behaviour | No phase | Phase 1 | Part of the framework, not a later add-on |
| Selector health canary | New | Phase 1 | Detect DOM drift from day one — reduces blind regressions |
| Auto-backup snapshots | Was Phase 3 | Phase 2 | CRUD writes already trigger them in Flow 2 — must exist when CRUD exists |
| Backup & Restore (export/import) | Was Phase 3 | Phase 3 | Builds on Phase 2 auto-backups; protects data before any new UX surface or community features |
| Inline overlay icon | New | Phase 4 | Distinct UX surface; warrants its own phase after data protection is in place |
| Library Harvest & Import | Was Phase 5 (last) | Phase 5 | Must exist before submissions are useful — submissions feed harvest output |
| Community Submission Pipeline | Was Phase 4 | Phase 6 | Depends on Phase 5's library/registry plumbing being live to deliver value |
| Safety filtering | Was Phase 4 | Phase 5 | First needed by the harvest pipeline; reused by Phase 6 |
| Schema versioning fields | Was open gap | Phase 2 onward | Templates ship with `schema_version` from day one |

### Cross-Phase Delivery Pattern — ChatGPT First, Copilot Follows

The project scope is **universal across supported AI hosts**, but **delivery within each phase is ChatGPT-first**. The architecture (selectors map, host detection, theme detection, side panel routing, overlay positioning) stays universal — Copilot support is not deferred to a separate later phase, it ships in the same phase as the ChatGPT work it extends.

Pattern for every phase:

1. Build the phase's feature against ChatGPT only.
2. Hit the phase's **ChatGPT exit criteria** — verified end-to-end on `chatgpt.com`.
3. Extend the same feature to Copilot in the same phase (selectors, theme rules, any Shadow DOM handling).
4. Hit the phase's **Copilot exit criteria** — verified end-to-end on `copilot.microsoft.com`.
5. Phase only fully closes once both hosts pass.

| Phase | ChatGPT-first work | Copilot follow-on within same phase |
|---|---|---|
| 1 | Selectors, theme detection, panel routing, injection, canary on ChatGPT | Same on Copilot — including any Shadow DOM piercing |
| 2 | Templates list, CRUD, search, auto-backups verified inserting into ChatGPT input | Same templates verified inserting into Copilot input |
| 3 | Backup export/import tested with ChatGPT-session data | Same flow with Copilot-session data — verifies host-agnostic storage |
| 4 | Overlay icon positioned correctly next to ChatGPT input; picker inserts | Overlay positioned correctly next to Copilot input (Shadow-DOM-aware); picker inserts |
| 5 | Library download, registry refresh, source badging on ChatGPT side panel | Same library tab and badging verified on Copilot side panel |
| 6 | Submission pipeline produces JSON consumable by ChatGPT first | Same JSON consumed identically when extension is on Copilot |

**Why ChatGPT first within each phase, not Copilot last as its own phase:** if extending to Copilot is hard, the abstraction layer needs work *that* phase, not at the end of the project. Catching host-specific leaks (e.g. selectors that secretly assumed ChatGPT's DOM) while the feature is still small keeps the universal architecture honest.

**Why ChatGPT is the primary host:** larger user base, more stable DOM, faster feedback loop. Copilot's Web Components and possible Shadow DOM make it the harder target — verifying ChatGPT first isolates "is this a feature bug or a host bug?"

---

## 5. Phase 1 — Core Extension Framework

**Goal:** A correctly structured, fully wired extension with no user features yet. Injection proven, side panel running, theme live, off-host states handled, selector canary reporting health.

**Exit criteria — ChatGPT (primary, must pass first):**
- Clicking the icon opens the side panel on ChatGPT.
- A hardcoded test inserts text into the ChatGPT input box.
- Theme correctly reflects ChatGPT's current mode and updates live when ChatGPT's theme changes.
- Navigating away from ChatGPT shows the dormant page.
- Icon dims on non-supported tabs.
- Selector canary reports `primary_match: true` for ChatGPT input and theme; deliberately removing the primary selector from `SELECTORS` and reloading produces a yellow fallback notice in the side panel.

**Exit criteria — Copilot (must pass before Phase 1 fully closes):**
- Same hardcoded insert succeeds on `copilot.microsoft.com` (including Shadow DOM traversal if required).
- Theme detection reflects Copilot's current mode.
- Side panel routes between active and dormant correctly when switching between ChatGPT, Copilot, and unrelated tabs.
- Canary reports healthy on Copilot.

### Deliverables

- `manifest.json` — MV3, sidePanel permission, content script matched to all supported AI URLs (ChatGPT first, Copilot in same phase)
- `background/service-worker.js` — panel routing, icon state management, selector-health aggregation
- `sidepanel/sidepanel.html` — skeleton UI with selector-health banner placeholder
- `sidepanel/dormant.html` — off-host page with Open ChatGPT / Open Copilot buttons and Settings access
- `sidepanel/sidepanel.css` — full CSS token system, both dark and light themes
- `content/content.js` — entry point, coordinates modules
- `content/injector.js` — input detection with multiple fallback selectors, text insertion
- `content/theme-detector.js` — light/dark detection with MutationObserver
- `content/selector-canary.js` — health self-test ([3.12](#312-selector-health-canary))
- End-to-end validation: hardcoded insert proves full pipeline works
- Visible error state in side panel if canary reports input not detected

### Side Panel States

| Tab State | Panel Shows |
|---|---|
| On Supported AI | `sidepanel.html` — full UI |
| On any other page | `dormant.html` — minimal UI |
| Tab switch away from AI | Panel hides automatically (Chrome native behaviour) |
| Tab switch back to AI | Panel re-shows automatically (Chrome native behaviour) |

### Dormant Page Layout
```
┌─────────────────────────┐
│                         │
│          💬             │
│                         │
│   Not on a Supported AI │
│                         │
│  Navigate to ChatGPT or │
│  Copilot to use prompts │
│                         │
│  [ Open ChatGPT ]       │
│  [ Open Copilot ]       │
│                         │
│  ──────────────────     │
│  [⚙️ Settings]          │
│  [💾 Backup & Restore]  │
│                         │
└─────────────────────────┘
```

### Input Box Selector Resilience
If the canary reports no input match, the side panel displays a visible notice rather than failing silently:
> *"Extension cannot find the AI's input box — the UI may have updated. Check for an extension update."*

### Phase 1 Test Plan

**Fixtures:**
- `HTMLTestframe/ChatGPT.html` — real saved ChatGPT page. Verified to contain `#prompt-textarea`, `contenteditable="true"`, and `<html class="dark">`.
- `HTMLTestframe/Microsoft Copilot_ Your AI companion.html` — real saved Copilot page. Verified to contain `#userInput`, `textarea[placeholder="Message Copilot"]`, and `<html data-theme="dark">`.
- Loaded into unit tests via jsdom (`new JSDOM(fs.readFileSync(...))`) and into manual tests via a tiny local static server (`npx serve HTMLTestframe`) so the content script runs against `file://` or `localhost`.
- **When ChatGPT or Copilot ship UI changes:** re-save the page into `HTMLTestframe/`, re-run the canary test, update selectors in [3.5](#35-input-box-detection-and-insertion) / [3.12](#312-selector-health-canary). The saved page is the source of truth for what the extension must match.

**Manual verification (golden path):**
1. Load unpacked, navigate to ChatGPT — icon goes active, side panel opens with skeleton UI.
2. From sidepanel devtools, dispatch `INSERT` message with a known string → string appears in ChatGPT input.
3. Toggle ChatGPT between dark and light → side panel theme switches without flash.
4. Repeat 1–3 against Copilot.
5. Navigate to a non-AI tab → icon dims, dormant page shows, Open ChatGPT button works.

**Manual verification (failure modes):**
- In `injector.js`, comment out the primary selector for ChatGPT → reload → yellow fallback banner appears in side panel.
- Comment out **all** ChatGPT selectors → reload → red banner; Insert is disabled.
- Open ChatGPT before content script loads (rapid reload) → message-handshake retry kicks in; injection still succeeds within 2 seconds.

**Automated tests:**
- `test/unit/injector.spec.js` — load `HTMLTestframe/ChatGPT.html` and the Copilot page via jsdom, run `getInputBox()`, assert it matches `#prompt-textarea` and `#userInput` respectively.
- `test/unit/canary.spec.js` — load each saved page, run `runCanary()`, assert `primary_match: true` and `any_input_match: true`; then `document.querySelector('#prompt-textarea').remove()` (or equivalent for Copilot), re-run, assert `primary_match` flips to false.
- `test/unit/theme-detector.spec.js` — load `HTMLTestframe/ChatGPT.html` (has `class="dark"`) → assert `detectTheme()` returns `'dark'`; load Copilot page (`data-theme="dark"`) → assert `'dark'`; toggle the attribute → assert `'light'`.
- **Selector-drift CI gate:** a CI job re-runs the canary against the committed `HTMLTestframe/` pages on every PR. If any selector that *was* matching stops matching, the build fails — protects against accidental regressions to the selectors map.
- Service worker routing exercised via Puppeteer or `chrome-extension-testing` harness — assert correct panel path applied per URL.

---

## 6. Phase 2 — Template Management

**Goal:** Full personal template management. The extension is genuinely useful as a standalone personal tool at the end of this phase. Auto-backups run silently from this point so Phase 3's Recovery Points have data to surface.

**Exit criteria:** User can create, edit, delete, search, and insert templates. Templates persist across browser restarts and sync across Chrome profiles. Every template write produces a snapshot in `auto_backups[]` (latest 3 retained). Each template carries a `schema_version` field.

### Deliverables

- Template CRUD in side panel UI
- `chrome.storage.sync` with `chrome.storage.local` overflow fallback
- `schema_version: 1` written on every template; `migrations.js` skeleton in place (no migrations needed yet)
- Template list with search bar and category filter
- Click-to-insert wired to Phase 1 injection pipeline
- Source badge on templates (ready for library prompts in Phase 5)
- `templates/defaults.json` — bundled starter templates loaded once on first install (idempotent — first-install marker in `chrome.storage.local`)
- Settings panel — theme override (Follow AI host / Always Dark / Always Light), default category, `inline_overlay_enabled` toggle (UI present even though feature ships in Phase 4 — defaults to `false` until Phase 4 closes)
- **Auto-backup snapshots** — rolling array of last 3 states, written by every CRUD op (create/edit/delete) to `chrome.storage.local.auto_backups`. Recovery Points UI is delivered in Phase 4; the storage and trigger live here.

### Side Panel Full Layout
```
┌─────────────────────────┐
│  AI Prompts         ⚙️  │
├─────────────────────────┤
│  🔍 Search templates    │
├─────────────────────────┤
│  [My Templates]         │
│  [Libraries]            │  ← tab inactive until Phase 5
│  [Settings]             │
├─────────────────────────┤
│  ── Developer ───       │
│  > Code Review Request  │
│  > Debug This Error     │
│                         │
│  ── Writing ──────      │
│  > Summarise Article    │
│  > Rewrite Formally     │
│                         │
│  [+ New Template]       │
└─────────────────────────┘
```

### CRUD Flow Summary
```
Create: [+ New Template] → title, body, category, tags → save to storage → auto_backups push
Edit:   click template → edit form pre-filled → save overwrites by id → auto_backups push
Delete: delete button → confirmation prompt → removed from storage → auto_backups push
Insert: click template title → insertText() fires → text in active AI input
Search: keyup filter on title, tags, and body text
```

### Phase 2 Test Plan

**Fixtures:**
- `test/fixtures/templates-seed.json` — 25 deterministic templates spanning multiple categories.
- Mock `chrome.storage` (Vitest harness with in-memory adapter) for unit tests.

**Manual verification:**
1. Fresh install → defaults appear; second reload → no duplicate defaults (first-install marker honoured).
2. Create, edit, delete a template → list updates immediately; reload extension → state persists.
3. Search by title, tag, body fragment → list filters live.
4. Open Chrome on a second profile signed into the same Google account → templates appear within sync window.
5. Bulk-import 1000 templates via devtools `chrome.storage.sync.set` → quota error → automatic fallback to `chrome.storage.local`; templates still appear.
6. Verify `chrome.storage.local.auto_backups` contains last 3 snapshots after 5 sequential edits — oldest evicted.
7. Insertion still works on ChatGPT, then on Copilot.

**Automated tests:**
- `test/unit/storage.spec.js` — quota-exceeded path: mock `chrome.storage.sync.set` to reject with `QUOTA_BYTES_PER_ITEM`, assert template lands in `local`.
- `test/unit/auto-backup.spec.js` — sequence of 5 writes leaves `auto_backups.length === 3`, FIFO eviction, snapshots are deterministic.
- `test/unit/migrations.spec.js` — feed a `schema_version: 0` legacy template through `runMigrations`, assert it emerges with `schema_version: 1` and required fields. (Even with no migration steps yet, the harness exists.)
- `test/unit/search.spec.js` — known fixtures + queries → expected ID set matches.

**Failure-mode verification:**
- Storage write throws mid-edit → UI shows "Save failed, please retry" and does **not** create a partial auto-backup.
- Two rapid edits race → auto-backup ordering is consistent (writes serialised through a single async queue).

---

## 7. Phase 3 — Backup & Restore

**Goal:** Protect user template data with explicit user-controlled export/import. Builds on top of Phase 2's auto-backup snapshots — this phase exposes them as Recovery Points and adds full file-based export/import. Ships before the inline overlay (Phase 4) so that user data is fully protected before any new UX surface is introduced.

**Exit criteria:** User can export a `.backup` file, import it on a fresh install, and choose a merge strategy. SHA-256 validation correctly rejects a tampered or corrupt file. Recovery Points UI lists the auto-backup snapshots produced since Phase 2 and restores any of them.

### Deliverables

- Export to `.backup` file with SHA-256 integrity hash and `schema_version` field on inner data
- Import with file type check, hash validation, schema validation, schema-version migration, and merge
- Three merge strategies presented on import confirmation
- Post-import summary report (added, renamed, skipped counts)
- Recovery Points UI in Settings → Backup & Restore (consumes `auto_backups` written since Phase 2)
- `.backup` extension enforced in file picker
- (Auto-backup writes are **not** delivered here — they exist already from Phase 2. This phase only consumes them.)

### Backup File
- Extension: `.backup` — not `.json`
- Filename: `ai-prompts-backup-YYYY-MM-DD.backup`
- SHA-256 computed over `data` block only using `sortedStringify`
- OS will not attempt to open `.backup` files with another application

### What Is and Is Not Backed Up

| Data | Included | Reason |
|---|---|---|
| User templates | ✅ Yes | Critical — irreplaceable |
| Settings | ✅ Yes | Important — user preferences |
| Library downloads | ❌ No | Large and always re-downloadable |
| Selector health | ❌ No | Ephemeral — recomputed on next page load |

### Import Validation Order
```
1. File extension must be .backup
2. File must parse as valid JSON
3. SHA-256 recomputed and compared  ← first check, before anything else
4. backup_version must exist
5. backup_version must not exceed current envelope version
6. data.schema_version present and ≤ current schema version (else "newer extension required")
7. Run forward migrations on data if schema_version < current
8. data.user_templates must be an array
9. Each template must have title and body fields
```

### Import Error Messages

| Failure | User Message |
|---|---|
| Wrong file type | "Please select a .backup file exported from this extension" |
| Cannot parse | "This file could not be read — it may be corrupt" |
| Missing hash | "This backup is missing its integrity check and cannot be imported" |
| Hash mismatch | "This backup has been modified or corrupted and cannot be imported" |
| Envelope too new | "This backup was made with a newer version of the extension — please update first" |
| Inner schema too new | "This backup uses a newer template format — please update the extension first" |
| Migration failed | "This backup could not be upgraded to the current format — please report this file" |
| Missing fields | "This backup is incomplete — [specific errors listed below]" |

### Merge Strategies

| Strategy | Behaviour | Default |
|---|---|---|
| Replace All | Wipe current data, import everything from backup | No |
| Merge — Keep Both | Add imported alongside existing, rename conflicts "(imported)" | Yes |
| Merge — Backup Wins | Imported version overwrites on matching title | No |

### Recovery Points (consumes Phase 2 auto-backups)

Reads `chrome.storage.local.auto_backups` and renders each as a restorable snapshot. Restoring one writes its templates back to `chrome.storage.sync` and pushes the **current** state to the front of `auto_backups` first, so a mistaken restore can itself be undone.

### Backup UI Layout
```
Settings → Backup & Restore

Last backup: Never

[Export Backup]

[Import Backup]

─── Recovery Points ────────────────
• 5 min ago — 25 templates
  (before deleting "Code Review")
  [Restore]

• Yesterday — 24 templates
  [Restore]
────────────────────────────────────
```

### Phase 3 Test Plan

**Fixtures:**
- `test/fixtures/backup-golden.backup` — known-valid backup, committed to repo. Used to verify forward compatibility (all future versions must still import it).
- `test/fixtures/backup-tampered.backup` — same data, hash field mutated by one character.
- `test/fixtures/backup-corrupt.backup` — truncated mid-JSON.
- `test/fixtures/backup-future.backup` — synthetic backup with `backup_version: 99`.

**Manual verification (golden path):**
1. Create 5 templates → Export Backup → file downloads with `.backup` extension and today's date.
2. Edit one template → Import the backup with "Merge — Keep Both" → original returns alongside edited version, suffix `(imported)` applied.
3. Import with "Replace All" → confirmation prompt → only the 5 backed-up templates remain.
4. Open Recovery Points → 3 entries visible from Phase 2's auto-backup → restore the oldest → templates revert; current state appears as the new top entry.

**Manual verification (failure modes):**
- Import `backup-tampered.backup` → "This backup has been modified or corrupted" → no data written.
- Import `backup-corrupt.backup` → "This file could not be read" → no data written.
- Import `backup-future.backup` → "This backup was made with a newer version" → no data written.
- Rename `something.txt` → `something.backup` → import → fails JSON parse → "could not be read".

**Automated tests:**
- `test/unit/backup-roundtrip.spec.js` — generate fixture → export → SHA matches recompute → import → output equals input.
- `test/unit/sortedStringify-determinism.spec.js` — property test: shuffle key order in `data` 100×, all stringified outputs identical, all hashes identical.
- `test/unit/backup-tamper.spec.js` — flip every bit position in the backup file in turn, assert validation rejects all of them.
- `test/unit/backup-golden.spec.js` — `backup-golden.backup` always imports successfully on every CI run. (Catches accidental envelope-format breaks.)
- `test/unit/backup-migration.spec.js` — synthetic `schema_version: 0` backup runs through migration chain on import → emerges as `schema_version: 1`.

**Failure-mode verification:**
- Quota-exceeded during Replace All → operation rolls back, original templates still intact (test via mocked `chrome.storage` rejecting on N-th `set`).
- Mid-import crash (simulated by throwing in the merge loop) → no half-applied state; user sees "Import failed" and existing data unchanged.

---

## 8. Phase 4 — Inline Insertion Surface

**Goal:** A second insertion path: a Grammarly-style icon that floats next to the AI's input box and opens a quick template picker. Faster than reaching for the side panel; familiar pattern to anyone who's used Grammarly, 1Password, or Bitwarden. Ships after Backup & Restore (Phase 3) so that user data is fully protected before this new UX surface lands.

**Exit criteria — ChatGPT (primary):**
- An icon appears within ~250ms of the input box becoming visible, anchored to its right edge.
- Clicking the icon opens a picker dropdown with search and the user's templates.
- Clicking a template inserts its body into the input and closes the picker.
- Esc, click-outside, or focus-loss closes the picker.
- Toggling `inline_overlay_enabled = false` in Settings hides the icon immediately on next page load and on the current tab within 1s.
- The icon remains correctly positioned when the page scrolls, the window resizes, or the input box height grows (multi-line).
- Configured keyboard shortcut opens the picker when focus is in the input box.

**Exit criteria — Copilot:**
- Same behaviour on Copilot, including correct anchoring when the input lives inside a Shadow DOM.

### Deliverables

- `content/overlay.js` — icon mount, picker UI, position tracking, theme application
- `content/overlay.css` — Shadow-DOM-scoped styles using the same CSS tokens as the side panel
- `content/overlay-icon.svg` — icon glyph
- `LIST_TEMPLATES` message handler in service worker / sidepanel — returns templates from `chrome.storage.sync` filtered by search query
- Keyboard shortcut binding via `chrome.commands` (manifest extension)
- Settings toggle wired to `settings.inline_overlay_enabled`
- Per-host position tuning (CSS variables for icon offset; defaults work, override allowed in `OVERLAY_HOST_TUNING`)

### UX Sketch

```
┌────────────────────────────────────────────────┐
│  ChatGPT page                                  │
│                                                │
│  ┌─ AI input ──────────────────────────────┐   │
│  │ Type a message…                  [📋▼]  │   │  ← inline icon
│  └──────────────────────────────────────────┘   │
│                                  │              │
│                          ┌───────▼────────────┐ │
│                          │ 🔍 Search          │ │
│                          ├────────────────────┤ │
│                          │ ── Developer ──    │ │
│                          │ > Code Review      │ │
│                          │ > Debug Error      │ │
│                          │ ── Writing ──      │ │
│                          │ > Summarise        │ │
│                          │                    │ │
│                          │ [Open side panel]  │ │
│                          └────────────────────┘ │
└────────────────────────────────────────────────┘
```

### Edge Cases

| Case | Behaviour |
|---|---|
| Input not yet rendered on page load | Icon hidden until `MutationObserver` reports input present |
| Input resizes (e.g. user types multi-line) | `ResizeObserver` re-positions icon |
| User scrolls page | Icon tracks input via `scroll` listener (passive) |
| Focus moves to a different input on the page (e.g. search) | Icon hides; reappears when AI input refocuses |
| Inline overlay disabled in Settings | `overlay.js` is loaded but takes no DOM action |
| Side panel and overlay both open simultaneously | Both work — they share the same `LIST_TEMPLATES` data source |

### Phase 4 Test Plan

**Fixtures:**
- Reuse `HTMLTestframe/ChatGPT.html` and `HTMLTestframe/Microsoft Copilot_ Your AI companion.html` from Phase 1 — they include the real input boxes overlay.js needs to anchor against.
- Note: jsdom does not render layout, so `getBoundingClientRect()` returns zeros. Positioning unit tests stub the input's bounding rect; visual positioning is validated manually in a real Chrome window using the same saved pages served via `npx serve HTMLTestframe`.

**Manual verification (golden path):**
1. Reload extension on ChatGPT — icon appears within 250ms next to input.
2. Click icon → picker opens with all templates.
3. Type into search → list filters live.
4. Click template → text appears in ChatGPT input; picker closes.
5. Press configured keyboard shortcut while typing in input → picker opens.
6. Press Esc → picker closes; focus returns to input.
7. Repeat all on Copilot.

**Manual verification (positioning stress):**
- Type 10 lines into the input → icon stays anchored to the right edge of the (now taller) input.
- Resize Chrome window → icon tracks correctly.
- Scroll the page (long conversation) → icon stays attached.
- Open Chrome devtools as a side panel (squeezing page width) → icon stays in viewport.

**Manual verification (settings):**
- In Settings, toggle `inline_overlay_enabled = false` → icon disappears within 1 second on the active tab.
- Toggle back on → icon returns on next focus event without page reload.

**Automated tests:**
- `test/unit/overlay-positioning.spec.js` — load `HTMLTestframe/ChatGPT.html` via jsdom, stub `#prompt-textarea`'s `getBoundingClientRect()` with a known rect, mount overlay, assert icon coordinates fall within the right edge ±2px. Repeat with `#userInput` from the Copilot fixture.
- `test/unit/picker-search.spec.js` — render picker with seeded templates, simulate typing, assert filtered list matches expected IDs.
- `test/unit/overlay-disabled.spec.js` — set `inline_overlay_enabled = false`, mount overlay against either saved page, assert no DOM nodes added under `__uap_overlay_root` shadow.
- `test/unit/overlay-isolation.spec.js` — mount overlay on saved page, run `document.querySelectorAll('#uap-icon').length` → must be 0 (icon is inside a closed Shadow root, not addressable from the host page).

**Failure-mode verification:**
- Host page CSS sets `* { z-index: 999999 !important; }` → overlay still visible (uses `2147483646` and Shadow DOM isolation).
- Host page scripts run `document.querySelectorAll('button').forEach(b => b.remove())` → overlay button **not** removed (it's inside a closed Shadow root, not in `document`).

---

## 9. Phase 5 — Library Harvest & Import

**Goal:** Nightly automated harvest of source repos, safety-filtered and normalised to a clean format. Users browse and download libraries on demand from the side panel. **Phase 5 ships before Phase 6** so the registry/dist plumbing is live by the time community submissions start landing — community submissions become one library source among several, consumed by the same flow.

**Exit criteria:** Harvest Action runs nightly and commits updated files. User opens Libraries tab, sees available libraries, downloads one, and sees its prompts in the insert list with source badges. `awesome-chatgpt-prompts` is the first source live; the registry format leaves room for `community-submissions` to be added in Phase 6 with no extension code change.

### Deliverables

- `scripts/harvest.js` — fetch, normalise, filter, write output per source
- `scripts/filters/nsfw.js` and `scripts/filters/injection.js` — first used here (also reused by Phase 6)
- `manual-blocklist.json` and `manual-allowlist.json` — maintained manually
- `harvest-prompts.yml` GitHub Action — nightly schedule and manual dispatch
- `registry.json` with `schema_version` — index of available libraries with metadata
- `dist/libraries/*.json` per library — top-level wrapper `{ schema_version, prompts: [...] }`
- `filter-report.json` — committed each run
- Change detection — ETag and Last-Modified header check per source (skip if unchanged)
- Libraries tab fully active in side panel
- Download, toggle, update flow in extension UI
- Update available badge (registry `last_updated` vs stored `downloaded_at`)
- Schema-version skip — extension refuses to load library JSON with `schema_version` newer than it supports
- Visual source badge on all imported prompts
- Library disabled = prompts hidden, not deleted
- "Remove downloaded data" explicit action per library

### Harvest Action
```yaml
# .github/workflows/harvest-prompts.yml
name: Harvest Prompts
on:
  schedule:
    - cron: '0 2 * * *'
  workflow_dispatch:
jobs:
  harvest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run harvest
        run: node scripts/harvest.js
      - name: Commit if changed
        run: |
          git config user.name "github-actions"
          git config user.email "actions@github.com"
          git add dist/ registry.json filter-report.json
          git diff --staged --quiet || git commit -m "chore: update prompt libraries"
          git push
```

### Source Repos (Phase 5 launch)

| Repo | Format | Notes |
|---|---|---|
| `f/awesome-chatgpt-prompts` | CSV | Primary source for launch |
| `PlexPt/awesome-chatgpt-prompts` | JSON | Secondary, deduplicated against `f/` |
| Community submissions (this repo) | JSON | Empty file at Phase 5 launch; populated by Phase 6 |

### Registry File
```json
{
  "schema_version": 1,
  "generated": "2026-05-02T02:00:00Z",
  "libraries": [
    {
      "id": "awesome-chatgpt-prompts",
      "name": "Awesome ChatGPT Prompts",
      "description": "Community prompts across all categories",
      "count": 153,
      "size_kb": 42,
      "last_updated": "2026-05-01",
      "schema_version": 1,
      "url": "dist/libraries/awesome-chatgpt-prompts.json"
    },
    {
      "id": "community-submissions",
      "name": "Community Submissions",
      "description": "User-submitted prompts reviewed by maintainer",
      "count": 0,
      "last_updated": "2026-05-01",
      "schema_version": 1,
      "url": "dist/libraries/community-submissions.json"
    }
  ]
}
```

### Libraries Tab UI
```
┌─────────────────────────────────────┐
│  Libraries                          │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ Awesome ChatGPT Prompts       │  │
│  │ 153 prompts · Developer       │  │
│  │ Updated 1 day ago             │  │
│  │                  [Download]   │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ Community Submissions    ✅   │  │
│  │ 28 prompts · Various          │  │
│  │ Downloaded 3 days ago         │  │
│  │ ● Update available            │  │
│  │                   [Update]    │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Download Button States

| State | Display |
|---|---|
| Not downloaded | Download button |
| Downloading | Spinner and "Downloading…" |
| Downloaded, current | Enabled toggle and downloaded date |
| Update available | Update button and "Updated X days ago" |
| Download failed | Retry and error message |
| Schema too new | Disabled with "Update extension to use this library" |

### Filter Report
```json
{
  "run": "2026-05-02T02:00:00Z",
  "passed": 142,
  "blocked": 11,
  "warnings": 4,
  "blocked_summary": [
    { "title": "Unrestricted AI", "source": "repo-x", "reason": "injection" }
  ],
  "warning_summary": [
    { "title": "System Prompt Builder", "source": "repo-x", "warnings": ["\\[.*\\]"] }
  ]
}
```

### Phase 5 Test Plan

**Fixtures:**
- `test/fixtures/harvest-input-csv.csv` — 20 known prompts, 3 of which match injection patterns, 1 NSFW.
- `test/fixtures/harvest-input-json.json` — 15 known prompts.
- `test/fixtures/harvest-expected-output.json` — what the harvest should produce after filtering and dedup.
- `test/fixtures/registry-future.json` — registry with `schema_version: 99`.

**Manual verification (golden path):**
1. Trigger `harvest-prompts.yml` via `workflow_dispatch` → check committed `dist/libraries/*.json`, `registry.json`, `filter-report.json` match expected counts.
2. Re-run with no upstream changes → "no changes" — no commit produced (ETag/Last-Modified honoured).
3. In extension on ChatGPT, open Libraries tab → see registry; download `awesome-chatgpt-prompts` → spinner → success → prompts appear in template list with source badge.
4. Edit local copy of registry to bump `last_updated` → reload Libraries tab → "Update available" badge appears.
5. Click Update → fresh JSON downloaded; templates reflect new content.
6. Toggle library off → its prompts disappear from main list but stay in storage; toggle on → return.
7. Click "Remove downloaded data" → entry returns to "not downloaded" state.
8. Repeat verification on Copilot.

**Manual verification (failure modes):**
- Set local `registry.json` to `schema_version: 99` → Libraries tab shows "Update extension" hint, download disabled.
- GitHub fetch returns 500 → Libraries tab shows "Failed to load registry — retry" without crashing.
- Library JSON download succeeds but parse fails → error toast; previously downloaded data untouched.

**Automated tests:**
- `test/unit/harvest-determinism.spec.js` — run `harvest.js` against fixture inputs twice → byte-identical output. Catches non-determinism (`Date.now`, key iteration order).
- `test/unit/harvest-filters.spec.js` — run filters against `prompts-should-pass.json` and `prompts-should-block.json` fixtures; assert pass/block counts.
- `test/unit/harvest-etag.spec.js` — mock `fetch` returning `304 Not Modified` → no write to `dist/`.
- `test/unit/registry-version-skip.spec.js` — registry with newer `schema_version` → download path is gated, not crashed.
- `test/unit/library-load-roundtrip.spec.js` — write fixture library JSON → load via extension code → all prompts present in `library_prompts` keyed correctly.
- GitHub Actions: `act` (or equivalent) used in CI to dry-run `harvest-prompts.yml` against PR branches before merge.

**Failure-mode verification:**
- Manually delete `dist/libraries/awesome-chatgpt-prompts.json` and re-run harvest → file regenerated identically.
- Add a fake source repo URL that 404s → harvest logs the failure, other sources still write, exit code 0 (don't fail the whole nightly run on one bad source).

---

## 10. Phase 6 — Community Submission Pipeline

**Goal:** A moderated GitHub workflow extending Phase 5's library system with user-submitted prompts. This phase is entirely GitHub-side infrastructure — no extension UI changes. Users get the new prompts automatically on next library update because Phase 5 already plumbed `community-submissions.json` into the registry.

**Exit criteria:** A user can open an Issue using the form, receive automated screening, and the maintainer can approve or reject via a comment. Approved prompts land in `community-submissions.json`. The next nightly harvest picks them up; users see them via the Libraries tab they already know from Phase 5.

### Deliverables

- Reuses Phase 5's safety filtering scripts (`scripts/filters/nsfw.js`, `scripts/filters/injection.js`)
- GitHub Issue form template (`prompt-submission.yml`)
- `screen-submission.yml` GitHub Action
- `process-approval.yml` GitHub Action with `/approve`, `/reject`, `/remove` commands
- `scripts/screen-submission.js`
- `scripts/add-to-library.js` — parse, deduplicate, append, include contributor credit, stamp `schema_version`
- `scripts/remove-from-library.js`
- Spam protection — auto-close if user has more than 3 open submissions
- Warning SLA — weekly Action reminds on issues stale in warning tier for 7+ days
- Label structure configured in repo settings
- `CONTRIBUTING.md`

### Submission Flow
```
User creates Issue → structured form
        ↓
Spam check: >3 open from this user → auto-close
        ↓
NSFW filter → blocked → label + comment + close
        ↓
Injection filter → blocked → label + comment + close
        ↓
Warning tier → label screening-warning + awaiting-approval + comment
        ↓
Passed → label screening-passed + awaiting-approval + comment
        ↓
Maintainer reviews issue
        ↓
/approve → add-to-library.js → deduplicate → append → commit → close ✅
/reject reason → close with reason ❌
/remove id → remove-from-library.js → commit
        ↓
Next harvest run picks up the change → registry.json count updates →
extension users see new prompt on next library refresh
```

### Label Structure

| Label | Colour | Meaning |
|---|---|---|
| `prompt-submission` | Blue | All new submissions |
| `pending-review` | Yellow | Awaiting screening |
| `screening-passed` | Green | Auto-screen clear |
| `screening-warning` | Orange | Flagged, needs manual review |
| `screening-blocked` | Red | Auto-rejected |
| `awaiting-approval` | Purple | Maintainer action needed |
| `approved` | Dark green | Merged to library |
| `rejected` | Dark red | Closed, not added |

### Screening Action
```yaml
# .github/workflows/screen-submission.yml
name: Screen Prompt Submission
on:
  issues:
    types: [opened, edited]
jobs:
  screen:
    if: contains(github.event.issue.labels.*.name, 'prompt-submission')
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Run screening
        id: screen
        env:
          ISSUE_BODY: ${{ github.event.issue.body }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/screen-submission.js
      - name: Apply result label
        uses: actions/github-script@v7
        with:
          script: |
            const result = '${{ steps.screen.outputs.result }}';
            const labels = {
              passed:  ['screening-passed',  'awaiting-approval'],
              warning: ['screening-warning', 'awaiting-approval'],
              blocked: ['screening-blocked']
            };
            await github.rest.issues.addLabels({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              labels: labels[result]
            });
```

### Approval Action
```yaml
# .github/workflows/process-approval.yml
name: Process Maintainer Approval
on:
  issue_comment:
    types: [created]
jobs:
  process:
    if: |
      github.event.issue.pull_request == null &&
      github.event.comment.user.login == 'YOUR_GITHUB_USERNAME' &&
      (startsWith(github.event.comment.body, '/approve') ||
       startsWith(github.event.comment.body, '/reject') ||
       startsWith(github.event.comment.body, '/remove'))
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: write
    steps:
      - uses: actions/checkout@v4
      - name: Handle approve
        if: startsWith(github.event.comment.body, '/approve')
        env:
          ISSUE_NUMBER: ${{ github.event.issue.number }}
          ISSUE_BODY: ${{ github.event.issue.body }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          node scripts/add-to-library.js
          git config user.name "github-actions"
          git config user.email "actions@github.com"
          git add dist/libraries/community-submissions.json
          git commit -m "feat: add approved prompt from issue #$ISSUE_NUMBER"
          git push
          gh issue close $ISSUE_NUMBER --comment "✅ Approved and added to the library!"
          gh issue edit $ISSUE_NUMBER --add-label "approved"
      - name: Handle reject
        if: startsWith(github.event.comment.body, '/reject')
        env:
          ISSUE_NUMBER: ${{ github.event.issue.number }}
          COMMENT_BODY: ${{ github.event.comment.body }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          REASON="${COMMENT_BODY#/reject}"
          gh issue close $ISSUE_NUMBER --comment "❌ Rejected. Reason: $REASON"
          gh issue edit $ISSUE_NUMBER --add-label "rejected"
      - name: Handle remove
        if: startsWith(github.event.comment.body, '/remove')
        env:
          COMMENT_BODY: ${{ github.event.comment.body }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          PROMPT_ID="${COMMENT_BODY#/remove }"
          node scripts/remove-from-library.js $PROMPT_ID
          git config user.name "github-actions"
          git config user.email "actions@github.com"
          git add dist/libraries/community-submissions.json
          git commit -m "chore: remove prompt $PROMPT_ID"
          git push
```

### Phase 6 Test Plan

**Fixtures:**
- `test/fixtures/issue-clean.md`, `issue-nsfw.md`, `issue-injection.md`, `issue-warning.md`, `issue-malformed.md` — synthetic Issue bodies covering each screening branch.
- `test/fixtures/community-submissions-seed.json` — empty seed produced by Phase 5; Phase 6 appends to it.

**Manual verification (golden path):**
1. Open Issue using the form with a clean prompt → screening Action runs → labels applied (`screening-passed`, `awaiting-approval`) → comment posted with the report.
2. Maintainer comments `/approve` → approval Action runs → `community-submissions.json` updated, issue closed and labelled `approved`.
3. Wait for next nightly harvest (or manual dispatch) → `registry.json` count for `community-submissions` increments by 1.
4. In extension, refresh Libraries tab → "Update available" on Community Submissions → click → new prompt visible with contributor credit.
5. Maintainer comments `/remove <id>` on a previously approved issue → prompt disappears from library after next refresh.

**Manual verification (failure modes):**
- Submit `issue-nsfw.md` → screening labels `screening-blocked`, comment explains, issue closes — no maintainer action required.
- Submit `issue-injection.md` → same outcome.
- Submit 4 issues from the same account in succession → 4th auto-closes with spam-protection notice.
- Maintainer types `/approve` from a non-maintainer account → workflow's `if:` filter rejects, no commit happens.

**Automated tests:**
- `test/unit/screen-submission.spec.js` — run `screen-submission.js` against each issue fixture; assert correct screening result and report content.
- `test/unit/add-to-library.spec.js` — run against seed `community-submissions.json` + a clean issue → asserts new entry appended, schema_version stamped, contributor field populated, no duplicate id.
- `test/unit/remove-from-library.spec.js` — run against fixture with 3 prompts → asserts target id removed, others intact, JSON valid.
- GitHub Actions: `act` dry-runs of both workflows against fixture issues in CI before merging changes to the workflows themselves.

**Failure-mode verification:**
- Two `/approve` comments on the same issue → second is a no-op (idempotency check on issue number → existing entry).
- `/remove` for an id that doesn't exist → script exits cleanly with "id not found" comment, no commit.
- Filter regex change merged that lets injection through → unit test against `prompts-should-block.json` fails CI before merge.

---

## 11. Action Flows

### Flow 1 — User Inserts a Template via Side Panel
```
User opens side panel on a supported AI site
→ browses or searches template list
→ clicks template title
→ sidepanel.js sends INSERT message via chrome.runtime
→ service-worker.js forwards to content script
→ injector.js calls insertText() on specific target input
→ text appears in AI input box
→ user reviews and submits to AI
```

### Flow 2 — User Inserts a Template via Inline Icon
```
User has focus in AI input box
→ overlay icon visible at right edge of input
→ user clicks icon (or presses configured keyboard shortcut)
→ overlay.js opens picker dropdown anchored under icon
→ user types in search; list filters live
→ user clicks template
→ overlay.js calls injector.insertText() directly (same content-script context)
→ text appears in AI input box; picker closes
```

### Flow 3 — User Creates a Template
```
User clicks [+ New Template]
→ fills title, body, category, tags
→ saves to chrome.storage.sync (falls back to local if quota exceeded)
→ schema_version: 1 stamped on the new template
→ auto-backup snapshot pushed to chrome.storage.local.auto_backups (keeps last 3)
→ template appears in list immediately
→ included in next manual backup export
```

### Flow 4 — User Exports a Backup
```
User opens Settings → Backup & Restore → Export Backup
→ optional description entered
→ user_templates and settings read from chrome.storage
→ sortedStringify(data) produces deterministic string
→ SHA-256 hash generated via Web Crypto API
→ backup object assembled with hash, backup_version, schema_version, metadata, data
→ file downloaded as ai-prompts-backup-YYYY-MM-DD.backup
```

### Flow 5 — User Imports a Backup
```
User clicks Import Backup
→ file picker opens with .backup filter
→ file read as text
→ validation pipeline:
    extension check → JSON parse → SHA recompute and compare → envelope-version check
    → schema_version check → migrations applied if older → schema/field check
→ any failure: specific error shown, import aborted, nothing written
→ preview shown: "24 templates, 3 settings changes"
→ user selects merge strategy (default: Merge Keep Both)
→ user confirms
→ auto-backup snapshot saved before applying import (so restore can undo it)
→ duplicate detection runs per template
→ merge applied
→ summary shown: "22 added, 2 renamed to avoid conflicts"
```

### Flow 6 — User Downloads a Library
```
User opens Libraries tab
→ registry.json fetched from GitHub
→ schema_version checked; libraries with newer schema_version are gated with a hint
→ available libraries displayed with metadata
→ user toggles library and clicks Download
→ library JSON fetched from dist/libraries/{id}.json
→ schema_version on library file checked
→ prompts stored in chrome.storage.local library_prompts[id]
→ library_meta[id] updated with downloaded_at and version
→ prompts appear in template list with source badge
→ update badge shown if registry last_updated is newer than downloaded_at
```

### Flow 7 — Nightly Library Harvest
```
GitHub Action triggers at 2am UTC (or manual workflow_dispatch)
→ for each source repo:
    check ETag and Last-Modified header
    → unchanged: skip this source
    → changed: fetch full content
    parse format (CSV or JSON depending on source)
    normalise to standard schema (stamp schema_version)
    run NSFW filter → excluded and logged if matched
    run injection filter → excluded and logged if matched
                         → flagged in report if warning tier
→ merge manual-allowlist (force include reviewed prompts)
→ apply manual-blocklist (force exclude permanently blocked prompts)
→ deduplicate across all sources by title fingerprint
→ write dist/libraries/{id}.json per source
→ write registry.json with counts and last_updated
→ write filter-report.json
→ git diff check: commit and push only if any files changed
```

### Flow 8 — Community Prompt Submission
```
User opens GitHub repo
→ creates Issue using prompt-submission form
→ fills title, body, category, optional source URL
→ checks submission agreement and submits

screen-submission.yml fires automatically:
→ spam check: more than 3 open submissions from this user → auto-close
→ NSFW filter match → label screening-blocked + comment + close
→ injection filter match → label screening-blocked + comment + close
→ warning patterns found → label screening-warning + awaiting-approval + comment
→ all clear → label screening-passed + awaiting-approval + comment

Maintainer reviews awaiting-approval queue:
→ /approve → add-to-library.js: duplicate check → append with contributor + schema_version → commit → close ✅
→ /reject reason → close with reason ❌
→ /remove id → remove-from-library.js → commit

Next nightly harvest picks up the change → users see new prompt after refreshing the Community Submissions library.
```

### Flow 9 — Selector Health Canary
```
Content script loads on supported AI tab
→ selector-canary.js runs every selector for the host
→ chrome.runtime.sendMessage SELECTOR_HEALTH with results
→ service-worker.js stores results in chrome.storage.local.selector_health[host]
→ side panel listens via storage.onChanged
→ if any_input_match=false → red banner; Insert disabled
→ if primary_match=false but a fallback matched → yellow toast
→ MutationObserver re-runs canary on DOM changes; banner clears when match restored
```

---

## 12. Known Gaps & Open Decisions

| Item | Status |
|---|---|
| Scheduled backup reminder — nudge if no export in X days | Undecided |
| Cloud backup to GitHub or Google Drive | Potential future consideration |
| `CONTRIBUTING.md` full content | To be written before Phase 6 |
| Selector-health alerting **beyond** in-extension banner (e.g. opt-in telemetry to a maintainer-owned endpoint) | Strategy needed; in-extension canary covers single-user surfacing |
| Migration test discipline — every PR that bumps `schema_version` must include the new `migrate_vN_to_vN+1` function and tests | To be enforced via CI check |
| First-run experience — defaults loaded once, marker stored | Design decided (Phase 2); copy still TBD |
| Per-host overlay tuning — exact pixel offsets for Copilot's input shape | To be tuned during Phase 3 Copilot pass |

---

## 13. Deferred Features

Considered and deliberately set aside. Not in current scope.

| Feature | Reason Deferred |
|---|---|
| Per-template SHA hashing | Single file hash is sufficient for personal use. Revisit if corruption becomes a pattern. |
| Injected pseudo sidebar with slide and collapse | Fragile against ChatGPT DOM updates. Chrome side panel is the correct approach. The Phase 4 inline overlay is a focused alternative — single icon, not a full sidebar. |
| Cloud backup to GitHub or Google Drive | Scope creep. Local `.backup` export covers the need adequately. |
| Non-English injection detection | Regex has limits here. Non-ASCII prompts are flagged in filter-report.json for manual review. |
| Telemetry beacon for selector failures | Privacy cost not worth it for a developer-mode extension. In-extension canary banner is the alternative. |

---

## 14. Developer Mode Notes

- Load via `chrome://extensions` → **Load Unpacked** → select extension root folder
- No store signing or submission required
- Pin the extension icon for quick side panel access
- PWA web app mode: content script injects correctly — ChatGPT and Copilot PWAs use the same target URLs
- After any code change: click the refresh icon on the extension card in `chrome://extensions`
- Side panel has its own DevTools — right-click inside the panel and choose Inspect
- Inline overlay shadow root has its own inspectable DevTools — right-click the icon and choose Inspect
- MV3 service workers sleep after 30 seconds of inactivity — never store state in top-level variables, always use `chrome.storage`
- GitHub Actions run free on public repos — verify free tier limits if repo is private

---

*Last updated: 2026-05-02*
*Status: Planning complete — ready to begin Phase 1*
