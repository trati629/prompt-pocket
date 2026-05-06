# 🚀 Prompt Pocket

**Prompt Pocket** is a universal Chrome/Edge extension that allows you to manage, search, and insert your favorite prompt templates directly into top AI platforms like ChatGPT, Microsoft Copilot, Google Gemini, and Claude.

Say goodbye to copy-pasting from chaotic spreadsheets or notes apps. Prompt Pocket lives right where you need it—either as a robust browser side panel or a sleek Floating Action Button (FAB) injected directly into the AI's chat window.

## ✨ Features

- **Universal AI Support:** Works seamlessly across ChatGPT, Microsoft Copilot, M365 Copilot, Google Gemini, and Claude.
- **In-Page Overlay UI:** A non-intrusive floating action button (FAB) that expands into a beautiful search popover directly inside the AI chat window.
- **Side Panel Manager:** A full-featured Chrome Side Panel for managing your template library, organizing by categories, and pinning favorites.
- **Dynamic Variables:** Support for `{{variables}}` inside your prompts. The extension automatically detects them and provides input fields to fill them out before inserting.
- **Privacy First:** 100% local. Your templates are securely stored in Chrome's local and sync storage. No external databases, no telemetry, no accounts required.
- **Import & Export:** Easily back up your templates to a JSON file or share them with your team. Includes built-in prototype pollution and XSS protections.
- **Dark Mode Sync:** Automatically detects the AI platform's theme (Dark/Light) and adjusts the extension UI to match seamlessly.

---

## 🛠️ Installation Guide

Currently, Prompt Pocket is in Beta (v0.1.0) and can be installed manually using **Developer Mode** on both Google Chrome and Microsoft Edge.

### Installing on Google Chrome

1. Download or clone this repository to your local machine.
2. Open Google Chrome and navigate to **`chrome://extensions/`** in your address bar.
3. In the top right corner, toggle the **Developer mode** switch to **ON**.
4. Click the **Load unpacked** button that appears in the top left.
5. Browse to the downloaded repository folder, select the `ai-prompt-extension` directory, and click **Select Folder**.
6. **Prompt Pocket** will now appear in your extensions list! Be sure to "Pin" it to your toolbar for easy access.

### Installing on Microsoft Edge

1. Download or clone this repository to your local machine.
2. Open Microsoft Edge and navigate to **`edge://extensions/`** in your address bar.
3. In the bottom left corner (or top right, depending on your version), toggle the **Developer mode** switch to **ON**.
4. Click the **Load unpacked** button near the top.
5. Browse to the downloaded repository folder, select the `ai-prompt-extension` directory, and click **Select Folder**.
6. **Prompt Pocket** will now be active. Click the Extensions puzzle piece icon to open the side panel or pin it.

---

## 💻 Usage

### The Overlay UI (Fastest)

1. Navigate to any supported AI platform (e.g., `chatgpt.com`).
2. Click inside the chat input box.
3. You will see the Prompt Pocket **Floating Action Button (FAB)** spring to life in the bottom right corner of the chat box.
4. Click the FAB (or press `Cmd/Ctrl + Shift + P`) to open the overlay.
5. Search for a template, fill in any variables, and hit **Insert**.

### The Side Panel (Management)

1. Click the Prompt Pocket extension icon in your browser toolbar to open the Side Panel.
2. Click **New Template** to write and save a prompt.
3. Use `{{double_braces}}` to define dynamic variables in your prompt body.
4. Navigate to the **Settings** tab to Export backups or Import prompt packs.

## 🔒 Security

We take security seriously. Prompt Pocket includes:

- Strict isolation via Shadow DOM to prevent host-page CSS/JS interference.
- Hardened bulk JSON imports that strip malicious unicode and prototype pollution attempts.
- Mandatory SHA-256 signature verification for all exported backup files.
- Strict `sender.id` cross-extension message verification.
