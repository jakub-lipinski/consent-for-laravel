'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { JSDOM, CookieJar, VirtualConsole } = require('jsdom');
const axe = require('axe-core');
const fixtureCache = new Map();
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(input = {}) {
    const key = JSON.stringify(input);
    if (!fixtureCache.has(key)) fixtureCache.set(key, JSON.parse(execFileSync(process.env.CONSENT_TEST_PHP ?? 'php', ['tests/JavaScript/ui-fixture.php'], { input: key, encoding: 'utf8' })));
    return fixtureCache.get(key);
}
function decision(config, choices = {}) {
    const decidedAt = Math.floor(Date.now() / 1000);
    return { schemaVersion: 1, policyVersion: config.policyVersion, servicesVersion: config.servicesVersion,
        choices: { necessary: true, analytics: false, marketing: false, performance: false, other: false, ...choices },
        decidedAt, expiresAt: decidedAt + 180 * 86400 };
}
async function page(t, options = {}) {
    const content = fixture(options.input);
    const jar = new CookieJar();
    if (options.decided) jar.setCookieSync(`consent_preferences=${encodeURIComponent(JSON.stringify(decision(content.config, options.choices)))}; Path=/`, 'https://example.test/');
    const errors = [], reloads = [];
    const console = new VirtualConsole();
    const dom = new JSDOM(`<!doctype html><html lang="en"><head><title>Consent UI tests</title>${options.noCore ? '' : content.head}</head><body>
        <main><h1>Example website</h1><button id="outside">Outside</button><button id="custom" data-consent-open>Cookie preferences</button></main>${content.banner}</body></html>`, {
        url: 'https://example.test/', runScripts: options.noJavaScript ? 'outside-only' : 'dangerously', cookieJar: jar, virtualConsole: console,
        beforeParse(window) {
            window.TextEncoder = TextEncoder;
            // jsdom has no dialog top layer. Verify native modality in a disposable host application.
            if (!options.noDialog) {
                window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
                window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
            }
            window.document.addEventListener('consent:error', event => errors.push(plain(event.detail)));
            window.document.addEventListener('consent:reload-required', event => reloads.push(plain(event.detail)));
            options.before?.(window);
        },
    });
    t.after(async () => { await dom.window.Consent?.whenIdle(); dom.window.close(); });
    if (dom.window.document.readyState === 'loading') await new Promise(resolve => dom.window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (dom.window.Consent) await dom.window.Consent.whenIdle();
    await tick();
    const doc = dom.window.document;
    return { ...content, dom, window: dom.window, api: dom.window.Consent, jar, errors, reloads, doc,
        banner: doc.querySelector('[data-consent-banner]'), dialog: doc.querySelector('dialog'), launcher: doc.querySelector('[data-consent-launcher]'),
        root: doc.querySelector('[data-consent-ui]'), field: category => doc.querySelector(`#consent-category-${category}`),
        button: (action, modal = false) => doc.querySelector(`${modal ? 'dialog' : '[data-consent-banner]'} [data-consent-action="${action}"]`),
    };
}
async function idle(p) { await p.api.whenIdle(); await tick(); }

test('pending banner appears without moving focus or writing a decision', async t => {
    const p = await page(t);
    assert.equal(p.banner.hidden, false);
    assert.equal(p.launcher.hidden, true);
    assert.equal(p.doc.activeElement.tagName, 'BODY');
    assert.equal(p.window.document.cookie, '');
    assert.equal(p.field('necessary').checked, true);
    assert.equal(p.field('necessary').disabled, true);
    assert.equal(p.field('analytics').checked, false);
    assert.equal(p.field('other'), null);
    assert.equal(p.root.querySelector('[data-consent-fallback]').hidden, true);
});

for (const action of ['accept', 'reject']) {
    test(`${action} saves through the runtime, shows the launcher, and restores keyboard focus`, async t => {
        const p = await page(t);
        const button = p.button(action);
        button.focus(); button.click();
        await idle(p);
        assert.equal(p.api.state().choices.analytics, action === 'accept');
        assert.equal(p.api.state().choices.marketing, action === 'accept');
        assert.ok(p.api.state().decidedAt > 0);
        assert.equal(p.banner.hidden, true);
        assert.equal(p.launcher.hidden, false);
        assert.equal(p.doc.activeElement, p.launcher);
        assert.match(p.root.querySelector('[role="status"]').textContent, /saved/);
    });
}

test('saved acceptance and refusal restore directly to the reopening control', async t => {
    for (const choices of [{ analytics: true }, { analytics: false }]) {
        const p = await page(t, { decided: true, choices, before(window) {
            // A real body covers the page even when no interactive element has focus.
            window.Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 1200, width: 1200, height: 1200 });
        } });
        assert.equal(p.banner.hidden, true);
        assert.equal(p.launcher.hidden, false);
        p.launcher.focus(); p.launcher.click();
        assert.equal(p.dialog.open, true);
        assert.equal(p.field('analytics').checked, choices.analytics);
    }
});

