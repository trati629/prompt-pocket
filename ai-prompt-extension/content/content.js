/**
 * Universal AI Prompt Templates
 * content/content.js
 * 
 * Entry point for page injection.
 * Coordinates the loading of the injector, theme detector, and canary modules.
 * In Manifest V3, we load all scripts via the manifest's content_scripts array.
 * This file serves as a central orchestrator or a place for global content script setup if needed.
 */

console.log('[Universal AI Prompt Templates] Content script initialized on', window.location.hostname);

// The actual logic is broken out into theme-detector.js, injector.js, and selector-canary.js
// which are all injected into the page via the manifest.
// If any cross-module coordination is required in the future, it can be added here.
