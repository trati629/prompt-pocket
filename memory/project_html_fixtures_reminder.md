---
name: HTML fixtures needed for new AI models
description: Reminder to save HTMLTestframe fixtures for M365 Copilot, Gemini, and Claude after later project phases complete
type: project
---

After the project reaches a stable later phase, save real saved-page HTML fixtures for the three AI models added beyond ChatGPT and Copilot:

- M365 Copilot — `https://m365.cloud.microsoft/chat`
- Gemini — `https://gemini.google.com`
- Claude — `https://claude.ai`

**Why:** The selectors in `content/injector.js` and `content/selector-canary.js` for these three are best-guess estimates — they work in practice but are not validated against real DOM snapshots. Adding fixtures to `HTMLTestframe/` lets the selector canary tests and `npm test` catch DOM drift automatically instead of relying on user bug reports.

**How to apply:** When the user says later phases are complete, remind them to:
1. Open each AI in Chrome
2. Use File → Save Page As → Webpage, Complete
3. Drop the `.html` + `_files/` folder into `HTMLTestframe/`
4. Update `test/selectors.test.mjs` with the new fixtures