test('modal starts at its heading, closes on Escape without saving, and restores its opener', async t => {
    const p = await page(t);
    const opener = p.button('open');
    opener.focus(); opener.click();
    assert.equal(p.doc.activeElement.id, 'consent-preferences-title');
    assert.equal(p.banner.hidden, true);
    p.field('analytics').checked = true;
    p.dialog.dispatchEvent(new p.window.Event('cancel', { cancelable: true }));
    assert.equal(p.dialog.open, false);
    assert.equal(p.banner.hidden, false);
    assert.equal(p.doc.activeElement, opener);
    assert.equal(p.api.state().decidedAt, null);
    opener.click();
    assert.equal(p.field('analytics').checked, false);
});

test('a deferred native close event does not steal focus from the next host-page control', async t => {
    const p = await page(t);
    p.button('open').click();
    p.button('close', true).click();
    const outside = p.doc.querySelector('#outside');
    outside.focus();
    p.dialog.dispatchEvent(new p.window.Event('close'));
    assert.equal(p.doc.activeElement, outside);
});

test('checkbox drafts do not grant permission until the form is explicitly submitted', async t => {
    const p = await page(t);
    p.button('open').click();
    p.field('analytics').click();
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.window.document.cookie, '');
    p.button('save', true).click();
    await idle(p);
    assert.equal(p.api.allowed('analytics'), true);
    assert.equal(p.api.allowed('marketing'), false);
    assert.equal(p.dialog.open, false);
    assert.equal(p.banner.hidden, true);
});

test('Tab and Shift+Tab wrap inside the preferences dialog', async t => {
    const p = await page(t);
    p.api.openPreferences();
    const first = p.button('close', true), last = p.button('save', true);
    last.focus();
    last.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert.equal(p.doc.activeElement, first);
    first.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(p.doc.activeElement, last);
    p.dialog.querySelector('h2').focus();
    p.dialog.querySelector('h2').dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(p.doc.activeElement, last);
});

test('banner dismissal and Escape keep optional consent pending', async t => {
    const p = await page(t);
    p.button('dismiss').focus(); p.button('dismiss').click();
    assert.equal(p.banner.hidden, true);
    assert.equal(p.launcher.hidden, false);
    assert.equal(p.doc.activeElement, p.launcher);
    assert.equal(p.window.document.cookie, '');
    p.api.openPreferences();
    assert.equal(p.dialog.open, true);
    p.button('close', true).click();
    assert.equal(p.banner.hidden, true);
    assert.equal(p.launcher.hidden, false);
    const next = await page(t);
    next.doc.dispatchEvent(new next.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(next.banner.hidden, true);
    assert.equal(next.api.state().decidedAt, null);
});

test('custom openers and the public method open preferences with a predictable return value', async t => {
    const p = await page(t);
    const custom = p.doc.querySelector('#custom');
    custom.focus(); custom.click();
    assert.equal(p.dialog.open, true);
    p.button('close', true).click();
    assert.equal(p.doc.activeElement, custom);
    assert.equal(p.api.openPreferences(), true);
});

test('no optional services means no initial banner, with necessary information still available', async t => {
    const p = await page(t, { input: { services: {} } });
    assert.equal(p.banner.hidden, true);
    assert.equal(p.launcher.hidden, false);
    p.launcher.click();
    assert.equal(p.dialog.querySelectorAll('input').length, 1);
    assert.equal(p.window.document.cookie, '');
});

test('storage failures keep a retryable interface and never present a saved success', async t => {
    const p = await page(t, { before(window) { Object.defineProperty(window.document, 'cookie', { get: () => '', set: () => {} }); } });
    p.button('accept').click();
    await idle(p);
    assert.equal(p.banner.hidden, false);
    assert.equal(p.launcher.hidden, true);
    assert.equal(p.banner.querySelector('[role="alert"]').hidden, false);
    assert.match(p.banner.querySelector('[role="alert"]').textContent, /could not be saved/);
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.root.hasAttribute('aria-busy'), false);
    assert.equal(p.button('accept').hasAttribute('aria-disabled'), false);
});

