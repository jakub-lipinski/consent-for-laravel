'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const { readFileSync } = require('node:fs');
const core = readFileSync('resources/js/consent.js', 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const plain = value => JSON.parse(JSON.stringify(value));
const fixtures = new Map();
function fixture(input = {}) {
    const key = JSON.stringify(input);
    if (!fixtures.has(key)) fixtures.set(key, JSON.parse(execFileSync(process.env.CONSENT_TEST_PHP ?? 'php', ['tests/JavaScript/ui-fixture.php'], { input: key, encoding: 'utf8' })));
    return fixtures.get(key);
}
const block = (id, code, nonce = '') => `<template data-consent-block="${id}" data-consent-category="analytics"><script${nonce ? ` nonce="${nonce}"` : ''}>${code}</script></template>`;
async function page(t, input = {}, options = {}) {
    const f = fixture(input), errors = [], reloads = [], visits = [], requests = [];
    const loader = new ResourceLoader();
    loader.fetch = source => {
        requests.push(source);
        const promise = new Promise(resolve => setTimeout(() => resolve(Buffer.from('window.externalLoaded = true;')), 30));
        promise.abort = () => {};
        return promise;
    };
    const dom = new JSDOM(`<!doctype html><head><title>A</title>${f.head}</head><body><button id="outside" data-consent-open>Preferences</button>${f.banner}${options.html ?? ''}</body>`, {
        url: 'https://example.test/en/a', runScripts: 'dangerously', resources: loader, virtualConsole: new VirtualConsole(),
        beforeParse(window) {
            window.TextEncoder = TextEncoder;
            window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
            window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
            window.fetch = async (url, init) => ({ ok: true, json: async () => ({ id: JSON.parse(init.body).id }) });
            window.document.addEventListener('consent:error', e => errors.push(plain(e.detail)));
            window.document.addEventListener('consent:reload-required', e => reloads.push(plain(e.detail)));
            window.document.addEventListener('consent:navigated', e => visits.push(plain(e.detail)));
            options.before?.(window);
        },
    });
    t.after(() => dom.window.close());
    const w = dom.window, d = w.document;
    if (d.readyState === 'loading') await new Promise(resolve => d.addEventListener('DOMContentLoaded', resolve, { once: true }));
    await w.Consent.whenIdle(); await tick();
    return { w, d, api: w.Consent, f, errors, reloads, visits, requests };
}
function begin(p) {
    const callbacks = [];
    p.d.dispatchEvent(new p.w.CustomEvent('livewire:navigating', { detail: { onSwap: cb => callbacks.push(cb) } }));
    return () => callbacks.forEach(cb => cb());
}
async function visit(p, input = {}, options = {}) {
    const swapped = begin(p);
    const next = fixture(input);
    const doc = new p.w.DOMParser().parseFromString(next.head, 'text/html');
    p.d.querySelector('meta[data-consent-page]').replaceWith(doc.querySelector('meta[data-consent-page]'));
    if (!options.persist) p.d.body.innerHTML = `<button id="outside" data-consent-open>Preferences</button>${next.banner}${options.html ?? ''}`;
    p.w.history.pushState({ alpine: { snapshotIdx: 'new' } }, '', options.url ?? '/pl/b');
    p.d.title = options.title ?? 'B';
    swapped();
    p.d.dispatchEvent(new p.w.Event('livewire:navigated'));
    if (options.idle !== false) { await p.api.whenIdle(); await tick(); }
}

test('initial and fragment navigated events preserve the singleton and do not emit visits', async t => {
    const p = await page(t), api = p.api;
    p.d.dispatchEvent(new p.w.Event('livewire:navigated'));
    p.w.eval(core);
    await p.api.whenIdle();
    assert.equal(p.w.Consent, api);
    assert.deepEqual(p.visits, []);
    assert.equal(p.api.state().decidedAt, null);
});

test('new blocks stay inert while swapping and successful visits activate once in order', async t => {
    const p = await page(t);
    await p.api.choose({ analytics: true });
    const swap = begin(p);
    p.d.body.insertAdjacentHTML('beforeend', block('one', 'window.order = [1]') + block('two', 'window.order.push(2)'));
    await tick();
    assert.equal(p.w.order, undefined);
    swap(); p.d.dispatchEvent(new p.w.Event('livewire:navigated'));
    await p.api.whenIdle();
    assert.deepEqual(plain(p.w.order), [1, 2]);
    await visit(p, {}, { html: block('one', 'window.order = [1]') + block('two', 'window.order.push(2)') });
    assert.deepEqual(plain(p.w.order), [1, 2]);
    assert.equal(p.visits.length, 2);
});

test('an in-flight preserved block pauses its tail and resumes without reloading its library', async t => {
    const p = await page(t, {}, { html: '<template data-consent-block="slow" data-consent-category="analytics"><script src="/slow.js"></script><script>window.tail = (window.tail || 0) + 1;</script></template>' });
    await p.api.acceptAll();
    while (p.requests.length === 0) await tick();
    const swap = begin(p);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(p.w.tail, undefined);
    swap(); p.d.dispatchEvent(new p.w.Event('livewire:navigated'));
    await p.api.whenIdle();
    assert.equal(p.w.tail, 1);
    assert.equal(p.requests.length, 1);
});

test('a removed in-flight block never starts its tail after another page is mounted', async t => {
    const p = await page(t, {}, { html: '<template data-consent-block="slow" data-consent-category="analytics"><script src="/slow.js"></script><script>window.tail = true;</script></template>' });
    await p.api.acceptAll();
    while (p.requests.length === 0) await tick();
    await visit(p);
    assert.equal(p.w.tail, undefined);
});

test('nonce-only replacement of an unstarted block retains the latest execution material', async t => {
    const p = await page(t, {}, { html: block('nonce-copy', 'window.nonceResult = document.currentScript.nonce;', 'first') });
    await visit(p, {}, { html: block('nonce-copy', 'window.nonceResult = document.currentScript.nonce;', 'second') });
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.equal(p.w.nonceResult, 'second');
    assert.equal(p.errors.some(e => e.code === 'duplicate'), false);
});

test('changing the ID of a discovered template cannot create a fresh executable block', async t => {
    const p = await page(t, {}, { html: block('original', 'window.changedId = true;') });
    p.d.querySelector('template').dataset.consentBlock = 'changed';
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.equal(p.w.changedId, undefined);
    assert.equal(p.errors.filter(e => e.code === 'duplicate').length, 1);
});

test('changed contexts and missing markers stop activation and bound automatic recovery', async t => {
    const p = await page(t);
    await p.api.acceptAll();
    const swap = begin(p);
    p.d.querySelector('meta[data-consent-page]').content = 'changed';
    p.d.body.insertAdjacentHTML('beforeend', block('unsafe', 'window.unsafe = true;'));
    swap(); p.d.dispatchEvent(new p.w.Event('livewire:navigated'));
    await p.api.whenIdle();
    assert.equal(p.w.unsafe, undefined);
    assert.equal(p.reloads.length, 1);
    assert.equal(p.reloads[0].reason, 'livewire-context');
    const repeated = await page(t, {}, { before(w) { w.sessionStorage.setItem('consent:livewire-reload:["consent_preferences","/",null]:https://example.test/en/a', '1'); } });
    begin(repeated); repeated.d.querySelector('meta[data-consent-page]').remove();
    repeated.d.dispatchEvent(new repeated.w.Event('livewire:navigated'));
    await repeated.api.whenIdle();
    assert.equal(repeated.reloads[0].automatic, false);
});

test('a cancelled navigation intent leaves the open draft and permissions unchanged', async t => {
    const p = await page(t);
    p.api.openPreferences();
    p.d.querySelector('#consent-category-analytics').checked = true;
    p.d.dispatchEvent(new p.w.CustomEvent('livewire:navigate', { cancelable: true, detail: { url: new URL('https://example.test/b') } }));
    await p.api.whenIdle();
    assert.equal(p.d.querySelector('dialog').open, true);
    assert.equal(p.d.querySelector('#consent-category-analytics').checked, true);
    assert.equal(p.api.allowed('analytics'), false);
});

test('language remount replaces labels and paired notice while preserving cookie lifetime', async t => {
    const p = await page(t, { audit: true });
    await p.api.acceptAll(); const state = plain(p.api.state());
    p.api.openPreferences();
    await visit(p, { audit: true, locale: 'pl' });
    assert.equal(p.d.querySelector('[data-consent-ui]').lang, 'pl');
    assert.equal(p.d.querySelector('dialog').open, false);
    assert.deepEqual(plain(p.api.state()), state);
    assert.equal(p.api.openPreferences(), true);
    assert.equal(p.d.querySelector('dialog').open, true);
    const notice = JSON.parse(JSON.parse(p.d.querySelector('[data-consent-notice]').textContent).payload);
    assert.equal(notice.locale, 'pl');
});

test('same-root child replacement is rebound without stale controls or duplicate save handlers', async t => {
    const p = await page(t);
    const root = p.d.querySelector('[data-consent-ui]');
    const replacement = new p.w.DOMParser().parseFromString(fixture({ locale: 'pl' }).banner, 'text/html').querySelector('[data-consent-ui]');
    root.innerHTML = replacement.innerHTML;
    await tick();
    p.api.openPreferences();
    assert.equal(p.d.querySelector('dialog').open, true);
    p.d.querySelector('#consent-category-analytics').checked = true;
    p.d.querySelector('form').dispatchEvent(new p.w.Event('submit', { cancelable: true }));
    await p.api.whenIdle(); await tick();
    assert.equal(p.api.allowed('analytics'), true);
    assert.equal(p.d.querySelector('dialog').open, false);
});

test('in-flight audits keep their invocation notice and cannot override a newer refusal', async t => {
    const sent = [], receipts = [];
    const p = await page(t, { audit: true }, { before(w) { w.fetch = (url, init) => {
        const body = JSON.parse(init.body); sent.push(body);
        return new Promise(resolve => receipts.push(() => resolve({ ok: true, json: async () => ({ id: body.id }) })));
    }; } });
    const accepting = p.api.acceptAll();
    await visit(p, { audit: true, locale: 'pl' }, { idle: false });
    const refusing = p.api.rejectOptional();
    assert.equal(JSON.parse(sent[0].notice.payload).locale, 'en');
    assert.equal(JSON.parse(sent[1].notice.payload).locale, 'pl');
    receipts.forEach(receipt => receipt());
    await Promise.all([accepting, refusing]); await p.api.whenIdle();
    assert.equal(p.api.allowed('analytics'), false);
    assert.notEqual(sent[0].id, sent[1].id);
});

test('history-only storage denial survives Livewire 4 replacing foreign history fields', async t => {
    const p = await page(t);
    await p.api.choose({ analytics: true });
    const old = p.d.cookie;
    Object.defineProperty(p.d, 'cookie', { configurable: true, get: () => old, set() {} });
    Object.defineProperty(p.w, 'sessionStorage', { get() { throw new Error('Unavailable'); } });
    await assert.rejects(p.api.rejectOptional());
    await visit(p);
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.w.history.state.__consentForLaravelDenied, '["consent_preferences","/",null]');
    assert.equal(p.w.history.state.alpine.snapshotIdx, 'new');
});

