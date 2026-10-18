'use strict';
const { defineConfig } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const baseURL = process.env.CONSENT_BROWSER_URL ?? 'http://127.0.0.1:8715';
module.exports = defineConfig({
    testDir: __dirname,
    testMatch: '*.spec.cjs',
    timeout: 30000,
    workers: 1,
    reporter: 'line',
    outputDir: path.join(os.tmpdir(), 'consent-livewire-browser-results', new URL(baseURL).port || 'default'),
    use: { baseURL, trace: 'retain-on-failure' },
    projects: ['chromium', 'firefox', 'webkit'].map(name => ({ name, use: { browserName: name } })),
});