test('rapid double activation writes a single decision', async t => {
    let writes = 0;
    const p = await page(t, { before(window) {
        const descriptor = Object.getOwnPropertyDescriptor(window.Document.prototype, 'cookie');
        Object.defineProperty(window.document, 'cookie', { get: () => descriptor.get.call(window.document), set(value) { writes++; descriptor.set.call(window.document, value); } });
    } });
    p.button('accept').click(); p.button('accept').click();
    await idle(p);
    assert.equal(writes, 1);
});

test('external decisions and expiry refresh both visibility and open category controls', async t => {
    const p = await page(t);
    p.api.openPreferences();
    p.field('analytics').checked = true;
    const state = decision(p.config, { marketing: true });
    p.window.document.cookie = `consent_preferences=${encodeURIComponent(JSON.stringify(state))}; Path=/`;
    await p.api.refresh();
    assert.equal(p.field('analytics').checked, false);
    assert.equal(p.field('marketing').checked, true);
    assert.match(p.root.querySelector('[role="status"]').textContent, /changed/);
    p.button('close', true).click();
    p.window.Date.now = () => state.expiresAt * 1000;
    await p.api.refresh();
    assert.equal(p.banner.hidden, false);
    assert.equal(p.field('marketing').checked, false);
});

test('the banner collapses if it would hide keyboard focus on the host page', async t => {
    const p = await page(t);
    const box = { left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100 };
    p.banner.getBoundingClientRect = () => box;
    p.launcher.getBoundingClientRect = () => box;
    p.doc.querySelector('#outside').getBoundingClientRect = () => box;
    p.doc.querySelector('#outside').focus();
    assert.equal(p.banner.hidden, true);
    assert.equal(p.launcher.hidden, true);
    assert.equal(p.doc.activeElement.id, 'outside');
    p.doc.querySelector('#custom').focus();
    assert.equal(p.launcher.hidden, false);
    assert.equal(p.api.state().decidedAt, null);
});

test('focus on a page container overlapping the banner preserves the pending interface', async t => {
    const p = await page(t);
    const main = p.doc.querySelector('main');
    main.tabIndex = -1;
    main.getBoundingClientRect = () => ({ left: 0, right: 1200, top: 0, bottom: 8000, width: 1200, height: 8000 });
    const box = { left: 800, right: 1180, top: 500, bottom: 780, width: 380, height: 280 };
    p.banner.getBoundingClientRect = () => box;
    p.launcher.getBoundingClientRect = () => ({ left: 1130, right: 1180, top: 730, bottom: 780, width: 50, height: 50 });
    main.focus();
    assert.equal(p.banner.hidden, false);
    assert.equal(p.api.state().decidedAt, null);
    await p.api.rejectOptional();
    assert.equal(p.launcher.hidden, false);
    assert.equal(p.doc.activeElement, main);
});

test('partially covered host focus does not dismiss the pending banner', async t => {
    const p = await page(t);
    p.banner.getBoundingClientRect = () => ({ left: 50, right: 150, top: 0, bottom: 100, width: 100, height: 100 });
    const outside = p.doc.querySelector('#outside');
    outside.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100 });
    outside.focus();
    assert.equal(p.banner.hidden, false);
    assert.equal(p.doc.activeElement, outside);
});