test('100 remounts preserve a single handler and one audit for an explicit choice', async t => {
    let calls = 0;
    const p = await page(t, { audit: true }, { before(w) { w.fetch = async (url, init) => {
        calls++; return { ok: true, json: async () => ({ id: JSON.parse(init.body).id }) };
    }; } });
    for (let i = 0; i < 100; i++) await visit(p, { audit: true }, { url: `/en/${i}` });
    p.d.querySelector('[data-consent-banner] [data-consent-action="accept"]').click();
    await p.api.whenIdle(); await tick();
    assert.equal(calls, 1);
    assert.equal(p.visits.length, 100);
    assert.equal(p.errors.length, 0);
});

test('events capture final URL title and predecessor once for each completed swap', async t => {
    const p = await page(t);
    await visit(p, {}, { url: '/en/final?x=1', title: 'Final' });
    p.d.dispatchEvent(new p.w.Event('livewire:navigated'));
    assert.deepEqual(p.visits, [{ id: 1, url: 'https://example.test/en/final?x=1', title: 'Final', previousUrl: 'https://example.test/en/a' }]);
});

test('a malformed or ambiguous active notice never permits a new audited grant', async t => {
    const p = await page(t, { audit: true });
    const node = p.d.querySelector('script[data-consent-notice]');
    node.parentNode.appendChild(node.cloneNode(true));
    await assert.rejects(p.api.acceptAll());
    assert.equal(p.api.allowed('analytics'), false);
});