for (const setting of ['noJavaScript', 'noCore', 'noDialog']) {
    test(`${setting} leaves a readable fallback with no unusable controls`, async t => {
        const p = await page(t, { [setting]: true });
        assert.equal(p.banner.hidden, true);
        assert.equal(p.launcher.hidden, true);
        assert.equal(p.root.querySelector('[data-consent-fallback]').hidden, false);
        if (p.api) assert.equal(p.api.openPreferences(), false);
    });
}

test('an unsupported dialog preserves a valid saved preference while explaining that the UI is unavailable', async t => {
    const p = await page(t, { noDialog: true, decided: true, choices: { analytics: true } });
    assert.equal(p.api.allowed('analytics'), true);
    assert.equal(p.api.openPreferences(), false);
    assert.equal(p.launcher.hidden, true);
    assert.match(p.root.querySelector('[data-consent-fallback]').textContent, /preferences are unavailable/);
});

test('SPA replacement mounts a different variant once and preserves the current decision', async t => {
    const p = await page(t);
    await p.api.choose({ analytics: true });
    p.root.remove();
    await tick();
    p.doc.body.insertAdjacentHTML('beforeend', fixture({ ui: { variant: 'compact' } }).banner);
    await tick();
    const next = p.doc.querySelector('[data-consent-ui]');
    assert.equal(next.dataset.consentVariant, 'compact');
    assert.equal(next.querySelector('[data-consent-banner]').hidden, true);
    assert.equal(p.api.openPreferences(), true);
    assert.equal(next.querySelector('dialog').open, true);
    assert.equal(next.querySelector('[data-consent-category="analytics"]').checked, true);
});

for (const variant of ['standard', 'compact']) {
    test(`${variant} service disclosures preserve draft changes, dismissal, saving, reopening, and withdrawal`, async t => {
        const p = await page(t, { input: { ui: { variant }, locale: 'pl' } });
        assert.equal(p.root.dataset.consentVariant, variant);
        p.button('open').focus();
        p.button('open').click();
        const [details, otherDetails] = p.dialog.querySelectorAll('.consent-service-details');
        assert.equal(details.open, false);
        details.querySelector('summary').click();
        assert.equal(details.open, true);
        assert.equal(otherDetails.open, false);
        assert.match(details.textContent, /Statistics|Campaigns/);
        details.querySelector('summary').click();
        assert.equal(details.open, false);
        otherDetails.querySelector('summary').click();
        assert.equal(otherDetails.open, true);
        assert.equal(details.open, false);
        assert.equal(p.api.allowed('analytics'), false);
        assert.equal(p.api.allowed('marketing'), false);
        assert.equal(p.window.document.cookie, '');
        p.field('analytics').click();
        assert.equal(p.api.allowed('analytics'), false);
        assert.equal(p.window.document.cookie, '');
        p.dialog.dispatchEvent(new p.window.Event('cancel', { cancelable: true }));
        assert.equal(p.doc.activeElement, p.button('open'));
        p.button('open').click();
        assert.equal(p.field('analytics').checked, false);
        p.field('analytics').click();
        p.button('save', true).click();
        await idle(p);
        assert.equal(p.api.allowed('analytics'), true);
        assert.equal(p.api.allowed('marketing'), false);
        assert.equal(p.doc.activeElement, p.launcher);
        p.launcher.click();
        assert.equal(p.field('analytics').checked, true);
        p.button('reject', true).click();
        await idle(p);
        assert.equal(p.api.allowed('analytics'), false);
        assert.equal(p.api.state().decidedAt !== null, true);
        assert.equal(p.launcher.hidden, false);
    });
}

for (const variant of ['standard', 'compact']) {
    for (const locale of ['en', 'pl']) {
        test(`axe structural WCAG checks pass for ${variant} ${locale} banner and modal`, async t => {
            const p = await page(t, { input: { locale, ui: { variant } } });
            p.window.eval(axe.source);
            const options = { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
                rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } } };
            for (const modal of [false, true]) {
                if (modal) p.api.openPreferences();
                const result = await p.window.axe.run(p.doc, options);
                assert.deepEqual(plain(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) }))), []);
            }
        });
    }
}
