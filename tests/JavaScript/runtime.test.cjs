'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { JSDOM, ResourceLoader, CookieJar, VirtualConsole } = require('jsdom');
const runtime = readFileSync('resources/js/consent.js', 'utf8');
const url = 'https://example.test/';
const plain = value => JSON.parse(JSON.stringify(value));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const phpBridge = input => JSON.parse(execFileSync(process.env.CONSENT_TEST_PHP ?? 'php', ['tests/JavaScript/php-bridge.php'], { input: JSON.stringify(input), encoding: 'utf8' }));
const block = (id, category, code) => `<template data-consent-block="${id}" data-consent-category="${category}">${code}</template>`;
const inline = code => `<script>${code}</script>`;
const configuration = overrides => ({
    schemaVersion: 1, policyVersion: '1', servicesVersion: 'a'.repeat(64),
    categories: ['necessary', 'analytics', 'marketing'], retentionDays: 180,
    cookie: { name: 'consent_preferences', path: '/', domain: null, secure: null, sameSite: 'lax' },
    services: [{ id: 'analytics', category: 'analytics', name: 'Statistics', description: 'Measure visits.', cookies: [] }],
    protectedCookies: ['consent_preferences', 'XSRF-TOKEN', 'laravel_session', 'app_session'],
    scriptTimeoutMs: 500, cleanupTimeoutMs: 50, ...overrides,
});
const googleConfig = (mode = 'basic') => ({ mode, targets: [
    { id: 'G-ABCD1234', category: 'analytics', sendPageView: true },
    { id: 'AW-123456789', category: 'marketing', sendPageView: false },
] });
const googleFiles = { '/gtag/js': 'window.googleLoadedWith = Array.from(dataLayer, args => Array.from(args));' };
const commands = p => plain(Array.from(p.window.dataLayer, args => Array.from(args)));
const decision = (config, choices = { analytics: true }, overrides = {}) => {
    const decidedAt = Math.floor(Date.now() / 1000);
    return {
        schemaVersion: 1, policyVersion: config.policyVersion, servicesVersion: config.servicesVersion,
        choices: { necessary: true, analytics: false, marketing: false, performance: false, other: false, ...choices },
        decidedAt, expiresAt: decidedAt + config.retentionDays * 86400, ...overrides,
    };
};
function store(jar, state, path = '/') {
    jar.setCookieSync(`consent_preferences=${encodeURIComponent(typeof state === 'string' ? state : JSON.stringify(state))}; Path=${path}`, url);
}

class Fixtures extends ResourceLoader {
    constructor(files = {}) { super(); this.files = files; this.requests = []; }
    fetch(source) {
        const path = new URL(source).pathname;
        this.requests.push(path);
        const fixture = this.files[path];
        let timer;
        const result = new Promise((resolve, reject) => {
            if (fixture === 'hang') return;
            timer = setTimeout(() => {
                if (fixture === undefined || fixture instanceof Error) reject(fixture ?? new Error(`No fixture for ${path}`));
                else resolve(Buffer.from(typeof fixture === 'string' ? fixture : fixture.body));
            }, typeof fixture === 'object' ? fixture.delay ?? 0 : 0);
        });
        result.abort = () => clearTimeout(timer);
        return result;
    }
}

async function page(t, options = {}) {
    const config = configuration(options.config);
    const jar = options.jar ?? new CookieJar();
    if (options.state !== undefined) store(jar, options.state);
    const loader = new Fixtures(options.files);
    const errors = [], reloads = [], consoleErrors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', error => consoleErrors.push(error));
    const dom = new JSDOM(`<!doctype html><html><head>
        ${options.head ?? ''}
        <script type="application/json" data-consent-config>${JSON.stringify(config)}</script>
        <script nonce="fixture-nonce" data-consent-runtime>${runtime}</script>
        </head><body>${options.html ?? ''}</body></html>`, {
        url, runScripts: 'dangerously', resources: loader, cookieJar: jar, virtualConsole,
        beforeParse(window) {
            window.TextEncoder = TextEncoder;
            window.order = [];
            window.document.addEventListener('consent:error', event => errors.push(plain(event.detail)));
            window.document.addEventListener('consent:reload-required', event => reloads.push(plain(event.detail)));
            options.before?.(window);
        },
    });
    t.after(() => dom.window.close());
    if (dom.window.document.readyState === 'loading') {
        await new Promise(resolve => dom.window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    const api = dom.window.Consent;
    if (options.idle !== false && api) await api.whenIdle();
    return { dom, window: dom.window, api, config, jar, loader, errors, reloads, consoleErrors };
}

test('pending and explicit refusal make no optional requests; necessary blocks still run', async t => {
    const html = block('essential', 'necessary', inline('order.push("necessary")'))
        + block('stats', 'analytics', '<script src="/library.js"></script>' + inline('order.push("init")'));
    const p = await page(t, { html });
    assert.deepEqual(plain(p.window.order), ['necessary']);
    assert.deepEqual(p.loader.requests, []);
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.api.state().decidedAt, null);
    await p.api.rejectOptional();
    await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, []);
    assert.ok(p.api.state().decidedAt > 0);
    assert.ok(Object.isFrozen(p.api.state().choices));
});

test('grant persists first, runs library before initialization, and never repeats a block', async t => {
    const p = await page(t, {
        html: block('stats', 'analytics', '<script async defer src="/library.js"></script>' + inline('order.push("init"); window.initSawCookie = document.cookie.includes("consent_preferences=")')),
        files: { '/library.js': { body: 'order.push("library"); window.fixtureLibrary = true;', delay: 10 } },
    });
    await p.api.choose({ analytics: true });
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['library', 'init']);
    assert.equal(p.window.initSawCookie, true);
    assert.equal(p.api.allowed('marketing'), false);
    const script = p.window.document.querySelector('head script[src]');
    assert.equal(script.nonce, 'fixture-nonce');
    assert.equal(script.hasAttribute('async'), false);
    await p.api.acceptAll();
    await p.api.refresh();
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['library', 'init']);
    assert.deepEqual(p.loader.requests, ['/library.js']);
});

test('current beta.1-format cookies restore choices without extending expiry', async t => {
    const config = configuration();
    const state = decision(config, { marketing: true });
    state.decidedAt -= 20;
    state.expiresAt -= 20;
    const p = await page(t, { state, html: block('ads', 'marketing', inline('order.push("ads")')) });
    assert.deepEqual(plain(p.api.state()), state);
    assert.deepEqual(plain(p.window.order), ['ads']);
    await p.api.refresh();
    assert.deepEqual(JSON.parse(decodeURIComponent(p.jar.getCookiesSync(url)[0].value)), state);
});

const invalid = {
    'malformed JSON': () => '{',
    'unsupported schema': state => ({ ...state, schemaVersion: 2 }),
    'changed policy': state => ({ ...state, policyVersion: '2' }),
    'changed service': state => ({ ...state, servicesVersion: 'b'.repeat(64) }),
    'expired at the boundary': state => ({ ...state, expiresAt: Math.floor(Date.now() / 1000) }),
    'future decision': state => ({ ...state, decidedAt: Math.floor(Date.now() / 1000) + 30 }),
    'excess retention': state => ({ ...state, expiresAt: state.decidedAt + 366 * 86400 }),
    'extra field': state => ({ ...state, unexpected: true }),
    'missing field': state => { delete state.decidedAt; return state; },
    'string timestamp': state => ({ ...state, decidedAt: String(state.decidedAt) }),
    'non-boolean choice': state => ({ ...state, choices: { ...state.choices, analytics: 1 } }),
    'unused category granted': state => ({ ...state, choices: { ...state.choices, performance: true } }),
    'necessary denied': state => ({ ...state, choices: { ...state.choices, necessary: false } }),
    'incomplete choices': state => { delete state.choices.other; return state; },
    'overlong value': () => ' '.repeat(3073),
    'broken percent encoding': () => '%ZZ',
};
for (const [name, mutate] of Object.entries(invalid)) {
    test(`${name} fails closed before fetching scripts`, async t => {
        const p = await page(t, { state: mutate(decision(configuration())), html: block('stats', 'analytics', '<script src="/library.js"></script>') });
        assert.equal(p.api.allowed('analytics'), false);
        assert.equal(p.api.state().decidedAt, null);
        assert.deepEqual(p.loader.requests, []);
    });
}

test('ambiguous duplicate preference cookies fail closed', async t => {
    const jar = new CookieJar();
    store(jar, decision(configuration()));
    store(jar, decision(configuration()), '/account');
    // The second scope must be visible on this page to be ambiguous.
    jar.setCookieSync(`consent_preferences=${encodeURIComponent(JSON.stringify(decision(configuration())))}; Domain=.example.test; Path=/`, url);
    // A host-only and Domain cookie for the identical domain can coalesce in cookie jars.
    const p = await page(t, { jar, before(window) {
        const cookie = window.document.cookie;
        Object.defineProperty(window.document, 'cookie', { get: () => `${cookie}; consent_preferences=duplicate` });
    } });
    assert.equal(p.api.allowed('analytics'), false);
});

test('invalid selections reject without changing an existing decision', async t => {
    const p = await page(t);
    for (const choices of [null, [], { analytics: 'true' }, { necessary: false }, { unknown: true }, { performance: true }]) {
        await assert.rejects(p.api.choose(choices), /choices|category/);
    }
    assert.equal(p.api.state().decidedAt, null);
    assert.equal(p.window.document.cookie, '');
    assert.throws(() => p.api.allowed('unknown'), /category/);
});

test('blocked preference storage rejects and never activates optional scripts', async t => {
    const p = await page(t, {
        html: block('stats', 'analytics', inline('order.push("stats")')),
        before(window) { Object.defineProperty(window.document, 'cookie', { get: () => '', set: () => {} }); },
    });
    await assert.rejects(p.api.acceptAll(), /could not be stored/);
    await p.api.whenIdle();
    assert.equal(p.api.allowed('analytics'), false);
    assert.deepEqual(plain(p.window.order), []);
    assert.equal(p.errors[0].code, 'storage');
});

test('external failures stop initialization but allow independent blocks', async t => {
    const p = await page(t, {
        html: block('broken', 'analytics', '<script src="/missing.js"></script>' + inline('order.push("must-not-run")'))
            + block('healthy', 'analytics', inline('order.push("healthy")')),
        files: { '/missing.js': new Error('Fixture failure') },
    });
    await p.api.acceptAll();
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['healthy']);
    assert.equal(p.errors[0].block, 'broken');
    await p.api.refresh();
    await p.api.whenIdle();
    assert.equal(p.loader.requests.length, 1);
});

test('synchronous inline errors stop dependent initialization', async t => {
    const p = await page(t, { html: block('broken', 'analytics', inline('throw new Error("Broken initialization")') + inline('order.push("must-not-run")')) });
    await p.api.acceptAll();
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), []);
    assert.equal(p.errors[0].code, 'script');
    assert.match(p.errors[0].message, /Broken initialization/);
});

test('only script elements are allowed; unsupported schemes and types are rejected', async t => {
    const p = await page(t, {
        html: block('html', 'analytics', inline('order.push("must-not-run")') + '<img src="/pixel.gif">')
            + block('url', 'analytics', '<script src="data:text/javascript,alert(1)"></script>')
            + block('type', 'analytics', '<script type="text/vbscript">invalid</script>')
            + block('json', 'analytics', '<script type="application/json" src="/data.json"></script>'),
    });
    await p.api.acceptAll();
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), []);
    assert.deepEqual(p.loader.requests, []);
    assert.deepEqual(p.errors.map(error => error.block), ['html', 'url', 'type', 'json']);
});

test('data scripts stay inert and retain type, attributes, and their explicit nonce', async t => {
    const p = await page(t, { html: block('json', 'analytics', '<script type="application/json" id="stats-config" nonce="own-nonce">{"enabled":true}</script>') });
    await p.api.acceptAll();
    await p.api.whenIdle();
    const node = p.window.document.querySelector('head #stats-config');
    assert.equal(node.type, 'application/json');
    assert.equal(node.nonce, 'own-nonce');
    assert.deepEqual(JSON.parse(node.textContent), { enabled: true });
});

test('identical IDs and external sources deduplicate; conflicting IDs report a diagnostic', async t => {
    const scripts = '<script src="/shared.js"></script>' + inline('order.push("init-a")');
    const p = await page(t, {
        html: block('a', 'analytics', scripts) + block('a', 'analytics', scripts)
            + block('b', 'analytics', '<script type="text/javascript" src="/shared.js"></script>' + inline('order.push("init-b")'))
            + block('a', 'marketing', inline('order.push("conflict")')),
        files: { '/shared.js': 'order.push("shared")' },
    });
    await p.api.acceptAll();
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['shared', 'init-a', 'init-b']);
    assert.equal(p.loader.requests.length, 1);
    assert.equal(p.errors.length, 1);
    assert.equal(p.errors[0].code, 'duplicate');
});

test('new SPA fragments obey current choices and existing block identities', async t => {
    const p = await page(t);
    p.window.document.body.insertAdjacentHTML('beforeend', block('dynamic', 'analytics', inline('order.push("dynamic")')));
    await delay(0);
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), []);
    await p.api.choose({ analytics: true });
    await p.api.whenIdle();
    p.window.document.body.insertAdjacentHTML('beforeend', block('dynamic', 'analytics', inline('order.push("dynamic")')));
    await delay(0);
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['dynamic']);
});

test('a prepended dependency runs before previously discovered initialization', async t => {
    const p = await page(t, { html: block('init', 'analytics', inline('order.push(window.libraryReady ? "init" : "missing-library")')),
        files: { '/library.js': 'window.libraryReady = true; order.push("library")' } });
    p.window.document.body.insertAdjacentHTML('afterbegin', block('library', 'analytics', '<script src="/library.js"></script>'));
    await delay(0); await p.api.whenIdle();
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['library', 'init']);
    assert.deepEqual(p.loader.requests, ['/library.js']);
});

test('moving already discovered waiting blocks changes their activation order', async t => {
    const p = await page(t, { html: block('a', 'analytics', inline('order.push("a")'))
        + block('b', 'analytics', inline('order.push("b")')) });
    const [a, b] = p.window.document.querySelectorAll('template');
    a.before(b);
    await delay(0); await p.api.whenIdle();
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['b', 'a']);
});

test('the next block follows current DOM order after an asynchronous script chain', async t => {
    const p = await page(t, { html: block('active', 'analytics', '<script src="/slow.js"></script>' + inline('order.push("active-init")'))
        + block('a', 'analytics', inline('order.push("a")')) + block('b', 'analytics', inline('order.push("b")')),
        files: { '/slow.js': { body: 'order.push("slow")', delay: 40 } } });
    await p.api.choose({ analytics: true });
    while (p.loader.requests.length === 0) await delay(1);
    const a = p.window.document.querySelector('template[data-consent-block="a"]');
    a.before(p.window.document.querySelector('template[data-consent-block="b"]'));
    a.insertAdjacentHTML('beforebegin', block('new', 'analytics', inline('order.push("new")')));
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['slow', 'active-init', 'b', 'new', 'a']);
});

test('a detached waiting block never requests its resource after a grant', async t => {
    const p = await page(t, { html: block('old', 'analytics', '<script src="/old.js"></script>' + inline('order.push("old-init")')),
        files: { '/old.js': 'order.push("old")' } });
    p.window.document.querySelector('template').remove();
    p.window.document.body.insertAdjacentHTML('beforeend', block('new', 'analytics', inline('order.push("new")')));
    await delay(0); await p.api.whenIdle();
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, []);
    assert.deepEqual(plain(p.window.order), ['new']);
    assert.deepEqual(p.errors, []);
});

test('a block removed while another block loads is skipped without a new DOM insertion', async t => {
    const p = await page(t, { html: block('active', 'analytics', '<script src="/slow.js"></script>')
        + block('old', 'analytics', '<script src="/old.js"></script>') + block('healthy', 'analytics', inline('order.push("healthy")')),
        files: { '/slow.js': { body: 'order.push("slow")', delay: 40 }, '/old.js': 'order.push("old")' } });
    await p.api.choose({ analytics: true });
    while (p.loader.requests.length === 0) await delay(1);
    p.window.document.querySelector('template[data-consent-block="old"]').remove();
    await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, ['/slow.js']);
    assert.deepEqual(plain(p.window.order), ['slow', 'healthy']);
});

test('detaching an active block stops its remaining scripts and preserves revocation tracking', async t => {
    const p = await page(t, { html: block('active', 'analytics', '<script src="/slow.js"></script>'
        + '<script src="/dependent.js"></script>' + inline('order.push("init")'))
        + block('healthy', 'analytics', inline('order.push("healthy")')),
        files: { '/slow.js': { body: 'order.push("slow")', delay: 40 }, '/dependent.js': 'order.push("dependent")' } });
    await p.api.choose({ analytics: true });
    while (p.loader.requests.length === 0) await delay(1);
    const template = p.window.document.querySelector('template');
    template.remove();
    await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, ['/slow.js']);
    assert.deepEqual(plain(p.window.order), ['slow', 'healthy']);
    p.window.document.body.append(template);
    await delay(0); await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, ['/slow.js']);
    await p.api.rejectOptional();
    assert(p.reloads.some(event => event.reason === 'revocation'));
});

test('a script removing its own block prevents later scripts in that block', async t => {
    const p = await page(t, { html: block('self', 'analytics', inline('order.push("first"); document.querySelector("template").remove()')
        + inline('order.push("must-not-run")')) + block('healthy', 'analytics', inline('order.push("healthy")')) });
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['first', 'healthy']);
});

test('an identical replacement of an unstarted detached block runs at its current position once', async t => {
    const markup = block('replace', 'analytics', inline('order.push("replace")'));
    const p = await page(t, { html: markup + block('before', 'analytics', inline('order.push("before")')) });
    p.window.document.querySelector('template').remove();
    p.window.document.body.insertAdjacentHTML('beforeend', markup);
    await delay(0); await p.api.whenIdle();
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['before', 'replace']);
    p.window.document.querySelector('template[data-consent-block="replace"]').remove();
    p.window.document.body.insertAdjacentHTML('beforeend', markup);
    await delay(0); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['before', 'replace']);
    assert.deepEqual(p.errors, []);
});

test('replacing a detached block with conflicting content cannot reuse its identity', async t => {
    const p = await page(t, { html: block('same', 'analytics', inline('order.push("original")')) });
    p.window.document.querySelector('template').remove();
    p.window.document.body.insertAdjacentHTML('beforeend', block('same', 'analytics', inline('order.push("conflict")')));
    await delay(0); await p.api.whenIdle();
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), []);
    assert(p.errors.some(error => error.code === 'duplicate'));
});

test('reattaching an unchanged unstarted template retains its original identity', async t => {
    const p = await page(t, { html: block('same', 'analytics', inline('order.push("same")')) });
    const template = p.window.document.querySelector('template');
    template.remove();
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), []);
    p.window.document.body.append(template);
    await delay(0); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['same']);
});

test('an identical replacement cannot revive a mutated detached block', async t => {
    const markup = block('same', 'analytics', inline('order.push("original")'));
    const p = await page(t, { html: markup });
    const template = p.window.document.querySelector('template');
    template.remove();
    template.dataset.consentCategory = 'marketing';
    p.window.document.body.insertAdjacentHTML('beforeend', markup);
    await delay(0); await p.api.whenIdle();
    await p.api.acceptAll(); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), []);
    assert(p.errors.some(error => error.code === 'duplicate'));
});

test('a foreign SVG template cannot replace a detached HTML block', async t => {
    const markup = inline('order.push("original")');
    const p = await page(t, { html: block('same', 'analytics', markup) });
    p.window.document.querySelector('template').remove();
    p.window.document.body.insertAdjacentHTML('beforeend', `<svg><template data-consent-block="same" data-consent-category="analytics">${markup}</template></svg>`);
    await delay(0); await p.api.whenIdle();
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), []);
    assert.deepEqual(p.loader.requests, []);
});

test('a waiting template adopted into another document cannot activate in its old document', async t => {
    const p = await page(t, { html: block('foreign', 'analytics', inline('order.push("foreign")')) });
    const other = new JSDOM('<!doctype html><body></body>');
    t.after(() => other.window.close());
    const template = other.window.document.adoptNode(p.window.document.querySelector('template'));
    other.window.document.body.append(template);
    assert.equal(template.isConnected, true);
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), []);
});

test('a denied earlier block does not delay a connected allowed category', async t => {
    const p = await page(t, { html: block('ads', 'marketing', inline('order.push("ads")'))
        + block('stats', 'analytics', inline('order.push("stats")')) });
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['stats']);
});

test('mutating an existing waiting block cannot run marketing under its original analytics permission', async t => {
    const p = await page(t, {
        html: block('mutable', 'analytics', inline('order.push("original")')),
        files: { '/marketing.js': 'order.push("marketing")' },
    });
    const template = p.window.document.querySelector('template');
    template.dataset.consentCategory = 'marketing';
    template.innerHTML = '<script src="/marketing.js"></script>';
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.equal(p.api.allowed('marketing'), false);
    assert.deepEqual(p.loader.requests, []);
    assert.deepEqual(plain(p.window.order), []);
    assert.equal(p.errors.filter(error => error.code === 'duplicate').length, 1);
    template.dataset.consentCategory = 'analytics';
    template.innerHTML = inline('order.push("original")');
    await p.api.acceptAll(); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), []);
});

test('non-HTML templates do not interrupt scanning valid inert blocks', async t => {
    const p = await page(t, {
        html: '<svg><template data-consent-block="foreign" data-consent-category="analytics"></template></svg>'
            + block('stats', 'analytics', inline('order.push("stats")')),
    });
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['stats']);
    assert(p.errors.some(error => error.code === 'block' && error.block === 'foreign'));
    assert(!p.errors.some(error => error.code === 'loader'));
});

test('a block changed during an external load cannot execute its changed dependent script', async t => {
    const p = await page(t, {
        html: block('mutable', 'analytics', '<script src="/library.js"></script>' + inline('order.push("original-init")')),
        files: { '/library.js': { body: 'order.push("library")', delay: 30 }, '/marketing.js': 'order.push("marketing")' },
    });
    await p.api.choose({ analytics: true });
    while (p.loader.requests.length === 0) await delay(1);
    const template = p.window.document.querySelector('template');
    template.dataset.consentCategory = 'marketing';
    template.content.querySelectorAll('script')[1].src = '/marketing.js';
    await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, ['/library.js']);
    assert.deepEqual(plain(p.window.order), ['library']);
    assert.equal(p.api.allowed('marketing'), false);
    assert.equal(p.errors.filter(error => error.code === 'duplicate').length, 1);
});

test('restoring template markup during a load cannot execute a mutated detached script reference', async t => {
    const p = await page(t, {
        html: block('mutable', 'analytics', '<script src="/library.js"></script>' + inline('order.push("original-init")')),
        files: { '/library.js': { body: 'order.push("library")', delay: 30 }, '/marketing.js': 'order.push("marketing")' },
    });
    await p.api.choose({ analytics: true });
    while (p.loader.requests.length === 0) await delay(1);
    const template = p.window.document.querySelector('template');
    const markup = template.innerHTML;
    template.content.querySelectorAll('script')[1].src = '/marketing.js';
    template.innerHTML = markup;
    await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, ['/library.js']);
    assert.deepEqual(plain(p.window.order), ['library', 'original-init']);
    assert.equal(p.api.allowed('marketing'), false);
});

test('revoking active code saves refusal and requests a reload even after node removal', async t => {
    const p = await page(t, { html: block('stats', 'analytics', inline('order.push("stats")')) });
    await p.api.acceptAll();
    await p.api.whenIdle();
    await p.api.rejectOptional();
    assert.equal(p.api.state().choices.analytics, false);
    assert.equal(p.api.allowed('analytics'), false);
    assert.deepEqual(p.reloads, [{ reason: 'revocation' }]);
    assert.deepEqual(plain(p.window.order), ['stats']);
    assert.equal(p.window.document.querySelectorAll('head script:not([data-consent-config]):not([data-consent-runtime])').length, 0);
});

test('in-flight revocation cancels the chain and requests a reload', async t => {
    const p = await page(t, {
        html: block('stats', 'analytics', '<script src="/slow.js"></script>' + inline('order.push("must-not-run")')),
        files: { '/slow.js': { body: 'order.push("library")', delay: 30 } },
    });
    p.api.onRevoke('analytics', () => {}, { reload: false });
    await p.api.choose({ analytics: true });
    await delay(0);
    assert.equal(p.loader.requests.length, 1);
    await p.api.rejectOptional();
    await p.api.whenIdle();
    await delay(40);
    assert.equal(p.window.order.includes('must-not-run'), false);
    assert.equal(p.reloads.length, 1);
});

test('cooperative cleanup is awaited, receives denied state, and prevents reruns on regrant', async t => {
    const p = await page(t, { html: block('stats', 'analytics', inline('window.tracking = true; order.push("init")')) });
    const changes = [];
    const unsubscribe = p.api.onChange((current, previous, source) => changes.push({ current: current.choices.analytics, previous: previous.choices.analytics, source }));
    p.api.onRevoke('analytics', async state => { await delay(5); p.window.tracking = false; assert.equal(state.choices.analytics, false); }, { reload: false });
    await p.api.choose({ analytics: true });
    await p.api.whenIdle();
    await p.api.rejectOptional();
    assert.equal(p.window.tracking, false);
    assert.equal(p.reloads.length, 0);
    await p.api.choose({ analytics: true });
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['init']);
    assert.deepEqual(changes.map(change => change.current), [true, false, true]);
    unsubscribe();
    await p.api.choose({ analytics: false });
    assert.equal(changes.length, 3);
});

for (const kind of ['throw', 'reject', 'timeout']) {
    test(`cooperative cleanup ${kind} falls back to reload`, async t => {
        const p = await page(t, { html: block('stats', 'analytics', inline('order.push("stats")')), config: { cleanupTimeoutMs: 10 } });
        p.api.onRevoke('analytics', () => {
            if (kind === 'throw') throw new Error('Cleanup failed');
            if (kind === 'reject') return Promise.reject(new Error('Cleanup failed'));
            return new Promise(() => {});
        }, { reload: false });
        await p.api.acceptAll();
        await p.api.whenIdle();
        await p.api.rejectOptional();
        assert.equal(p.reloads.length, 1);
        assert.ok(p.errors.some(error => error.code === 'cleanup'));
    });
}

test('external timeout stops initialization and requests a fresh document', async t => {
    const p = await page(t, {
        html: block('stats', 'analytics', '<script src="/hung.js"></script>' + inline('order.push("must-not-run")')),
        files: { '/hung.js': 'hang' }, config: { scriptTimeoutMs: 10 },
    });
    await p.api.acceptAll();
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), []);
    assert.deepEqual(p.reloads, [{ reason: 'script-timeout' }]);
});

test('cookie cleanup uses declared scope, protects application cookies, and runs on denied startup', async t => {
    const jar = new CookieJar();
    for (const name of ['_track', '_track_extra', '_unrelated', 'XSRF-TOKEN', 'app_session', 'remember_web_token']) jar.setCookieSync(`${name}=value; Path=/`, url);
    const p = await page(t, {
        jar, config: { services: [{ id: 'stats', category: 'analytics', cookies: [
            { prefix: '_track', name: null, path: '/', domain: null },
            { prefix: 'app_', name: null, path: '/', domain: null },
            { prefix: 'remember_', name: null, path: '/', domain: null },
            { prefix: 'consent_', name: null, path: '/', domain: null },
            { name: 'XSRF-TOKEN', prefix: null, path: '/', domain: null },
        ] }] },
    });
    assert.deepEqual(jar.getCookiesSync(url).map(cookie => cookie.key), ['_unrelated', 'XSRF-TOKEN', 'app_session', 'remember_web_token']);
    await p.api.acceptAll();
    p.window.document.cookie = '_track=again; Path=/';
    await p.api.rejectOptional();
    assert.equal(p.window.document.cookie.includes('_track='), false);
    assert.equal(p.window.document.cookie.includes('consent_preferences='), true);
});

test('forget removes the decision and returns to pending without inventing a refusal', async t => {
    const p = await page(t);
    await p.api.acceptAll();
    await p.api.forget();
    assert.equal(p.api.state().decidedAt, null);
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.window.document.cookie, '');
});

test('server or another tab decisions synchronize and revoke active code', async t => {
    const jar = new CookieJar();
    const first = await page(t, { jar, html: block('stats', 'analytics', inline('order.push("stats")')) });
    const second = await page(t, { jar });
    await second.api.choose({ analytics: true });
    await first.api.refresh();
    await first.api.whenIdle();
    assert.deepEqual(plain(first.window.order), ['stats']);
    await second.api.rejectOptional();
    await first.api.refresh();
    assert.equal(first.api.allowed('analytics'), false);
    assert.equal(first.reloads.length, 1);
});

test('expiry during an open page revokes permission and runs cleanup', async t => {
    const config = configuration();
    const state = decision(config, { analytics: true }, { expiresAt: Math.floor(Date.now() / 1000) + 10 });
    const p = await page(t, { state, html: block('stats', 'analytics', inline('order.push("stats")')) });
    p.window.Date.now = () => state.expiresAt * 1000;
    await p.api.refresh();
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.api.state().decidedAt, null);
    assert.equal(p.reloads.length, 1);
});

test('failed listeners are reported without breaking other listeners or loading', async t => {
    const p = await page(t, { html: block('stats', 'analytics', inline('order.push("stats")')) });
    p.api.onChange(() => { throw new Error('Listener failed'); });
    p.api.onChange(() => Promise.reject(new Error('Async listener failed')));
    p.api.onChange(() => p.window.order.push('listener'));
    await p.api.acceptAll();
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['listener', 'stats']);
    assert.equal(p.errors.filter(error => error.code === 'listener').length, 2);
});

test('loading the runtime twice preserves the same API and listeners', async t => {
    const p = await page(t);
    p.window.eval(runtime);
    assert.equal(p.window.Consent, p.api);
    assert.equal(p.errors.length, 0);
});

test('unavailable cookie access still permits necessary scripts and refuses optional grants', async t => {
    const p = await page(t, {
        html: block('essential', 'necessary', inline('order.push("necessary")')),
        before(window) {
            Object.defineProperty(window.document, 'cookie', {
                get() { throw new window.DOMException('Storage is unavailable', 'SecurityError'); },
                set() { throw new window.DOMException('Storage is unavailable', 'SecurityError'); },
            });
        },
    });
    assert.deepEqual(plain(p.window.order), ['necessary']);
    await assert.rejects(p.api.acceptAll(), /unavailable/);
    assert.equal(p.api.allowed('analytics'), false);
});

test('a failed refusal cannot leave the previous granted state active in memory', async t => {
    const p = await page(t, { html: block('stats', 'analytics', inline('order.push("stats")')) });
    await p.api.acceptAll();
    await p.api.whenIdle();
    const previousCookie = p.window.document.cookie;
    Object.defineProperty(p.window.document, 'cookie', { get: () => previousCookie, set: () => {} });
    await assert.rejects(p.api.rejectOptional(), /could not be stored/);
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.api.state().choices.analytics, false);
    assert.equal(p.reloads.length, 1);
    const key = `consent:storage-denied:${JSON.stringify([p.config.cookie.name, '/', null])}`;
    const deniedMarker = p.window.sessionStorage.getItem(key);
    const restored = await page(t, {
        jar: p.jar, html: block('stats', 'analytics', '<script src="/library.js"></script>'),
        before(window) { window.sessionStorage.setItem(key, deniedMarker); },
    });
    assert.equal(restored.api.allowed('analytics'), false);
    assert.deepEqual(restored.loader.requests, []);
    await restored.api.rejectOptional();
    assert.equal(restored.window.sessionStorage.getItem(key), null);
});

test('history state preserves denial across reload when session storage is unavailable', async t => {
    const p = await page(t, {
        html: block('stats', 'analytics', inline('order.push("stats")')),
        before(window) {
            window.history.replaceState({ app: 'keep' }, '');
            Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Unavailable'); } });
        },
    });
    await p.api.acceptAll();
    await p.api.whenIdle();
    const previousCookie = p.window.document.cookie;
    Object.defineProperty(p.window.document, 'cookie', { get: () => previousCookie, set: () => {} });
    await assert.rejects(p.api.rejectOptional());
    assert.equal(p.window.history.state.app, 'keep');
    const savedHistory = plain(p.window.history.state);
    const restored = await page(t, { jar: p.jar, before(window) { window.history.replaceState(savedHistory, ''); } });
    assert.equal(restored.api.allowed('analytics'), false);
    await restored.api.rejectOptional();
    assert.deepEqual(plain(restored.window.history.state), { app: 'keep' });
});

test('an unpersistable denial reports required navigation without reloading into the old grant', async t => {
    const p = await page(t, {
        html: block('stats', 'analytics', inline('order.push("stats")')),
        before(window) {
            Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Unavailable'); } });
            window.history.replaceState('app-owned-primitive', '');
        },
    });
    await p.api.acceptAll();
    await p.api.whenIdle();
    const previousCookie = p.window.document.cookie;
    Object.defineProperty(p.window.document, 'cookie', { get: () => previousCookie, set: () => {} });
    await assert.rejects(p.api.rejectOptional());
    assert.equal(p.api.allowed('analytics'), false);
    assert.deepEqual(p.reloads, [{ reason: 'revocation', automatic: false }]);
    assert.ok(p.errors.some(error => error.code === 'storage-denial'));
    assert.equal(p.window.history.state, 'app-owned-primitive');
});

test('whenIdle called from the head waits for body blocks and initial loading', async t => {
    const p = await page(t, {
        html: inline('window.headWait = Consent.whenIdle().then(() => order.push("idle"))')
            + block('essential', 'necessary', inline('order.push("necessary")')),
    });
    await p.window.headWait;
    assert.deepEqual(plain(p.window.order), ['necessary', 'idle']);
});

test('an unrelated global namespace is preserved and gated blocks remain inert', async t => {
    const p = await page(t, { idle: false, html: block('stats', 'analytics', inline('order.push("stats")')), before(window) { window.Consent = { existing: true }; } });
    assert.equal(p.window.Consent.existing, true);
    assert.equal(p.errors[0].code, 'namespace');
    assert.deepEqual(plain(p.window.order), []);
});

test('invalid bootstrap metadata aborts before any script activation', async t => {
    const p = await page(t, { config: { categories: ['analytics'] }, html: block('stats', 'analytics', '<script src="/library.js"></script>') });
    assert.equal(p.api, undefined);
    assert.equal(p.errors[0].code, 'configuration');
    assert.deepEqual(p.loader.requests, []);
});

test('queued decisions replace categories deterministically without interleaving writes', async t => {
    const p = await page(t);
    await Promise.all([p.api.choose({ analytics: true }), p.api.choose({ marketing: true }), p.api.rejectOptional()]);
    assert.deepEqual(plain(p.api.state().choices), { necessary: true, analytics: false, marketing: false, performance: false, other: false });
    assert.equal(p.reloads.length, 0);
});

test('real PHP decisions restore in JavaScript and browser choices restore in PHP', async t => {
    const { config, decision: state } = phpBridge({});
    const p = await page(t, { config, state });
    assert.deepEqual(plain(p.api.state()), state);
    assert.equal(p.api.allowed('analytics'), true);
    await p.api.choose({ marketing: true });
    const cookie = decodeURIComponent(p.jar.getCookiesSync(url).find(item => item.key === 'consent_preferences').value);
    assert.deepEqual(phpBridge({ cookie }).restored, plain(p.api.state()));
    await p.api.rejectOptional();
    const refusedCookie = decodeURIComponent(p.jar.getCookiesSync(url).find(item => item.key === 'consent_preferences').value);
    assert.deepEqual(phpBridge({ cookie: refusedCookie }).restored, plain(p.api.state()));
});

for (const field of ['schemaVersion', 'decidedAt', 'expiresAt']) {
    test(`non-integer JSON token for ${field} fails closed like PHP`, async t => {
        const { config, decision: state } = phpBridge({});
        const cookie = JSON.stringify(state).replace(`"${field}":${state[field]}`, `"${field}":${state[field]}.0`);
        const p = await page(t, { config, state: cookie });
        assert.equal(p.api.allowed('analytics'), false);
        assert.equal(phpBridge({ cookie }).restored.decidedAt, null);
    });
}

test('UTF-8 byte size, not character count, bounds the preference cookie', async t => {
    const config = configuration({ policyVersion: 'Zażółć' });
    const cookie = JSON.stringify(decision(config));
    const padded = cookie + ' '.repeat(3072 - cookie.length);
    const p = await page(t, { config, state: padded });
    assert.equal(p.api.allowed('analytics'), false);
});

test('Unicode policy strings and numbers inside strings retain their valid cookie meaning', async t => {
    const config = configuration({ policyVersion: 'Zażółć "decidedAt":1.0 v2' });
    const p = await page(t, { config, state: decision(config) });
    assert.equal(p.api.allowed('analytics'), true);
});

test('Google Basic sends no requests or measurement commands for pending or refused preferences', async t => {
    const p = await page(t, { config: { google: googleConfig() }, files: googleFiles });
    assert.deepEqual(p.loader.requests, []);
    assert.deepEqual(commands(p).map(args => args[0]), ['consent', 'set', 'set', 'consent']);
    assert.equal(commands(p)[0][2].ad_user_data, 'denied');
    assert.equal(commands(p)[0][2].analytics_storage, 'denied');
    assert.equal(p.window['ga-disable-G-ABCD1234'], true);
    await p.api.rejectOptional();
    await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, []);
    assert.equal(await p.api.google.event('AW-123456789/label', 'conversion'), false);
    assert.equal(await p.api.google.event('G-ABCD1234', 'purchase'), false);
});

test('Google defaults and restored update precede tag load and GA configuration without enabling Ads', async t => {
    const config = configuration({ google: googleConfig() });
    const p = await page(t, { config, state: decision(config), files: googleFiles });
    assert.deepEqual(p.loader.requests, ['/gtag/js']);
    const beforeLoad = plain(p.window.googleLoadedWith);
    assert.equal(beforeLoad[0][1], 'default');
    assert.equal(beforeLoad[3][1], 'update');
    assert.equal(beforeLoad[3][2].analytics_storage, 'granted');
    assert.equal(beforeLoad[3][2].ad_personalization, 'denied');
    assert.deepEqual(commands(p).filter(args => args[0] === 'config'), [['config', 'G-ABCD1234', {
        send_page_view: true, allow_google_signals: false, allow_ad_personalization_signals: false,
    }]]);
    assert.equal(p.window['ga-disable-G-ABCD1234'], false);
    assert.equal(await p.api.google.event('AW-123456789/label', 'conversion'), false);
});

test('presets share one library and initialize each destination once after its category is granted', async t => {
    const p = await page(t, { config: { google: googleConfig() }, files: googleFiles });
    await p.api.choose({ marketing: true });
    await p.api.whenIdle();
    assert.equal(new URL(p.window.document.querySelector('script[src]').src).searchParams.get('id'), 'AW-123456789');
    assert.deepEqual(commands(p).filter(args => args[0] === 'config').map(args => args[1]), ['AW-123456789']);
    await p.api.acceptAll();
    await p.api.whenIdle();
    await p.api.refresh();
    await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, ['/gtag/js']);
    assert.deepEqual(commands(p).filter(args => args[0] === 'config').map(args => args[1]), ['AW-123456789', 'G-ABCD1234']);
    assert.equal(commands(p).filter(args => args[0] === 'js').length, 1);
    assert.equal(p.window.document.querySelector('script[src]').nonce, 'fixture-nonce');
});

test('Google events are routed only to their granted configured destination', async t => {
    const p = await page(t, { config: { google: googleConfig() }, files: googleFiles });
    await p.api.choose({ analytics: true });
    assert.equal(await p.api.google.event('G-ABCD1234', 'purchase', { value: 25, currency: 'PLN' }), true);
    assert.deepEqual(commands(p).at(-1), ['event', 'purchase', { value: 25, currency: 'PLN', send_to: 'G-ABCD1234' }]);
    assert.equal(await p.api.google.event('AW-123456789/label', 'conversion'), false);
    await p.api.acceptAll();
    assert.equal(await p.api.google.event('AW-123456789/label', 'conversion', { transaction_id: 'order-1' }), true);
    assert.equal(commands(p).at(-1)[2].send_to, 'AW-123456789/label');
    for (const args of [
        ['G-UNKNOWN1', 'purchase'], ['AW-123456789', 'conversion'], ['AW-123456789/label', 'purchase'],
        ['AW-123456789/label/invalid', 'conversion'], ['G-ABCD1234', 'purchase', { send_to: 'other' }],
        ['G-ABCD1234', 'purchase', { event_callback: () => {} }], ['G-ABCD1234', 'bad event'],
    ]) await assert.rejects(p.api.google.event(...args), /Google|destination|Ads/);
});

test('Google does not replay an event invoked before a queued grant', async t => {
    const p = await page(t, { config: { google: googleConfig() }, files: googleFiles });
    const grant = p.api.acceptAll();
    const event = p.api.google.event('G-ABCD1234', 'purchase', { value: 25 });
    await grant;
    assert.equal(await event, false);
    await p.api.whenIdle();
    assert.equal(commands(p).some(args => args[0] === 'event'), false);
});

test('Google snapshots event parameters and still checks permission after a queued withdrawal', async t => {
    const p = await page(t, { config: { google: googleConfig() }, files: googleFiles });
    await p.api.acceptAll();
    const parameters = { value: 25, items: [{ item_id: 'original' }] };
    const event = p.api.google.event('G-ABCD1234', 'purchase', parameters);
    parameters.value = 99;
    parameters.items[0].item_id = 'changed';
    assert.equal(await event, true);
    assert.deepEqual(commands(p).at(-1)[2], { value: 25, items: [{ item_id: 'original' }], send_to: 'G-ABCD1234' });
    const withdrawal = p.api.rejectOptional();
    const lateEvent = p.api.google.event('G-ABCD1234', 'purchase');
    await withdrawal;
    assert.equal(await lateEvent, false);
    assert.equal(commands(p).filter(args => args[0] === 'event').length, 1);
});

test('a broken Google command queue cannot prevent consent withdrawal and reload', async t => {
    const p = await page(t, { config: { google: googleConfig() }, files: googleFiles });
    await p.api.acceptAll();
    await p.api.whenIdle();
    p.window.dataLayer.push = () => { throw new Error('Vendor queue failed'); };
    await p.api.rejectOptional();
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.api.allowed('marketing'), false);
    assert.equal(p.window['ga-disable-G-ABCD1234'], true);
    assert.ok(p.errors.some(event => event.code === 'google'));
    assert.ok(p.reloads.some(event => event.reason === 'revocation'));
    assert.equal(await p.api.google.event('G-ABCD1234', 'purchase'), false);
});

test('Google revocation updates all v2 signals before listeners and mandatory reload, even with custom cleanup', async t => {
    const p = await page(t, { config: { google: googleConfig() }, files: googleFiles });
    await p.api.acceptAll();
    await p.api.whenIdle();
    p.api.onRevoke('analytics', () => {}, { reload: false });
    p.api.onRevoke('marketing', () => {}, { reload: false });
    let atChange, atReload;
    p.api.onChange(() => { atChange = commands(p).at(-1); });
    p.window.document.addEventListener('consent:reload-required', () => { atReload = commands(p).at(-1); });
    await p.api.rejectOptional();
    assert.equal(atChange[1], 'update');
    assert.equal(atReload[1], 'update');
    for (const signal of ['analytics_storage', 'ad_storage', 'ad_user_data', 'ad_personalization']) assert.equal(atReload[2][signal], 'denied');
    assert.equal(p.window['ga-disable-G-ABCD1234'], true);
    assert.ok(p.reloads.some(event => event.reason === 'revocation'));
    assert.equal(await p.api.google.event('G-ABCD1234', 'purchase'), false);
});

test('withdrawing during Google download cancels configuration and blocks later events', async t => {
    const p = await page(t, { config: { google: googleConfig() }, files: { '/gtag/js': { body: 'window.lateGoogle = true;', delay: 100 } } });
    await p.api.acceptAll();
    await delay(10);
    await p.api.rejectOptional();
    await p.api.whenIdle();
    assert.equal(commands(p).some(args => args[0] === 'config'), false);
    assert.ok(p.reloads.some(event => event.reason === 'revocation'));
    assert.equal(await p.api.google.event('AW-123456789/label', 'conversion'), false);
});

test('Google Advanced explicitly loads denied tags but the event helper still requires consent', async t => {
    const p = await page(t, { config: { google: googleConfig('advanced') }, files: googleFiles });
    assert.deepEqual(p.loader.requests, ['/gtag/js']);
    assert.equal(commands(p)[3][2].analytics_storage, 'denied');
    assert.equal(commands(p).filter(args => args[0] === 'config').length, 2);
    assert.equal(p.window['ga-disable-G-ABCD1234'], false);
    assert.equal(await p.api.google.event('G-ABCD1234', 'purchase'), false);
    await p.api.acceptAll();
    await p.api.whenIdle();
    assert.equal(commands(p).filter(args => args[0] === 'config').length, 2);
    await p.api.rejectOptional();
    assert.equal(p.window['ga-disable-G-ABCD1234'], true);
    assert.ok(p.reloads.some(event => event.reason === 'revocation'));
});

test('Google load failure emits diagnostics without configuring destinations or accepting events', async t => {
    const p = await page(t, { config: { google: googleConfig() }, files: { '/gtag/js': new Error('Blocked by CSP') } });
    await p.api.acceptAll();
    await p.api.whenIdle();
    assert.ok(p.errors.some(event => event.code === 'google'));
    assert.equal(commands(p).some(args => args[0] === 'config'), false);
    assert.equal(await p.api.google.event('G-ABCD1234', 'purchase'), false);
    assert.deepEqual(p.loader.requests, ['/gtag/js']);
});

test('Google bridge supports custom gated gtag code and no automatic library', async t => {
    const p = await page(t, { config: { google: { mode: 'basic', targets: [] } },
        html: block('manual-google', 'analytics', inline("gtag('event', 'custom');")) });
    assert.equal(commands(p).some(args => args[0] === 'event'), false);
    await p.api.choose({ analytics: true });
    await p.api.whenIdle();
    assert.deepEqual(commands(p).at(-1), ['event', 'custom']);
    assert.equal(commands(p).find(args => args[1] === 'update' && args[2].analytics_storage === 'granted')[2].ad_user_data, 'denied');
    assert.deepEqual(p.loader.requests, []);
});

test('GA automatic page view can be disabled for SPA owners', async t => {
    const google = googleConfig();
    google.targets[0].sendPageView = false;
    const p = await page(t, { config: { google }, files: googleFiles });
    await p.api.choose({ analytics: true });
    await p.api.whenIdle();
    assert.equal(commands(p).find(args => args[0] === 'config')[2].send_page_view, false);
});

for (const conflict of ['gtag', 'queued config', 'non-array layer']) {
    test(`preexisting Google ${conflict} fails closed rather than setting late defaults`, async t => {
        const p = await page(t, { config: { google: googleConfig() }, before(window) {
            if (conflict === 'gtag') window.gtag = () => {};
            else window.dataLayer = conflict === 'queued config' ? [['config', 'G-ABCD1234']] : {};
        } });
        assert.equal(p.api, undefined);
        assert.ok(p.errors.some(error => error.code === 'configuration'));
        assert.deepEqual(p.loader.requests, []);
    });
}

test('blocked preference storage never grants Google or starts Basic requests', async t => {
    const p = await page(t, { config: { google: googleConfig() }, files: googleFiles, before(window) {
        Object.defineProperty(window.document, 'cookie', { get: () => '', set: () => {} });
    } });
    await assert.rejects(p.api.acceptAll(), /stored|persist|cookie/i);
    await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, []);
    assert.equal(p.api.google.state().ad_user_data, 'denied');
    assert.equal(p.api.google.state().analytics_storage, 'denied');
});

test('expired Google consent becomes denied before refresh cleanup', async t => {
    const config = configuration({ google: googleConfig() });
    const p = await page(t, { config, state: decision(config), files: googleFiles });
    store(p.jar, decision(config, { analytics: true }, { expiresAt: Math.floor(Date.now() / 1000) }));
    await p.api.refresh();
    assert.equal(commands(p).at(-1)[1], 'update');
    assert.equal(commands(p).at(-1)[2].analytics_storage, 'denied');
    assert.ok(p.reloads.some(event => event.reason === 'revocation'));
});

const trackerConfig = (advertising = false, sendPageView = true) => ({
    meta: { id: '123456789012345', sendPageView },
    clarity: { id: 'abc123def4', advertising },
});
const metaFixture = `
window.metaCommands = Array.from(fbq.queue, args => Array.from(args));
fbq.queue.length = 0;
fbq.callMethod = function () { metaCommands.push(Array.from(arguments)); };
`;
const clarityFixture = `
window.clarityCommands = Array.from(clarity.q, args => Array.from(args));
window.clarity = function () { clarityCommands.push(Array.from(arguments)); };
`;
const trackerFiles = { '/en_US/fbevents.js': metaFixture, '/tag/abc123def4': clarityFixture };

for (const preset of ['google', 'meta', 'clarity']) {
    const send = p => preset === 'google' ? p.api.google.event('G-ABCD1234', 'regression_event')
        : preset === 'meta' ? p.api.meta.trackCustom('regression_event') : p.api.clarity.event('regression_event');
    test(`${preset} pending event cannot delay refusal or dispatch after withdrawal`, async t => {
        const p = await page(t, { config: { google: googleConfig(), trackers: trackerConfig() }, files: {
            ...trackerFiles, '/gtag/js': 'hang',
        } });
        await p.api.acceptAll();
        const event = send(p);
        await delay(0);
        const refusal = p.api.rejectOptional();
        const state = await Promise.race([refusal, delay(100).then(() => null)]);
        assert.ok(state, 'refusal must finish without waiting for the SDK timeout');
        assert.equal(state.choices.analytics, false);
        assert.equal(state.choices.marketing, false);
        assert.equal(await event, false);
        await p.api.whenIdle();
        assert.equal(commands(p).some(args => args[0] === 'event'), false);
        assert.equal(p.window.metaCommands, undefined);
        assert.equal(p.window.clarityCommands, undefined);
        assert.deepEqual(p.reloads, [{ reason: 'revocation' }]);
    });

    test(`${preset} event waits for its preset without waiting for a custom script`, async t => {
        const p = await page(t, { config: { google: googleConfig(), trackers: trackerConfig() },
            files: { ...googleFiles, ...trackerFiles, '/custom.js': 'hang' },
            html: block('custom', 'analytics', '<script src="/custom.js"></script>') });
        await p.api.acceptAll();
        for (let attempt = 0; !p.loader.requests.includes('/custom.js') && attempt < 100; attempt++) await delay(1);
        assert.ok(p.loader.requests.includes('/custom.js'));
        const result = await Promise.race([send(p), delay(100).then(() => null)]);
        assert.equal(result, true, 'ready SDK events must not depend on custom script completion');
        await p.api.rejectOptional();
        await p.api.whenIdle();
        assert.equal(p.errors.some(error => /timed out/.test(error.message)), false);
    });
}

test('a repeated timeout stops automatic reloads until that script completes successfully', async t => {
    const memory = new Map();
    const before = window => Object.defineProperty(window, 'sessionStorage', { value: {
        getItem: key => memory.get(key) ?? null,
        setItem: (key, value) => memory.set(key, value),
        removeItem: key => memory.delete(key),
    } });
    const config = configuration({ scriptTimeoutMs: 10 });
    const state = decision(config);
    const html = block('slow', 'analytics', '<script src="/slow.js"></script>');
    const first = await page(t, { config, state, html, before, files: { '/slow.js': 'hang' } });
    assert.deepEqual(first.reloads, [{ reason: 'script-timeout' }]);
    const second = await page(t, { config, state, html, before, files: { '/slow.js': 'hang' } });
    assert.deepEqual(second.reloads, [{ reason: 'script-timeout', automatic: false }]);
    assert.equal(await second.api.google.event('G-ABCD1234', 'test').catch(() => false), false);
    const recovered = await page(t, { config, state, html, before, files: { '/slow.js': 'order.push("recovered")' } });
    assert.deepEqual(plain(recovered.window.order), ['recovered']);
    const again = await page(t, { config, state, html, before, files: { '/slow.js': 'hang' } });
    assert.deepEqual(again.reloads, [{ reason: 'script-timeout' }]);
});

test('a timeout with unavailable retry storage requests a manual reload', async t => {
    const config = configuration({ scriptTimeoutMs: 10 });
    const p = await page(t, { config, state: decision(config),
        html: block('slow', 'analytics', '<script src="/slow.js"></script>'), files: { '/slow.js': 'hang' },
        before(window) { Object.defineProperty(window, 'sessionStorage', { value: {
            getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); },
        } }); } });
    assert.deepEqual(p.reloads, [{ reason: 'script-timeout', automatic: false }]);
});
const trackerServices = [
    { id: 'meta-pixel', category: 'marketing', cookies: [ { name: '_fbp', prefix: null, path: '/', domain: null }, { name: '_fbc', prefix: null, path: '/', domain: null } ] },
    { id: 'microsoft-clarity', category: 'analytics', cookies: [ { name: '_clck', prefix: null, path: '/', domain: null }, { name: '_clsk', prefix: null, path: '/', domain: null } ] },
];

test('tracker presets make no requests or event replay while pending or refused', async t => {
    const p = await page(t, { config: { trackers: trackerConfig() }, files: trackerFiles });
    assert.deepEqual(p.loader.requests, []);
    assert.deepEqual(plain(p.window.fbq.queue.map(args => Array.from(args))), [['consent', 'revoke']]);
    assert.deepEqual(plain(p.api.clarity.state()), { analytics_Storage: 'denied', ad_Storage: 'denied' });
    assert.equal(await p.api.meta.track('Purchase', { value: 9 }), false);
    assert.equal(await p.api.clarity.event('checkout'), false);
    await p.api.rejectOptional();
    assert.deepEqual(p.loader.requests, []);
    await p.api.acceptAll();
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.metaCommands.filter(args => args[0] === 'track')), [['track', 'PageView']]);
    assert.equal(p.window.clarityCommands.some(args => args[0] === 'event'), false);
});

test('Clarity analytics never grants advertising implicitly and addresses the replacement API', async t => {
    const p = await page(t, { config: { trackers: trackerConfig() }, files: trackerFiles });
    await p.api.choose({ analytics: true });
    await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, ['/tag/abc123def4']);
    assert.deepEqual(plain(p.window.clarityCommands.at(-1)), ['consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' }]);
    assert.equal(await p.api.clarity.event('checkout-completed'), true);
    assert.deepEqual(plain(p.window.clarityCommands.at(-1)), ['event', 'checkout-completed']);
    assert.equal(await p.api.meta.track('Lead'), false);
});

test('Meta needs marketing, initializes once, inherits CSP nonce, and sends typed events', async t => {
    const p = await page(t, { config: { trackers: trackerConfig() }, files: trackerFiles });
    await p.api.choose({ marketing: true });
    await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, ['/en_US/fbevents.js']);
    assert.deepEqual(plain(p.window.metaCommands), [['consent', 'revoke'], ['consent', 'grant'], ['init', '123456789012345'], ['track', 'PageView']]);
    assert.equal(p.window.document.querySelector('script[src]').nonce, 'fixture-nonce');
    assert.equal(p.window.document.querySelector('noscript'), null);
    assert.equal(await p.api.meta.track('Purchase', { value: 19, currency: 'PLN' }, { eventID: 'order-42' }), true);
    assert.deepEqual(plain(p.window.metaCommands.at(-1)), ['track', 'Purchase', { value: 19, currency: 'PLN' }, { eventID: 'order-42' }]);
    assert.equal(await p.api.meta.trackCustom('NewsletterSignup'), true);
    await p.api.choose({ marketing: true });
    await p.api.whenIdle();
    assert.equal(p.window.metaCommands.filter(args => args[0] === 'init').length, 1);
    assert.equal(p.window.metaCommands.filter(args => args[1] === 'PageView').length, 1);
});

test('Meta SPA configuration omits automatic PageView and captures event data at invocation', async t => {
    const p = await page(t, { config: { trackers: trackerConfig(false, false) }, files: trackerFiles });
    await p.api.acceptAll(); await p.api.whenIdle();
    const params = { value: 10 }; const options = { eventID: 'original' };
    const result = p.api.meta.track('Purchase', params, options);
    params.value = 999; options.eventID = 'changed';
    assert.equal(await result, true);
    assert.deepEqual(plain(p.window.metaCommands.at(-1)), ['track', 'Purchase', { value: 10 }, { eventID: 'original' }]);
    assert.equal(p.window.metaCommands.some(args => args[1] === 'PageView'), false);
});

test('denied tracker calls cannot become replayed events behind an already queued acceptance', async t => {
    const p = await page(t, { config: { trackers: trackerConfig() }, files: trackerFiles });
    const grant = p.api.acceptAll();
    const meta = p.api.meta.track('Lead'); const clarity = p.api.clarity.event('lead');
    await grant;
    assert.equal(await meta, false); assert.equal(await clarity, false);
    await p.api.whenIdle();
    assert.equal(p.window.metaCommands.some(args => args[1] === 'Lead'), false);
    assert.equal(p.window.clarityCommands.some(args => args[0] === 'event'), false);
});

test('restored decisions apply tracker consent before each SDK loads', async t => {
    const config = configuration({ trackers: trackerConfig(true) });
    const p = await page(t, { config, state: decision(config, { analytics: true, marketing: true }), files: trackerFiles });
    assert.deepEqual(p.loader.requests, ['/en_US/fbevents.js', '/tag/abc123def4']);
    assert.deepEqual(plain(p.window.clarityCommands[0]), ['consentv2', { analytics_Storage: 'granted', ad_Storage: 'granted' }]);
    assert.deepEqual(plain(p.window.metaCommands.slice(0, 2)), [['consent', 'revoke'], ['consent', 'grant']]);
});

test('marketing alone never loads Clarity, even with advertising enabled', async t => {
    const p = await page(t, { config: { trackers: { clarity: trackerConfig(true).clarity } }, files: trackerFiles });
    await p.api.choose({ marketing: true }); await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, []);
    assert.deepEqual(plain(p.api.clarity.state()), { analytics_Storage: 'denied', ad_Storage: 'denied' });
    await p.api.acceptAll(); await p.api.whenIdle();
    assert.deepEqual(plain(p.api.clarity.state()), { analytics_Storage: 'granted', ad_Storage: 'granted' });
});

for (const category of ['marketing', 'analytics']) {
    test(`active ${category} tracker withdrawal sends denial before listeners, cleans cookies, and forces reload`, async t => {
        const p = await page(t, { config: { trackers: trackerConfig(), services: trackerServices }, files: trackerFiles });
        await p.api.acceptAll(); await p.api.whenIdle();
        for (const name of ['_fbp', '_fbc', '_clck', '_clsk', 'app_session']) p.window.document.cookie = `${name}=fixture; Path=/`;
        p.api.onRevoke(category, () => {}, { reload: false });
        let observed;
        p.api.onChange(() => { observed = category === 'marketing' ? plain(p.window.metaCommands.at(-1)) : plain(p.window.clarityCommands.at(-1)); });
        await p.api.choose({ analytics: category !== 'analytics', marketing: category !== 'marketing' });
        assert.deepEqual(observed, category === 'marketing' ? ['consent', 'revoke'] : ['consentv2', { analytics_Storage: 'denied', ad_Storage: 'denied' }]);
        assert.equal(p.reloads.length, 1);
        assert.equal(await p.api.meta.track('Lead'), false);
        assert.equal(await p.api.clarity.event('lead'), false);
        assert.ok(p.window.document.cookie.includes('app_session=fixture'));
        const removed = category === 'marketing' ? ['_fbp', '_fbc'] : ['_clck', '_clsk'];
        assert.ok(removed.every(name => !p.window.document.cookie.includes(`${name}=`)));
    });
}

test('Clarity advertising withdrawal requires reload while analytics stays accepted', async t => {
    const p = await page(t, { config: { trackers: { clarity: trackerConfig(true).clarity } }, files: trackerFiles });
    await p.api.acceptAll(); await p.api.whenIdle();
    await p.api.choose({ analytics: true });
    assert.deepEqual(plain(p.window.clarityCommands.at(-1)), ['consentv2', { analytics_Storage: 'granted', ad_Storage: 'denied' }]);
    assert.equal(p.reloads.length, 1);
});

test('marketing withdrawn during a Clarity advertising request still reloads', async t => {
    const p = await page(t, { config: { trackers: { clarity: trackerConfig(true).clarity }, scriptTimeoutMs: 300 }, files: { '/tag/abc123def4': 'hang' } });
    await p.api.acceptAll();
    await delay(10);
    await p.api.choose({ analytics: true });
    assert.equal(p.reloads.length, 1);
    assert.deepEqual(plain(p.api.clarity.state()), { analytics_Storage: 'granted', ad_Storage: 'denied' });
});

test('expiry and external cookie refusal revoke tracker consent and reload', async t => {
    for (const source of ['expiry', 'external']) {
        const p = await page(t, { config: { trackers: trackerConfig() }, files: trackerFiles });
        await p.api.acceptAll(); await p.api.whenIdle();
        if (source === 'expiry') {
            const original = p.window.Date.now; p.window.Date.now = () => original() + 181 * 86400000;
        } else store(p.jar, decision(p.config, {}));
        await p.api.refresh();
        assert.deepEqual(plain(p.window.metaCommands.at(-1)), ['consent', 'revoke']);
        assert.deepEqual(plain(p.window.clarityCommands.at(-1)), ['consentv2', { analytics_Storage: 'denied', ad_Storage: 'denied' }]);
        assert.equal(p.reloads.length, 1);
    }
});

test('failed tracker loads are isolated and never initialize or retry', async t => {
    const p = await page(t, { config: { trackers: trackerConfig() }, files: { ...trackerFiles, '/en_US/fbevents.js': new Error('offline') }, html: block('custom', 'analytics', inline('order.push("custom")')) });
    await p.api.acceptAll(); await p.api.whenIdle();
    assert.equal(await p.api.meta.track('Lead'), false);
    assert.equal(await p.api.clarity.event('checkout'), true);
    assert.deepEqual(plain(p.window.order), ['custom']);
    assert.equal(p.errors.filter(error => error.code === 'meta').length, 1);
    assert.equal(p.loader.requests.filter(path => path === '/en_US/fbevents.js').length, 1);
    assert.equal(p.window.fbq.queue.some(args => args[0] === 'init'), false);
});

test('tracker command failure cannot prevent stored denial and reload', async t => {
    const p = await page(t, { config: { trackers: trackerConfig() }, files: trackerFiles });
    await p.api.acceptAll(); await p.api.whenIdle();
    p.window.fbq.callMethod = () => { throw new Error('SDK error'); };
    await p.api.rejectOptional();
    assert.equal(p.api.state().choices.marketing, false);
    assert.equal(p.api.state().choices.analytics, false);
    assert.equal(p.reloads.length, 1);
    assert.ok(p.errors.some(error => error.code === 'meta'));
});

for (const preset of ['meta', 'clarity']) {
    test(`duplicate ${preset} bootstrap is rejected before any optional runtime activation`, async t => {
        const p = await page(t, { config: { trackers: trackerConfig() }, before: window => { window[preset === 'meta' ? 'fbq' : 'clarity'] = () => {}; } });
        assert.equal(p.api, undefined);
        assert.equal(p.errors[0].code, 'configuration');
        assert.deepEqual(p.loader.requests, []);
    });
}

test('duplicate script elements and malformed tracker settings fail closed', async t => {
    for (const trackers of [{ meta: null }, { meta: { id: 123, sendPageView: true } }, { clarity: { id: '../unsafe', advertising: false } }, { gtm: {} }]) {
        const p = await page(t, { config: { trackers } });
        assert.equal(p.api, undefined);
        assert.equal(p.errors[0].code, 'configuration');
    }
    for (const source of ['https://connect.facebook.net/en_US/fbevents.js', 'https://www.clarity.ms/tag/abc123def4']) {
        const p = await page(t, { config: { trackers: trackerConfig() }, head: `<script type="application/json" src="${source}"></script>` });
        assert.equal(p.api, undefined);
        assert.equal(p.errors[0].code, 'configuration');
        assert.deepEqual(p.loader.requests, []);
    }
});

test('invalid tracker events reject clearly without sending commands', async t => {
    const p = await page(t, { config: { trackers: trackerConfig() }, files: trackerFiles });
    for (const args of [[''], ['Purchase', []], ['Purchase', {}, { eventID: '' }], ['Purchase', {}, { other: true }]]) {
        await assert.rejects(p.api.meta.track(...args), error => error.name === 'TypeError');
    }
    await assert.rejects(p.api.clarity.event('a'.repeat(129)), error => error.name === 'TypeError');
    const disabled = await page(t);
    await assert.rejects(disabled.api.meta.track('Lead'), /not enabled/);
    await assert.rejects(disabled.api.clarity.event('lead'), /not enabled/);
    assert.deepEqual(p.loader.requests, []);
});

test('Google Advanced never relaxes the strict gates of Meta or Clarity', async t => {
    const p = await page(t, { config: { google: googleConfig('advanced'), trackers: trackerConfig() }, files: { ...googleFiles, ...trackerFiles } });
    assert.deepEqual(p.loader.requests, ['/gtag/js']);
    await p.api.rejectOptional(); await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, ['/gtag/js']);
    assert.equal(await p.api.meta.track('Lead'), false);
    assert.equal(await p.api.clarity.event('lead'), false);
});

test('Meta withdrawal during loading cancels initialization and automatic PageView', async t => {
    const p = await page(t, { config: { trackers: trackerConfig() }, files: { ...trackerFiles, '/en_US/fbevents.js': { body: metaFixture, delay: 80 } } });
    await p.api.choose({ marketing: true });
    await delay(10);
    await p.api.rejectOptional(); await p.api.whenIdle();
    assert.equal(p.reloads.length, 1);
    assert.equal(p.window.metaCommands, undefined);
    assert.equal(p.window.fbq.queue.some(args => args[0] === 'init'), false);
    assert.deepEqual(plain(Array.from(p.window.fbq.queue.at(-1))), ['consent', 'revoke']);
});

test('Clarity timeout requires a fresh document and prevents further event dispatch', async t => {
    const p = await page(t, { config: { trackers: trackerConfig(), scriptTimeoutMs: 25 }, files: { ...trackerFiles, '/tag/abc123def4': 'hang' }, html: block('other-stats', 'analytics', inline('order.push("independent")')) });
    await p.api.acceptAll(); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), []);
    assert.equal(await p.api.clarity.event('checkout'), false);
    assert.equal(await p.api.meta.track('Lead'), false);
    assert.deepEqual(p.reloads, [{ reason: 'script-timeout' }]);
    assert.ok(p.errors.some(error => error.code === 'clarity'));
});

test('failed preference storage starts neither tracker and never sends granted signals', async t => {
    const p = await page(t, { config: { trackers: trackerConfig() }, files: trackerFiles, before: window => {
        Object.defineProperty(window.document, 'cookie', { get: () => '', set: () => {} });
    } });
    await assert.rejects(p.api.acceptAll(), /stored/);
    await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, []);
    assert.deepEqual(plain(p.window.fbq.queue.map(args => Array.from(args))), [['consent', 'revoke']]);
    assert.deepEqual(plain(p.api.clarity.state()), { analytics_Storage: 'denied', ad_Storage: 'denied' });
});

test('Meta rechecks external cookie changes after init before automatic PageView', async t => {
    const config = configuration({ trackers: trackerConfig() });
    const refused = encodeURIComponent(JSON.stringify(decision(config, {})));
    const fixture = metaFixture + `const originalMeta=fbq.callMethod;fbq.callMethod=function(){originalMeta(...arguments);if(arguments[0]==='init')document.cookie='consent_preferences=${refused}; Path=/';};`;
    const p = await page(t, { config, files: { ...trackerFiles, '/en_US/fbevents.js': fixture } });
    await p.api.choose({ marketing: true }); await p.api.whenIdle();
    assert.equal(p.window.metaCommands.some(args => args[1] === 'PageView'), false);
    assert.equal(p.api.state().choices.marketing, false);
    assert.equal(p.reloads.length, 1);
});

const auditConfig = { path: '/consent/decisions', timeoutMs: 100 };
const auditNoticeHtml = '<script type="application/json" data-consent-notice>{"payload":"signed cached notice","signature":"signature"}</script>';
const auditReceipt = (options, status = 201) => ({ ok: status < 400, status, json: async () => ({ id: JSON.parse(options.body).id }) });

test('audit is passive on load and refresh; grants await a matching durable receipt', async t => {
    const requests = [];
    let acknowledge;
    const p = await page(t, {
        config: { audit: auditConfig }, html: auditNoticeHtml + block('stats', 'analytics', inline('order.push("stats")')),
        before(window) { window.fetch = (url, options) => { requests.push({ url, options }); return new Promise(resolve => { acknowledge = () => resolve(auditReceipt(options)); }); }; },
    });
    p.api.state(); await p.api.refresh();
    assert.equal(requests.length, 0);
    const saving = p.api.choose({ analytics: true });
    await delay(5);
    assert.equal(p.api.allowed('analytics'), false);
    assert.deepEqual(plain(p.window.order), []);
    assert.equal(requests[0].url, 'https://example.test/consent/decisions');
    assert.equal(requests[0].options.keepalive, true);
    assert.equal(requests[0].options.credentials, 'same-origin');
    assert.equal(requests[0].options.redirect, 'error');
    acknowledge(); await saving; await p.api.whenIdle();
    assert.equal(p.api.allowed('analytics'), true);
    assert.deepEqual(plain(p.window.order), ['stats']);
});

test('audit logs all explicit API actions with full choices and the original cached notice', async t => {
    const requests = [];
    const p = await page(t, { config: { audit: auditConfig }, html: auditNoticeHtml,
        before(window) { window.fetch = async (url, options) => { requests.push(JSON.parse(options.body)); return auditReceipt(options); }; },
    });
    await p.api.acceptAll(); await p.api.choose({ analytics: true }); await p.api.rejectOptional(); await p.api.forget();
    assert.deepEqual(requests.map(r => r.action), ['accept_all', 'save_preferences', 'reject_optional', 'withdraw']);
    assert.equal(new Set(requests.map(r => r.id)).size, 4);
    assert.equal(requests.every(r => r.notice.payload === 'signed cached notice'), true);
    assert.equal(requests.every(r => Object.keys(r.choices).length === 5 && r.choices.necessary), true);
    assert.equal(p.api.state().decidedAt, null);
});

test('audit retries transient failures with the same event ID and request body', async t => {
    const requests = [];
    const p = await page(t, { config: { audit: auditConfig }, html: auditNoticeHtml,
        before(window) { window.fetch = async (url, options) => { requests.push(options.body); return auditReceipt(options, requests.length === 1 ? 503 : 201); }; },
    });
    await p.api.acceptAll();
    assert.equal(requests.length, 2);
    assert.equal(requests[0], requests[1]);
    assert.equal(p.api.allowed('analytics'), true);
});

test('audit failures block new grants while preserving a visible error event', async t => {
    let attempts = 0;
    const p = await page(t, { config: { audit: auditConfig }, html: auditNoticeHtml,
        before(window) { window.fetch = async (url, options) => { attempts++; return auditReceipt(options, 503); }; },
    });
    await assert.rejects(p.api.acceptAll(), /503/);
    assert.equal(attempts, 2);
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.api.state().decidedAt, null);
    assert.equal(p.errors.filter(e => e.code === 'audit').length, 1);
});

test('audit rejection takes effect before a stalled request and survives its failure', async t => {
    const config = configuration({ audit: auditConfig });
    let requests = 0;
    const p = await page(t, { config, state: decision(config), html: auditNoticeHtml + block('stats', 'analytics', inline('order.push("stats")')),
        before(window) { window.fetch = (url, options) => { requests++; return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('deadline')))); }; },
    });
    assert.equal(p.api.allowed('analytics'), true);
    const saving = p.api.rejectOptional();
    const failure = assert.rejects(saving, /deadline/);
    assert.equal(p.api.allowed('analytics'), false);
    await delay(10);
    assert.equal(p.reloads.length, 1);
    await failure;
    assert.equal(requests, 2);
    assert.equal(p.api.allowed('analytics'), false);
    const cookie = JSON.parse(decodeURIComponent(p.jar.getCookiesSync(url).find(c => c.key === 'consent_preferences').value));
    assert.equal(cookie.choices.analytics, false);
});

test('audit withdrawal clears preferences immediately while delivery is stalled', async t => {
    const config = configuration({ audit: auditConfig });
    const p = await page(t, { config, state: decision(config), html: auditNoticeHtml,
        before(window) { window.fetch = (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('deadline')))); },
    });
    const withdrawal = p.api.forget();
    const failure = assert.rejects(withdrawal, /deadline/);
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.api.state().decidedAt, null);
    assert.equal(p.jar.getCookiesSync(url).some(c => c.key === 'consent_preferences'), false);
    await failure;
});

test('a later refusal prevents a late grant receipt from reactivating optional scripts', async t => {
    const acknowledgements = [];
    const p = await page(t, { config: { audit: auditConfig }, html: auditNoticeHtml + block('stats', 'analytics', inline('order.push("stats")')),
        before(window) { window.fetch = (url, options) => new Promise(resolve => acknowledgements.push(() => resolve(auditReceipt(options)))); },
    });
    const grant = p.api.acceptAll();
    const refuse = p.api.rejectOptional();
    assert.equal(p.api.allowed('analytics'), false);
    acknowledgements[1](); await delay(1);
    acknowledgements[0](); await Promise.all([grant, refuse]); await p.api.whenIdle();
    assert.equal(p.api.allowed('analytics'), false);
    assert.deepEqual(plain(p.window.order), []);
});

for (const refresh of [false, true]) {
    for (const action of ['refusal', 'partial choice', 'withdrawal']) {
        test(`a delayed audit cannot overwrite another tab's ${action} ${refresh ? 'after refresh' : 'before polling'}`, async t => {
            const config = configuration({ audit: auditConfig });
            const decidedAt = Math.floor(Date.now() / 1000) - 60;
            const initial = decision(config, { analytics: true }, { decidedAt, expiresAt: decidedAt + config.retentionDays * 86400 });
            let acknowledge;
            const p = await page(t, {
                config, state: initial,
                html: auditNoticeHtml + block('ads', 'marketing', '<script src="/ads.js"></script>' + inline('order.push("ads")')),
                files: { '/ads.js': 'window.adsLoaded = true;' },
                before(window) { window.fetch = (url, options) => new Promise(resolve => { acknowledge = () => resolve(auditReceipt(options)); }); },
            });
            const other = await page(t, { config, jar: p.jar, html: auditNoticeHtml,
                before(window) { window.fetch = async (url, options) => auditReceipt(options); },
            });
            const saving = p.api.acceptAll();
            if (action === 'refusal') await other.api.rejectOptional();
            else if (action === 'withdrawal') await other.api.forget();
            else await other.api.choose({ analytics: true });
            const latest = plain(other.api.state());
            if (refresh) await p.api.refresh();
            acknowledge();
            assert.deepEqual(plain(await saving), latest);
            await p.api.whenIdle();
            assert.deepEqual(plain(p.api.state()), latest);
            assert.deepEqual(plain(other.api.state()), latest);
            assert.equal(p.api.allowed('marketing'), false);
            assert.equal(p.window.adsLoaded, undefined);
            assert.deepEqual(p.loader.requests, []);
            assert.deepEqual(plain(p.window.order), []);
            if (action === 'withdrawal') assert.equal(p.jar.getCookiesSync(url).some(cookie => cookie.key === 'consent_preferences'), false);
            else assert.deepEqual(JSON.parse(decodeURIComponent(p.jar.getCookiesSync(url).find(cookie => cookie.key === 'consent_preferences').value)), latest);
        });
    }
}

test('an observed external decision supersedes a pending audit even if the cookie returns to its baseline', async t => {
    const config = configuration({ audit: auditConfig });
    const initial = decision(config, {});
    let acknowledge;
    const p = await page(t, { config, state: initial, html: auditNoticeHtml,
        before(window) { window.fetch = (url, options) => new Promise(resolve => { acknowledge = () => resolve(auditReceipt(options)); }); },
    });
    const saving = p.api.acceptAll();
    store(p.jar, decision(config, { analytics: true }));
    await p.api.refresh();
    store(p.jar, initial);
    acknowledge(); await saving; await p.api.whenIdle();
    assert.deepEqual(plain(p.api.state()), initial);
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.api.allowed('marketing'), false);
});

test('a new explicit audited choice can follow an external decision that arrived before invocation', async t => {
    const p = await page(t, { config: { audit: auditConfig }, html: auditNoticeHtml,
        before(window) { window.fetch = async (url, options) => auditReceipt(options); },
    });
    store(p.jar, decision(p.config, {}));
    await p.api.acceptAll(); await p.api.whenIdle();
    assert.equal(p.api.allowed('analytics'), true);
    assert.equal(p.api.allowed('marketing'), true);
});

test('a delayed refusal receipt cannot overwrite another tab\'s newer audited acceptance', async t => {
    let acknowledge;
    const p = await page(t, { config: { audit: auditConfig }, html: auditNoticeHtml,
        before(window) { window.fetch = (url, options) => new Promise(resolve => { acknowledge = () => resolve(auditReceipt(options)); }); },
    });
    const refusing = p.api.rejectOptional();
    const other = await page(t, { config: p.config, jar: p.jar, html: auditNoticeHtml,
        before(window) { window.fetch = async (url, options) => auditReceipt(options); },
    });
    await other.api.acceptAll();
    const latest = plain(other.api.state());
    acknowledge(); await refusing; await p.api.whenIdle();
    assert.deepEqual(plain(p.api.state()), latest);
    assert.deepEqual(plain(other.api.state()), latest);
});

test('mixed audit choices remove old grants immediately and delay newly granted categories', async t => {
    const config = configuration({ audit: auditConfig });
    let acknowledge;
    const p = await page(t, { config, state: decision(config), html: auditNoticeHtml,
        before(window) { window.fetch = (url, options) => new Promise(resolve => { acknowledge = () => resolve(auditReceipt(options)); }); },
    });
    const saving = p.api.choose({ marketing: true });
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.api.allowed('marketing'), false);
    acknowledge(); await saving;
    assert.equal(p.api.allowed('analytics'), false);
    assert.equal(p.api.allowed('marketing'), true);
    await p.api.whenIdle();
});

async function interruptedMixedAudit(t, historyFallback = false) {
    const config = configuration({ audit: auditConfig });
    let body;
    const p = await page(t, {
        config, state: decision(config), html: auditNoticeHtml + block('stats', 'analytics', inline('order.push("stats")')),
        before(window) {
            if (historyFallback) Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Unavailable'); } });
            window.history.replaceState({ app: 'keep' }, '');
            window.fetch = (url, options) => { body = options.body; return new Promise(() => {}); };
        },
    });
    p.api.choose({ marketing: true }).catch(() => {});
    await delay(5);
    assert.equal(p.reloads.length, 1);
    assert.equal(p.api.state().choices.analytics, false);
    assert.equal(p.api.state().choices.marketing, false);
    const session = historyFallback ? [] : Array.from({ length: p.window.sessionStorage.length }, (_, i) => {
        const key = p.window.sessionStorage.key(i);
        return [key, p.window.sessionStorage.getItem(key)];
    });
    const history = plain(p.window.history.state);
    p.dom.window.close();
    return { config, jar: p.jar, body, history, before(window) {
        if (historyFallback) Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Unavailable'); } });
        else for (const [key, value] of session) window.sessionStorage.setItem(key, value);
        window.history.replaceState(history, '');
    } };
}

for (const historyFallback of [false, true]) {
    test(`mixed audit choices survive active withdrawal reload using ${historyFallback ? 'history' : 'session storage'}`, async t => {
        const interrupted = await interruptedMixedAudit(t, historyFallback);
        let acknowledge;
        const requests = [];
        const p = await page(t, {
            config: interrupted.config, jar: interrupted.jar, idle: false,
            html: auditNoticeHtml.replace('signed cached notice', 'new notice') + block('ads', 'marketing', inline('order.push("marketing")')),
            before(window) {
                interrupted.before(window);
                window.fetch = (url, options) => { requests.push(options.body); return new Promise(resolve => { acknowledge = () => resolve(auditReceipt(options)); }); };
            },
        });
        await delay(5);
        assert.deepEqual(requests, [interrupted.body]);
        assert.equal(p.api.allowed('analytics'), false);
        assert.equal(p.api.allowed('marketing'), false);
        assert.deepEqual(plain(p.window.order), []);
        acknowledge(); await p.api.whenIdle();
        assert.equal(p.api.allowed('analytics'), false);
        assert.equal(p.api.allowed('marketing'), true);
        assert.deepEqual(plain(p.window.order), ['marketing']);
        assert.deepEqual(plain(p.window.history.state), { app: 'keep' });
        if (!historyFallback) assert.equal(p.window.sessionStorage.length, 0);
    });
}

test('a failed resumed audit never grants and clears its handoff', async t => {
    const interrupted = await interruptedMixedAudit(t);
    const requests = [];
    const p = await page(t, { config: interrupted.config, jar: interrupted.jar, html: auditNoticeHtml,
        before(window) { interrupted.before(window); window.fetch = async (url, options) => { requests.push(options.body); return auditReceipt(options, 503); }; },
    });
    assert.deepEqual(requests, [interrupted.body, interrupted.body]);
    assert.equal(p.api.allowed('marketing'), false);
    assert.equal(p.window.sessionStorage.length, 0);
    assert.equal(p.errors.filter(error => error.code === 'audit').length, 1);
});

test('a refusal during readiness cancels recovery before its audit request is dispatched', async t => {
    const interrupted = await interruptedMixedAudit(t);
    const requests = [];
    const p = await page(t, { config: interrupted.config, jar: interrupted.jar, html: auditNoticeHtml,
        before(window) {
            interrupted.before(window);
            window.fetch = async (url, options) => { requests.push(JSON.parse(options.body)); return auditReceipt(options); };
            window.document.addEventListener('consent:ready', () => { window.Consent.rejectOptional().catch(() => {}); });
        },
    });
    assert.deepEqual(requests.map(request => request.action), ['reject_optional']);
    assert.equal(p.api.allowed('marketing'), false);
    assert.equal(p.window.sessionStorage.length, 0);
});

for (const withdrawal of [false, true]) {
    test(`a later ${withdrawal ? 'withdrawal' : 'refusal'} supersedes a resumed audit even when its grant receipt arrives last`, async t => {
        const interrupted = await interruptedMixedAudit(t);
        const acknowledgements = [];
        const p = await page(t, { config: interrupted.config, jar: interrupted.jar, idle: false,
            html: auditNoticeHtml + block('ads', 'marketing', inline('order.push("marketing")')),
            before(window) { interrupted.before(window); window.fetch = (url, options) => new Promise(resolve => acknowledgements.push(() => resolve(auditReceipt(options)))); },
        });
        await delay(5);
        const refused = withdrawal ? p.api.forget() : p.api.rejectOptional();
        acknowledgements[1](); acknowledgements[0]();
        await refused; await p.api.whenIdle();
        assert.equal(p.api.allowed('marketing'), false);
        if (withdrawal) assert.equal(p.api.state().decidedAt, null);
        assert.deepEqual(plain(p.window.order), []);
        assert.equal(p.window.sessionStorage.length, 0);
    });
}

test('resumed audit receipts cannot overwrite an external change to the saved refusal', async t => {
    const interrupted = await interruptedMixedAudit(t);
    let acknowledge;
    const p = await page(t, { config: interrupted.config, jar: interrupted.jar, idle: false, html: auditNoticeHtml,
        before(window) { interrupted.before(window); window.fetch = (url, options) => new Promise(resolve => { acknowledge = () => resolve(auditReceipt(options)); }); },
    });
    await delay(5);
    const decidedAt = p.api.state().decidedAt - 1;
    const refusal = decision(interrupted.config, {}, { decidedAt, expiresAt: decidedAt + interrupted.config.retentionDays * 86400 });
    store(p.jar, refusal);
    acknowledge(); await p.api.whenIdle();
    assert.deepEqual(plain(p.api.state()), refusal);
    assert.equal(p.api.allowed('marketing'), false);
});

for (const invalid of ['expired', 'changed policy', 'different choices']) {
    test(`invalid pending audit is discarded without posting or granting: ${invalid}`, async t => {
        const interrupted = await interruptedMixedAudit(t);
        let requests = 0;
        const config = invalid === 'changed policy' ? { ...interrupted.config, policyVersion: 'new-policy' } : interrupted.config;
        const p = await page(t, { config, jar: interrupted.jar, html: auditNoticeHtml,
            before(window) {
                interrupted.before(window);
                const key = Array.from({ length: window.sessionStorage.length }, (_, i) => window.sessionStorage.key(i))
                    .find(key => key.startsWith('consent:audit-pending:'));
                const saved = JSON.parse(window.sessionStorage.getItem(key));
                if (invalid === 'expired') saved.deadline = 0;
                if (invalid === 'different choices') {
                    const body = JSON.parse(saved.body);
                    body.choices.marketing = false;
                    saved.body = JSON.stringify(body);
                }
                window.sessionStorage.setItem(key, JSON.stringify(saved));
                window.fetch = async (url, options) => { requests++; return auditReceipt(options); };
            },
        });
        assert.equal(requests, 0);
        assert.equal(p.api.allowed('marketing'), false);
        assert.equal(p.window.sessionStorage.length, 0);
    });
}

test('a resumed receipt arriving after its handoff deadline cannot grant', async t => {
    const interrupted = await interruptedMixedAudit(t);
    let acknowledge;
    const p = await page(t, { config: interrupted.config, jar: interrupted.jar, idle: false, html: auditNoticeHtml,
        before(window) { interrupted.before(window); window.fetch = (url, options) => new Promise(resolve => { acknowledge = () => resolve(auditReceipt(options)); }); },
    });
    await delay(5);
    const later = p.window.Date.now() + 10000;
    p.window.Date.now = () => later;
    acknowledge(); await p.api.whenIdle();
    assert.equal(p.api.allowed('marketing'), false);
    assert.equal(p.window.sessionStorage.length, 0);
});

test('unavailable handoff storage rejects mixed grants while immediately revoking active code', async t => {
    const config = configuration({ audit: auditConfig });
    let requests = 0;
    const p = await page(t, { config, state: decision(config), html: auditNoticeHtml + block('stats', 'analytics', inline('order.push("stats")')),
        before(window) {
            Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Unavailable'); } });
            window.history.replaceState('app-owned-primitive', '');
            window.fetch = async (url, options) => { requests++; return auditReceipt(options); };
        },
    });
    const saving = p.api.choose({ marketing: true });
    assert.equal(p.api.allowed('analytics'), false);
    await assert.rejects(saving, /remembered across reloads/);
    assert.equal(requests, 1);
    assert.equal(p.api.state().choices.marketing, false);
    assert.equal(p.reloads.length, 1);
    assert.equal(p.window.history.state, 'app-owned-primitive');
});

for (const cooperative of [false, true]) {
    test(`mixed audited choices need no handoff storage with ${cooperative ? 'successful cooperative cleanup' : 'no active scripts'}`, async t => {
        const config = configuration({ audit: auditConfig });
        const p = await page(t, { config, state: decision(config),
            html: auditNoticeHtml + (cooperative ? block('stats', 'analytics', inline('order.push("stats")')) : ''),
            before(window) {
                Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Unavailable'); } });
                window.history.replaceState('app-owned-primitive', '');
                window.fetch = async (url, options) => auditReceipt(options);
            },
        });
        if (cooperative) p.api.onRevoke('analytics', () => {}, { reload: false });
        await p.api.choose({ marketing: true }); await p.api.whenIdle();
        assert.equal(p.api.allowed('analytics'), false);
        assert.equal(p.api.allowed('marketing'), true);
        assert.equal(p.reloads.length, 0);
        assert.equal(p.window.history.state, 'app-owned-primitive');
        assert.deepEqual(p.errors, []);
    });
}

test('missing signed notice blocks grants and does not prevent refusal', async t => {
    const config = configuration({ audit: auditConfig });
    const p = await page(t, { config, state: decision(config) });
    await assert.rejects(p.api.acceptAll(), /signed notice/);
    const refusal = p.api.rejectOptional();
    assert.equal(p.api.allowed('analytics'), false);
    await assert.rejects(refusal, /signed notice/);
});

test('audit does not retry client rejection or an invalid receipt', async t => {
    for (const invalidReceipt of [false, true]) {
        let requests = 0;
        const p = await page(t, { config: { audit: auditConfig }, html: auditNoticeHtml,
            before(window) { window.fetch = async (url, options) => { requests++; return invalidReceipt
                ? { ok: true, status: 201, json: async () => ({ id: 'wrong' }) } : auditReceipt(options, 422); }; },
        });
        await assert.rejects(p.api.acceptAll());
        assert.equal(requests, 1);
        assert.equal(p.api.allowed('analytics'), false);
    }
});

test('oversized audit notices are rejected without a network request or a new grant', async t => {
    let requests = 0;
    const html = `<script type="application/json" data-consent-notice>${JSON.stringify({ payload: 'x'.repeat(62000), signature: 'signature' })}</script>`;
    const p = await page(t, { config: { audit: auditConfig }, html,
        before(window) { window.fetch = async () => { requests++; throw new Error('unexpected request'); }; },
    });
    await assert.rejects(p.api.acceptAll(), /60 KiB/);
    assert.equal(requests, 0);
    assert.equal(p.api.allowed('analytics'), false);
});

const matomoConfig = overrides => ({ url: 'https://stats.example.test/analytics/', siteId: '3', sendPageView: true,
    enableLinkTracking: true, cookiePath: '/', cookieDomain: null, ...overrides });
const matomoFixture = `
window.matomoCommands = _paq.map(args => Array.from(args));
window.matomoOrders = []; window.matomoCart = {};
window.matomoTracker = Object.fromEntries(['requireConsent','setConsentGiven','forgetConsentGiven','deleteCookies',
    'enableLinkTracking','disableLinkTracking','disableHeartBeatTimer','setCustomUrl','setDocumentTitle','setReferrerUrl',
    'trackPageView','trackEvent','trackGoal','trackSiteSearch','trackLink','clearEcommerceCart','addEcommerceItem',
    'trackEcommerceOrder','trackEcommerceCartUpdate'].map(method => [method, function(...args) {
        matomoCommands.push([method, ...args]);
        if (method === 'trackPageView') order.push('matomo-page');
        if (method === 'clearEcommerceCart') matomoCart = {};
        if (method === 'addEcommerceItem') matomoCart[args[0]] = args;
        if (method === 'trackEcommerceOrder' || method === 'trackEcommerceCartUpdate') matomoOrders.push({method, args, items: JSON.parse(JSON.stringify(matomoCart))});
    }]));
window.Matomo = { getAsyncTracker: function(...args) { window.matomoTarget = args; return matomoTracker; } };
window.Piwik = Matomo; window._paq = { push: function(args) { matomoTracker[args[0]](...args.slice(1)); } };
`;
const matomoFiles = { '/analytics/matomo.js': matomoFixture };
const matomoCommands = p => plain(p.window.matomoCommands);
const matomoServices = [{ id: 'matomo', category: 'analytics', cookies: [
    ...['_pk_id', '_pk_ses', '_pk_ref', '_pk_cvar', '_pk_hsr'].map(prefix => ({ prefix: `${prefix}.3.`, name: null, path: '/', domain: null })),
    ...['_pk_testcookie', 'mtm_consent', 'mtm_cookie_consent', 'mtm_consent_removed'].map(name => ({ name, prefix: null, path: '/', domain: null })),
] }];
const matomoCalls = api => [
    api.event('Account', 'Registered'), api.pageView(), api.goal(1), api.search('boots'), api.link('/download.pdf', 'download'),
    api.ecommerceCart({ total: 0, items: [] }), api.ecommerceOrder({ id: 'order-1', total: 9, items: [{ sku: 'sku-1', price: 9 }] }),
];

test('Matomo stays inert for pending, refused, and marketing-only choices with no event replay', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig() } }, files: matomoFiles });
    assert.ok(Object.isFrozen(p.api.matomo));
    assert.deepEqual(p.loader.requests, []);
    assert.deepEqual(await Promise.all(matomoCalls(p.api.matomo)), Array(7).fill(false));
    await p.api.rejectOptional(); await p.api.choose({ marketing: true }); await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, []);
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.equal(matomoCommands(p).filter(args => args[0] === 'trackPageView').length, 1);
    assert.equal(matomoCommands(p).some(args => ['trackEvent', 'trackGoal', 'trackSiteSearch', 'trackLink', 'trackEcommerceOrder', 'trackEcommerceCartUpdate'].includes(args[0])), false);
});

test('Matomo SDK loads once with scoped configuration, nonce, and consent before its initial page view', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig({ cookiePath: '/shop', cookieDomain: '.example.test' }) } },
        files: matomoFiles, html: block('custom', 'analytics', inline('order.push("custom")')) });
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, ['/analytics/matomo.js']);
    const calls = matomoCommands(p);
    assert.deepEqual(calls.slice(0, 7), [['requireConsent'], ['setTrackerUrl', 'https://stats.example.test/analytics/matomo.php'],
        ['setSiteId', '3'], ['setCookiePath', '/shop'], ['forgetConsentGiven'], ['setCookieDomain', '.example.test'], ['setSecureCookie', true]]);
    assert.ok(calls.findIndex(args => args[0] === 'setConsentGiven') < calls.findIndex(args => args[0] === 'trackPageView'));
    assert.deepEqual(plain(p.window.matomoTarget), ['https://stats.example.test/analytics/matomo.php', '3']);
    assert.deepEqual(plain(p.window.order), ['matomo-page', 'custom']);
    assert.equal(p.window.document.querySelector('script[src$="matomo.js"]').nonce, 'fixture-nonce');
    await p.api.acceptAll(); await p.api.whenIdle();
    p.window.document.body.insertAdjacentHTML('beforeend', block('later', 'analytics', inline('order.push("later")')));
    await delay(10); await p.api.whenIdle();
    assert.equal(p.loader.requests.length, 1);
    assert.equal(matomoCommands(p).filter(args => args[0] === 'trackPageView').length, 1);
});

test('a restored Matomo grant initializes and disabled automatic tracking leaves measurements to the application', async t => {
    const config = configuration({ trackers: { matomo: matomoConfig({ sendPageView: false, enableLinkTracking: false }) } });
    const p = await page(t, { config, state: decision(config), files: matomoFiles });
    assert.equal(matomoCommands(p).some(args => ['trackPageView', 'enableLinkTracking'].includes(args[0])), false);
    assert.equal(await p.api.matomo.pageView({ url: '/pricing', title: 'Pricing' }), true);
    assert.deepEqual(matomoCommands(p).slice(-4), [['setCustomUrl', 'https://example.test/pricing'], ['setDocumentTitle', 'Pricing'], ['setReferrerUrl', ''], ['trackPageView']]);
});

test('Matomo events, goals, search, links, and SPA page views use the current tracker with analytics permission', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig() } }, files: matomoFiles });
    await p.api.choose({ analytics: true });
    assert.equal(await p.api.matomo.event('Marketing', 'Clicked', 'Pricing CTA', 0), true);
    assert.deepEqual(matomoCommands(p).at(-1), ['trackEvent', 'Marketing', 'Clicked', 'Pricing CTA', 0]);
    assert.equal(await p.api.matomo.goal(7, 12.5), true);
    assert.deepEqual(matomoCommands(p).at(-1), ['trackGoal', 7, 12.5]);
    assert.equal(await p.api.matomo.search('buty', 'Sklep', 0), true);
    assert.deepEqual(matomoCommands(p).at(-1), ['trackSiteSearch', 'buty', 'Sklep', 0]);
    assert.equal(await p.api.matomo.link('/file.pdf', 'download'), true);
    assert.deepEqual(matomoCommands(p).at(-1), ['trackLink', 'https://example.test/file.pdf', 'download']);
    assert.equal(await p.api.matomo.pageView({ url: '/pricing', title: 'Cennik' }), true);
    assert.deepEqual(matomoCommands(p).slice(-4), [['setCustomUrl', 'https://example.test/pricing'], ['setDocumentTitle', 'Cennik'], ['setReferrerUrl', url], ['trackPageView']]);
    assert.equal(await p.api.matomo.pageView({ url: '/signup', title: 'Signup' }), true);
    assert.deepEqual(matomoCommands(p).slice(-4), [['setCustomUrl', 'https://example.test/signup'], ['setDocumentTitle', 'Signup'], ['setReferrerUrl', 'https://example.test/pricing'], ['trackPageView']]);
});

test('Matomo captures payloads at invocation and serializes complete ecommerce operations without product leakage', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig({ sendPageView: false }) } }, files: matomoFiles });
    await p.api.choose({ analytics: true });
    const data = { id: 'order-42', total: 23, subtotal: 20, tax: 1, shipping: 2, discount: 0,
        items: [{ sku: 'sku-1', name: 'Boots', category: ['Shoes', 'Winter'], price: 10, quantity: 2 }] };
    const order = p.api.matomo.ecommerceOrder(data);
    data.id = 'mutated'; data.items[0].sku = 'other'; data.items[0].category.push('mutated');
    const cart = p.api.matomo.ecommerceCart({ total: 0, items: [] });
    assert.equal(await order, true); assert.equal(await cart, true);
    assert.deepEqual(plain(p.window.matomoOrders), [
        { method: 'trackEcommerceOrder', args: ['order-42', 23, 20, 1, 2, 0], items: { 'sku-1': ['sku-1', 'Boots', ['Shoes', 'Winter'], 10, 2] } },
        { method: 'trackEcommerceCartUpdate', args: [0], items: {} },
    ]);
    assert.deepEqual(plain(p.window.matomoCart), {});
    const view = { url: '/original', title: 'Original' };
    const result = p.api.matomo.pageView(view); view.url = '/mutated'; view.title = 'Mutated';
    assert.equal(await result, true);
    assert.deepEqual(matomoCommands(p).slice(-4).slice(0, 2), [['setCustomUrl', 'https://example.test/original'], ['setDocumentTitle', 'Original']]);
});

test('denied Matomo events behind queued acceptance remain denied', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig({ sendPageView: false }) } }, files: matomoFiles });
    const grant = p.api.acceptAll();
    const results = Promise.all(matomoCalls(p.api.matomo));
    await grant;
    assert.deepEqual(await results, Array(7).fill(false));
    await p.api.whenIdle();
    assert.equal(matomoCommands(p).some(args => args[0].startsWith('track')), false);
});

test('Matomo withdrawal denies synchronously before listeners, cleans scoped cookies, and forces a fresh document', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig() }, services: matomoServices }, files: matomoFiles });
    await p.api.acceptAll(); await p.api.whenIdle();
    for (const name of ['_pk_id.3.hash', '_pk_ses.3.hash', 'mtm_consent_removed', '_pk_id.4.hash', 'app_session', 'XSRF-TOKEN']) p.window.document.cookie = `${name}=keep; Path=/`;
    p.api.onRevoke('analytics', () => {}, { reload: false });
    let observed;
    p.api.onChange(() => { observed = matomoCommands(p).slice(-4); });
    await p.api.choose({ marketing: true }); await p.api.whenIdle();
    assert.deepEqual(observed, [['forgetConsentGiven'], ['disableLinkTracking'], ['disableHeartBeatTimer'], ['deleteCookies']]);
    assert.equal(p.reloads.length, 1);
    assert.equal(p.api.state().choices.analytics, false);
    assert.equal(p.api.state().choices.marketing, true);
    assert.equal(await p.api.matomo.event('Account', 'Login'), false);
    assert.equal(p.window.document.cookie.includes('_pk_id.3.hash'), false);
    assert.equal(p.window.document.cookie.includes('_pk_ses.3.hash'), false);
    assert.equal(p.window.document.cookie.includes('mtm_consent_removed'), false);
    for (const name of ['_pk_id.4.hash', 'app_session', 'XSRF-TOKEN']) assert.ok(p.window.document.cookie.includes(`${name}=`));
});

for (const transition of ['expiry', 'external', 'forget']) {
    test(`Matomo ${transition} invalidation sends denial and reloads`, async t => {
        const p = await page(t, { config: { trackers: { matomo: matomoConfig() } }, files: matomoFiles });
        await p.api.acceptAll(); await p.api.whenIdle();
        if (transition === 'forget') await p.api.forget();
        else {
            const value = transition === 'expiry' ? decision(p.config, { analytics: true }, { decidedAt: 1, expiresAt: 2 }) : decision(p.config, {});
            store(p.jar, value); await p.api.refresh();
        }
        await p.api.whenIdle();
        assert.equal(p.api.allowed('analytics'), false);
        assert.ok(matomoCommands(p).some(args => args[0] === 'forgetConsentGiven'));
        assert.equal(matomoCommands(p).at(-1)[0], 'deleteCookies');
        assert.equal(p.reloads.length, 1);
    });
}

test('Matomo events never delay withdrawal during an in-flight SDK load', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig() }, scriptTimeoutMs: 300 },
        files: { '/analytics/matomo.js': { body: matomoFixture, delay: 150 } } });
    await p.api.choose({ analytics: true });
    const event = p.api.matomo.event('Account', 'Created');
    for (let attempt = 0; p.loader.requests.length === 0 && attempt < 100; attempt++) await delay(1);
    const refused = await Promise.race([p.api.rejectOptional(), delay(80).then(() => null)]);
    assert.ok(refused, 'withdrawal must not wait for the tracker event queue');
    assert.equal(await event, false); await p.api.whenIdle();
    assert.equal(p.reloads.length, 1);
    assert.equal(p.window.matomoCommands, undefined);
});

test('Matomo command sequences recheck consent before measuring and clear abandoned ecommerce products', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig({ sendPageView: false }) } }, files: matomoFiles });
    await p.api.acceptAll(); await p.api.whenIdle();
    const original = p.window.matomoTracker.addEcommerceItem;
    p.window.matomoTracker.addEcommerceItem = (...args) => {
        original(...args); p.window.document.cookie = `consent_preferences=${encodeURIComponent(JSON.stringify(decision(p.config, {})))}; Path=/`;
    };
    assert.equal(await p.api.matomo.ecommerceOrder({ id: 'order-race', total: 1, items: [{ sku: 'sku-race', price: 1 }] }), false);
    await p.api.whenIdle();
    assert.deepEqual(plain(p.window.matomoOrders), []);
    assert.deepEqual(plain(p.window.matomoCart), {});
    assert.equal(p.reloads.length, 1);
});

test('Matomo failures are isolated from other trackers and custom blocks and never retry', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig(), clarity: trackerConfig().clarity } },
        files: { ...trackerFiles, '/analytics/matomo.js': new Error('offline') }, html: block('custom', 'analytics', inline('order.push("custom")')) });
    await p.api.acceptAll(); await p.api.whenIdle();
    assert.equal(await p.api.matomo.event('Checkout', 'Started'), false);
    assert.equal(await p.api.clarity.event('checkout'), true);
    assert.ok(p.window.order.includes('custom'));
    assert.equal(p.errors.filter(error => error.code === 'matomo').length, 1);
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.equal(p.loader.requests.filter(path => path === '/analytics/matomo.js').length, 1);
});

test('a missing Matomo SDK API cannot count as successful initialization', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig() } }, files: { '/analytics/matomo.js': 'window.invalidMatomo = true;' } });
    await p.api.acceptAll(); await p.api.whenIdle();
    assert.equal(await p.api.matomo.event('Account', 'Registered'), false);
    assert.ok(p.errors.some(error => error.code === 'matomo'));
});

test('Matomo consent command errors preserve denial and demand reload', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig() } }, files: matomoFiles });
    await p.api.acceptAll(); await p.api.whenIdle();
    p.window.matomoTracker.forgetConsentGiven = () => { throw new Error('provider failure'); };
    await p.api.rejectOptional(); await p.api.whenIdle();
    assert.equal(p.api.state().choices.analytics, false);
    assert.equal(p.reloads.length, 1);
    assert.ok(p.errors.some(error => error.code === 'matomo'));
});

test('Matomo timeouts halt activation and follow shared reload recovery', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig() }, scriptTimeoutMs: 20 },
        files: { '/analytics/matomo.js': 'hang' }, html: block('custom', 'analytics', inline('order.push("custom")')) });
    await p.api.acceptAll(); await p.api.whenIdle();
    assert.deepEqual(p.reloads, [{ reason: 'script-timeout' }]);
    assert.equal(await p.api.matomo.pageView(), false);
    assert.deepEqual(plain(p.window.order), []);
});

test('Matomo stays strictly gated even when Google Advanced loads before permission', async t => {
    const p = await page(t, { config: { google: googleConfig('advanced'), trackers: { matomo: matomoConfig() } }, files: { ...googleFiles, ...matomoFiles } });
    assert.deepEqual(p.loader.requests, ['/gtag/js']);
    assert.equal(await p.api.matomo.event('Account', 'Login'), false);
    await p.api.choose({ marketing: true }); await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, ['/gtag/js']);
});

for (const global of ['_paq', 'Matomo', 'Piwik']) {
    test(`Matomo refuses an existing ${global} installation before optional activation`, async t => {
        const p = await page(t, { config: { trackers: { matomo: matomoConfig() } }, before: window => { window[global] = {}; } });
        assert.equal(p.api, undefined);
        assert.deepEqual(p.loader.requests, []);
        assert.ok(p.errors.some(error => error.code === 'configuration'));
    });
}

test('duplicate Matomo scripts and malformed browser settings fail closed', async t => {
    for (const source of ['https://stats.example.test/analytics/matomo.js', 'https://stats.example.test/piwik.js']) {
        const p = await page(t, { config: { trackers: { matomo: matomoConfig() } }, head: `<script type="application/json" src="${source}"></script>` });
        assert.equal(p.api, undefined); assert.deepEqual(p.loader.requests, []);
    }
    for (const settings of [null, matomoConfig({ url: 'javascript:alert(1)' }), matomoConfig({ url: 'https://user:secret@stats.example.test/' }),
        matomoConfig({ url: 'https://stats.example.test/?token=1' }), matomoConfig({ url: 'https://stats.example.test/../' }),
        matomoConfig({ siteId: 3 }), matomoConfig({ siteId: '0' }), matomoConfig({ cookiePath: '/; Secure' }),
        matomoConfig({ sendPageView: 1 }), matomoConfig({ cookieDomain: 'https://example.test' })]) {
        const p = await page(t, { config: { trackers: { matomo: settings } } });
        assert.equal(p.api, undefined); assert.deepEqual(p.loader.requests, []);
    }
});

test('invalid Matomo inputs reject without queuing any provider commands', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig() } }, files: matomoFiles });
    const calls = [
        () => p.api.matomo.event('', 'Clicked'), () => p.api.matomo.event('A', 'B', 'C', Infinity),
        () => p.api.matomo.event('A', 'B', null), () => p.api.matomo.goal('1'), () => p.api.matomo.goal(0),
        () => p.api.matomo.search('boots', undefined, -1), () => p.api.matomo.search('boots', undefined, 1.5),
        () => p.api.matomo.pageView({ url: 'javascript:alert(1)' }), () => p.api.matomo.pageView({ title: '' }),
        () => p.api.matomo.pageView({ url: null }),
        () => p.api.matomo.pageView({ identify: 'user-1' }), () => p.api.matomo.link('/file', 'other'),
        () => p.api.matomo.ecommerceOrder({ id: 'order', total: -1, items: [] }),
        () => p.api.matomo.ecommerceOrder({ id: 'order', total: 1, items: [{ sku: 'a', quantity: 0 }] }),
        () => p.api.matomo.ecommerceOrder({ id: 'order', total: 1, items: [{ sku: 'a', quantity: null }] }),
        () => p.api.matomo.ecommerceCart({ total: 1, items: [{ sku: 'a' }, { sku: 'a' }] }),
        () => p.api.matomo.ecommerceCart({ total: 1, items: [{ sku: 'a', category: Array(6).fill('cat') }] }),
        () => p.api.matomo.ecommerceCart({ total: 1, items: Array(201).fill({ sku: 'a' }) }),
    ];
    for (const call of calls) await assert.rejects(call(), error => error.name === 'TypeError');
    assert.deepEqual(p.loader.requests, []);
    const disabled = await page(t);
    await assert.rejects(disabled.api.matomo.event('Account', 'Login'), /not enabled/);
});

test('failed preference storage does not load Matomo or signal consent', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig() } }, files: matomoFiles, before: window => {
        const original = Object.getOwnPropertyDescriptor(window.Document.prototype, 'cookie');
        Object.defineProperty(window.document, 'cookie', { get: () => original.get.call(window.document), set: () => {} });
    } });
    await assert.rejects(p.api.acceptAll(), /could not be stored/); await p.api.whenIdle();
    assert.equal(p.api.allowed('analytics'), false);
    assert.deepEqual(p.loader.requests, []);
    assert.equal(await p.api.matomo.event('Account', 'Login'), false);
});

test('real PHP Matomo configuration and consent restore correctly in the browser', async t => {
    const bridge = phpBridge({ presets: { matomo: { enabled: true, url: 'https://stats.example.test/analytics', site_id: 3 } } });
    const p = await page(t, { config: bridge.config, state: bridge.decision, files: matomoFiles });
    assert.equal(p.api.allowed('analytics'), true);
    assert.equal(await p.api.matomo.goal(1), true);
    assert.equal(matomoCommands(p).filter(args => args[0] === 'trackPageView').length, 1);
    assert.deepEqual(plain(p.window.matomoTarget), ['https://stats.example.test/analytics/matomo.php', '3']);
});

for (const method of ['setConsentGiven', 'enableLinkTracking']) {
    test(`Matomo rechecks a changed decision after ${method} before any initial measurement`, async t => {
        const denied = `window.document.cookie = 'consent_preferences=${encodeURIComponent(JSON.stringify(decision(configuration(), {})))}; Path=/';`;
        const fixture = matomoFixture + `const original = matomoTracker.${method}; matomoTracker.${method} = (...args) => { original(...args); ${denied} };`;
        const p = await page(t, { config: { trackers: { matomo: matomoConfig() } }, files: { '/analytics/matomo.js': fixture } });
        await p.api.acceptAll(); await p.api.whenIdle();
        assert.equal(matomoCommands(p).some(args => args[0] === 'trackPageView'), false);
        assert.equal(p.api.allowed('analytics'), false);
        assert.equal(p.reloads.length, 1);
    });
}

test('Matomo page views stop before their measurement if permission changes mid-operation', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig({ sendPageView: false }) } }, files: matomoFiles });
    await p.api.acceptAll(); await p.api.whenIdle();
    const original = p.window.matomoTracker.setDocumentTitle;
    p.window.matomoTracker.setDocumentTitle = (...args) => {
        original(...args); store(p.jar, decision(p.config, {}));
    };
    assert.equal(await p.api.matomo.pageView({ url: '/checkout', title: 'Checkout' }), false);
    await p.api.whenIdle();
    assert.equal(matomoCommands(p).some(args => args[0] === 'trackPageView'), false);
    assert.equal(p.reloads.length, 1);
});

test('Matomo commerce command failures clear products and leave the event queue usable', async t => {
    const p = await page(t, { config: { trackers: { matomo: matomoConfig({ sendPageView: false }) } }, files: matomoFiles });
    await p.api.acceptAll(); await p.api.whenIdle();
    p.window.matomoTracker.trackEcommerceOrder = () => { throw new Error('rejected by provider'); };
    await assert.rejects(p.api.matomo.ecommerceOrder({ id: 'failed', total: 9, items: [{ sku: 'failed-sku' }] }), /rejected by provider/);
    assert.deepEqual(plain(p.window.matomoCart), {});
    assert.equal(await p.api.matomo.ecommerceCart({ total: 0, items: [] }), true);
    assert.deepEqual(plain(p.window.matomoOrders[0].items), {});
    assert.equal(await p.api.matomo.event('Account', 'Login'), true);
});

test('Matomo preserves preset ordering alongside Google, Meta, Clarity, and custom blocks', async t => {
    const p = await page(t, { config: { google: googleConfig(), trackers: { ...trackerConfig(), matomo: matomoConfig() } },
        files: { ...googleFiles, ...trackerFiles, ...matomoFiles }, html: block('custom', 'analytics', inline('order.push("custom")')) });
    await p.api.acceptAll(); await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, ['/gtag/js', '/en_US/fbevents.js', '/tag/abc123def4', '/analytics/matomo.js']);
    assert.deepEqual(plain(p.window.order), ['matomo-page', 'custom']);
    assert.equal(await p.api.google.event('G-ABCD1234', 'login'), true);
    assert.equal(await p.api.meta.track('Lead'), true);
    assert.equal(await p.api.clarity.event('login'), true);
    assert.equal(await p.api.matomo.event('Account', 'Login'), true);
});

const tiktokConfig = overrides => ({ id: 'C1234567890ABCDEFGHI', sendPageView: true, ...overrides });
const tiktokFixture = `
window.tiktokCommands = ttq.map(args => Array.from(args));
window.tiktokTarget = { ids: Object.keys(ttq._i), options: ttq._o, urls: Object.values(ttq._i).map(queue => queue._u) };
window.tiktokInstance = { page() {}, track() {} };
window.ttq = Object.fromEntries(['page','track','identify','holdConsent','revokeConsent','grantConsent'].map(method => [method, (...args) => {
    tiktokCommands.push([method,...args]); if (method === 'page') order.push('tiktok-page');
}]));
ttq.instance = id => id === 'C1234567890ABCDEFGHI' ? tiktokInstance : null;
ttq.instances = () => [tiktokInstance];
`;
const tiktokFiles = { '/i18n/pixel/events.js': tiktokFixture };
const tiktokCommands = p => plain(p.window.tiktokCommands);
const tiktokCalls = api => [api.track('Purchase', { value: 10, currency: 'PLN' }), api.trackCustom('Login'), api.pageView(), api.identify({ external_id: 'a'.repeat(64) })];
const tiktokServices = [{ id: 'tiktok-pixel', category: 'marketing', cookies: [
    ...['_ttp', 'ttclid', 'ttcsid', '_tt_enable_cookie'].map(name => ({ name, prefix: null, path: '/', domain: null })),
    { name: null, prefix: 'ttcsid_', path: '/', domain: null },
] }];

test('TikTok remains inert when pending, refused, or granted only analytics and never replays denied measurements', async t => {
    const p = await page(t, { config: { trackers: { tiktok: tiktokConfig() } }, files: tiktokFiles });
    assert(Object.isFrozen(p.api.tiktok)); assert.deepEqual(p.loader.requests, []);
    assert.deepEqual(await Promise.all(tiktokCalls(p.api.tiktok)), Array(4).fill(false));
    await p.api.rejectOptional(); await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(p.loader.requests, []);
    await p.api.choose({ marketing: true }); await p.api.whenIdle();
    assert.equal(tiktokCommands(p).filter(args => args[0] === 'page').length, 1);
    assert.equal(tiktokCommands(p).some(args => ['track', 'identify'].includes(args[0])), false);
});

test('TikTok owns one scoped pixel and initializes once before custom scripts with the inherited nonce', async t => {
    const p = await page(t, { config: { trackers: { tiktok: tiktokConfig() } }, files: tiktokFiles,
        html: block('custom', 'marketing', inline('order.push("custom")')) });
    await p.api.acceptAll(); await p.api.whenIdle();
    assert.deepEqual(tiktokCommands(p).slice(0, 2), [['holdConsent'], ['revokeConsent']]);
    const commands = tiktokCommands(p);
    assert(commands.findIndex(args => args[0] === 'grantConsent') < commands.findIndex(args => args[0] === 'page'));
    assert.deepEqual(plain(p.window.tiktokTarget), { ids: ['C1234567890ABCDEFGHI'], options: { C1234567890ABCDEFGHI: {} }, urls: ['https://analytics.tiktok.com/i18n/pixel/events.js'] });
    const script = p.window.document.querySelector('script[src*="analytics.tiktok.com"]');
    assert.equal(script.nonce, 'fixture-nonce'); assert.equal(new URL(script.src).searchParams.get('sdkid'), 'C1234567890ABCDEFGHI');
    assert.deepEqual(plain(p.window.order), ['tiktok-page', 'custom']);
    await p.api.acceptAll(); p.window.document.body.insertAdjacentHTML('beforeend', block('later', 'marketing', inline('order.push("later")')));
    await delay(10); await p.api.whenIdle(); assert.equal(p.loader.requests.length, 1);
    assert.equal(tiktokCommands(p).filter(args => args[0] === 'page').length, 1);
});

test('TikTok restored grants load while disabled automatic page views leave tracking to the application', async t => {
    const config = configuration({ trackers: { tiktok: tiktokConfig({ sendPageView: false }) } });
    const p = await page(t, { config, state: decision(config, { marketing: true }), files: tiktokFiles });
    assert.equal(tiktokCommands(p).some(args => args[0] === 'page'), false);
    p.window.history.pushState({}, '', '/checkout');
    assert.equal(await p.api.tiktok.pageView(), true);
    assert.equal(tiktokCommands(p).at(-1)[0], 'page');
});

test('TikTok captures commerce payloads, routes event IDs, and sends custom events and explicit hashed identity in order', async t => {
    const p = await page(t, { config: { trackers: { tiktok: tiktokConfig({ sendPageView: false }) } }, files: tiktokFiles });
    await p.api.choose({ marketing: true });
    const payload = { contents: [{ content_id: 'sku-1', quantity: 2, price: 10 }], value: 20, currency: 'PLN' };
    const options = { eventID: 'order-42' };
    const purchase = p.api.tiktok.track('Purchase', payload, options);
    payload.contents[0].content_id = 'mutated'; options.eventID = 'mutated';
    assert.equal(await purchase, true);
    assert.deepEqual(tiktokCommands(p).at(-1), ['track', 'Purchase', { contents: [{ content_id: 'sku-1', quantity: 2, price: 10 }], value: 20, currency: 'PLN' }, { pixel_code: 'C1234567890ABCDEFGHI', event_id: 'order-42' }]);
    assert.equal(await p.api.tiktok.trackCustom('Login', { method: 'password' }), true);
    assert.deepEqual(tiktokCommands(p).at(-1), ['track', 'Login', { method: 'password' }, { pixel_code: 'C1234567890ABCDEFGHI' }]);
    const identity = { sha256_email: 'a'.repeat(64), sha256_phone_number: 'b'.repeat(64), external_id: 'c'.repeat(64) };
    const identified = p.api.tiktok.identify(identity); identity.external_id = 'd'.repeat(64);
    assert.equal(await identified, true);
    assert.deepEqual(tiktokCommands(p).at(-1), ['identify', { sha256_email: 'a'.repeat(64), sha256_phone_number: 'b'.repeat(64), external_id: 'c'.repeat(64) }]);
    assert.equal(p.api.allowed('analytics'), false);
});

test('TikTok waits for the second SDK script before measurements and custom blocks', async t => {
    const p = await page(t, { config: { trackers: { tiktok: tiktokConfig() } }, files: {
        '/i18n/pixel/events.js': 'const script=document.createElement("script");script.src="/tiktok-main.js";document.head.append(script);',
        '/tiktok-main.js': { body: tiktokFixture, delay: 40 },
    }, html: block('custom', 'marketing', inline('order.push("custom")')) });
    await p.api.acceptAll();
    const event = p.api.tiktok.track('Purchase'); await delay(10);
    assert.equal(p.window.tiktokCommands, undefined); assert.deepEqual(plain(p.window.order), []);
    assert.equal(await event, true); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['tiktok-page', 'custom']);
});

for (const phase of ['bootstrap', 'runtime']) {
    test(`TikTok pending ${phase} loading cannot delay withdrawal or replay an event`, async t => {
        const p = await page(t, { config: { trackers: { tiktok: tiktokConfig() }, scriptTimeoutMs: 300 }, files: {
            '/i18n/pixel/events.js': phase === 'bootstrap' ? { body: tiktokFixture, delay: 150 } : 'window.bootstrapLoaded=true;',
        } });
        await p.api.acceptAll(); const event = p.api.tiktok.track('Purchase');
        for (let i = 0; p.loader.requests.length === 0 && i < 100; i++) await delay(1);
        if (phase === 'runtime') { for (let i = 0; !p.window.bootstrapLoaded && i < 100; i++) await delay(1); }
        const refused = await Promise.race([p.api.rejectOptional(), delay(80).then(() => null)]);
        assert(refused); assert.equal(await event, false); await p.api.whenIdle();
        assert.equal(p.reloads.length, 1); assert.equal(p.window.tiktokCommands, undefined);
    });
}


const tiktokNavigationHead = '<meta data-consent-page content="tiktok-navigation">';
const tiktokBootstrap = 'const sdk = document.createElement("script"); sdk.src = "/tiktok-main.js"; document.head.appendChild(sdk);';

async function pendingTikTokNavigation(t, overrides = {}, bootstrapDelay = 0) {
    const p = await page(t, {
        config: { livewire: { enabled: true, navigation: 'auto', major: 4 }, trackers: { tiktok: tiktokConfig() }, ...overrides },
        head: tiktokNavigationHead,
        files: {
            '/i18n/pixel/events.js': { body: tiktokBootstrap, delay: bootstrapDelay },
            '/tiktok-main.js': `window.finishTikTok = () => { ${tiktokFixture} };`,
        },
    });
    await p.api.choose({ marketing: true });
    return p;
}

async function waitForTikTokStage(p) {
    for (let i = 0; typeof p.window.finishTikTok !== 'function' && i < 100; i++) await delay(2);
    assert.equal(typeof p.window.finishTikTok, 'function');
}

function beginTikTokVisit(p) {
    p.window.document.dispatchEvent(new p.window.CustomEvent('livewire:navigating'));
}

async function finishTikTokVisit(p) {
    p.window.document.dispatchEvent(new p.window.Event('livewire:navigated'));
    await delay(0);
}

for (const readiness of ['before', 'during', 'after']) {
    test(`TikTok readiness ${readiness} navigation preserves one initialization and discards paused events`, async t => {
        const p = await pendingTikTokNavigation(t);
        await waitForTikTokStage(p);
        if (readiness === 'before') { p.window.finishTikTok(); await p.api.whenIdle(); }
        beginTikTokVisit(p);
        const paused = p.api.tiktok.track('Paused');
        if (readiness === 'during') p.window.finishTikTok();
        await delay(30);
        assert.equal(p.api.allowed('marketing'), false);
        assert.equal((p.window.tiktokCommands ?? []).filter(args => args[0] === 'page').length, readiness === 'before' ? 1 : 0);
        await finishTikTokVisit(p);
        if (readiness === 'after') p.window.finishTikTok();
        assert.equal(await paused, false);
        await p.api.whenIdle();
        assert.equal(await p.api.tiktok.track('Purchase'), true);
        assert.equal(p.api.allowed('marketing'), true);
        assert.equal(tiktokCommands(p).filter(args => args[0] === 'page').length, 1);
        assert.deepEqual(tiktokCommands(p).filter(args => args[0] === 'track').map(args => args[1]), ['Purchase']);
        assert.deepEqual(p.loader.requests, ['/i18n/pixel/events.js', '/tiktok-main.js']);
        assert.deepEqual(p.errors, []);
        assert.deepEqual(p.reloads, []);
    });
}

test('TikTok bootstrap completion during navigation still waits for SDK readiness and resumes once', async t => {
    const p = await pendingTikTokNavigation(t, {}, 60);
    for (let i = 0; p.loader.requests.length === 0 && i < 100; i++) await delay(1);
    beginTikTokVisit(p);
    await waitForTikTokStage(p);
    p.window.finishTikTok();
    await delay(30);
    assert.equal(tiktokCommands(p).some(args => args[0] === 'page'), false);
    await finishTikTokVisit(p); await p.api.whenIdle();
    assert.equal(await p.api.tiktok.track('Purchase'), true);
    assert.equal(tiktokCommands(p).filter(args => args[0] === 'page').length, 1);
    assert.deepEqual(p.loader.requests, ['/i18n/pixel/events.js', '/tiktok-main.js']);
    assert.deepEqual(p.errors, []);
});

test('TikTok readiness survives consecutive navigation pauses without duplicate views or queued paused events', async t => {
    const p = await pendingTikTokNavigation(t);
    await waitForTikTokStage(p);
    beginTikTokVisit(p);
    const first = p.api.tiktok.track('FirstPaused');
    await delay(20);
    p.window.document.dispatchEvent(new p.window.Event('livewire:navigated'));
    beginTikTokVisit(p);
    p.window.finishTikTok();
    const second = p.api.tiktok.track('SecondPaused');
    await delay(30);
    assert.equal(tiktokCommands(p).some(args => args[0] === 'page'), false);
    await finishTikTokVisit(p); await p.api.whenIdle();
    assert.deepEqual(await Promise.all([first, second]), [false, false]);
    assert.equal(await p.api.tiktok.track('Purchase'), true);
    assert.equal(tiktokCommands(p).filter(args => args[0] === 'page').length, 1);
    assert.deepEqual(p.loader.requests, ['/i18n/pixel/events.js', '/tiktok-main.js']);
    assert.deepEqual(p.errors, []);
});

test('a ready TikTok SDK does not time out solely because navigation is still paused', async t => {
    const p = await pendingTikTokNavigation(t, { scriptTimeoutMs: 200 });
    await waitForTikTokStage(p);
    beginTikTokVisit(p);
    p.window.finishTikTok();
    await delay(250);
    assert.deepEqual(p.reloads, []);
    assert.equal(tiktokCommands(p).some(args => args[0] === 'page'), false);
    await finishTikTokVisit(p); await p.api.whenIdle();
    assert.equal(await p.api.tiktok.track('Purchase'), true);
    assert.equal(tiktokCommands(p).filter(args => args[0] === 'page').length, 1);
    assert.deepEqual(p.errors, []);
});

for (const invalidation of ['refusal', 'forget', 'external', 'expiry', 'context']) {
    test(`TikTok ${invalidation} while navigation is paused cancels readiness and never revives measurements`, async t => {
        const p = await pendingTikTokNavigation(t);
        await waitForTikTokStage(p);
        beginTikTokVisit(p);
        const paused = p.api.tiktok.track('Paused');
        await delay(20);
        if (invalidation === 'refusal') await p.api.rejectOptional();
        else if (invalidation === 'forget') await p.api.forget();
        else if (invalidation === 'external') { store(p.jar, decision(p.config, {})); await p.api.refresh(); }
        else if (invalidation === 'expiry') {
            const expiresAt = p.api.state().expiresAt;
            p.window.Date.now = () => expiresAt * 1000;
            await p.api.refresh();
        } else p.window.document.querySelector('meta[data-consent-page]').content = 'different';
        p.window.finishTikTok();
        await finishTikTokVisit(p); await p.api.whenIdle();
        assert.equal(await paused, false);
        assert.equal(await p.api.tiktok.track('Purchase'), false);
        assert.equal(tiktokCommands(p).some(args => ['page', 'track'].includes(args[0])), false);
        assert.equal(p.reloads.length, 1);
        assert.equal(p.errors.filter(error => error.code === 'tiktok').length, 0);
    });
}


test('a TikTok provider failure during navigation remains isolated without dispatch or repeated loading', async t => {
    const p = await pendingTikTokNavigation(t);
    await waitForTikTokStage(p);
    beginTikTokVisit(p);
    p.window.ttq.instance = () => { throw new Error('SDK unavailable'); };
    await delay(30);
    await finishTikTokVisit(p); await p.api.whenIdle();
    p.window.finishTikTok();
    assert.equal(await p.api.tiktok.track('Purchase'), false);
    p.window.document.body.insertAdjacentHTML('beforeend', block('independent', 'marketing', inline('order.push("independent")')));
    await delay(0); await p.api.whenIdle();
    assert.deepEqual(plain(p.window.order), ['independent']);
    assert.equal(tiktokCommands(p).some(args => ['page', 'track'].includes(args[0])), false);
    assert.equal(p.errors.filter(error => error.code === 'tiktok').length, 1);
    assert.deepEqual(p.loader.requests, ['/i18n/pixel/events.js', '/tiktok-main.js']);
    assert.deepEqual(p.reloads, []);
});

test('an unready TikTok SDK still reaches its bounded deadline during navigation', { timeout: 2000 }, async t => {
    const p = await pendingTikTokNavigation(t, { scriptTimeoutMs: 200 });
    await waitForTikTokStage(p);
    beginTikTokVisit(p);
    await p.api.whenIdle();
    assert.deepEqual(p.reloads, [{ reason: 'script-timeout' }]);
    assert.equal(p.errors.filter(error => error.code === 'tiktok').length, 1);
    p.window.finishTikTok();
    await finishTikTokVisit(p);
    assert.equal(await p.api.tiktok.track('Purchase'), false);
    assert.equal(tiktokCommands(p).some(args => ['page', 'track'].includes(args[0])), false);
});

test('TikTok synchronous withdrawal precedes listeners, cleans cookies, protects audit/session cookies, and forces reload', async t => {
    const p = await page(t, { config: { trackers: { tiktok: tiktokConfig() }, services: tiktokServices,
        protectedCookies: [...configuration().protectedCookies, 'consent_preferences_audit'] }, files: tiktokFiles });
    await p.api.acceptAll(); await p.api.whenIdle();
    for (const name of ['_ttp', 'ttclid', 'ttcsid', '_tt_enable_cookie', 'ttcsid_C1234567890ABCDEFGHI', 'consent_preferences_audit', 'app_session', 'XSRF-TOKEN']) p.window.document.cookie = `${name}=keep; Path=/`;
    p.api.onRevoke('marketing', () => {}, { reload: false });
    let observed; p.api.onChange(() => { observed = tiktokCommands(p).at(-1); });
    await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.deepEqual(observed, ['revokeConsent']); assert.equal(p.reloads.length, 1);
    assert.equal(await p.api.tiktok.track('Purchase'), false);
    for (const name of ['_ttp', 'ttclid', 'ttcsid', '_tt_enable_cookie', 'ttcsid_C1234567890ABCDEFGHI']) assert.equal(p.window.document.cookie.includes(`${name}=`), false);
    for (const name of ['consent_preferences_audit', 'app_session', 'XSRF-TOKEN']) assert(p.window.document.cookie.includes(`${name}=`));
});

for (const transition of ['expiry', 'external', 'forget']) {
    test(`TikTok ${transition} invalidation signals denial and reloads`, async t => {
        const p = await page(t, { config: { trackers: { tiktok: tiktokConfig() } }, files: tiktokFiles });
        await p.api.acceptAll(); await p.api.whenIdle();
        if (transition === 'forget') await p.api.forget();
        else { store(p.jar, transition === 'expiry' ? decision(p.config, { marketing: true }, { decidedAt: 1, expiresAt: 2 }) : decision(p.config, {})); await p.api.refresh(); }
        await p.api.whenIdle(); assert.equal(p.api.allowed('marketing'), false);
        assert.deepEqual(tiktokCommands(p).at(-1), ['revokeConsent']); assert.equal(p.reloads.length, 1);
    });
}

test('TikTok dispatch rechecks consent behind earlier events and queued acceptance never revives denied calls', async t => {
    const p = await page(t, { config: { trackers: { tiktok: tiktokConfig({ sendPageView: false }) } }, files: tiktokFiles });
    const grant = p.api.acceptAll(); const denied = Promise.all(tiktokCalls(p.api.tiktok)); await grant;
    assert.deepEqual(await denied, Array(4).fill(false)); await p.api.whenIdle();
    const original = p.window.ttq.track;
    p.window.ttq.track = (...args) => { original(...args); store(p.jar, decision(p.config, {})); };
    const first = p.api.tiktok.track('AddToCart'); const second = p.api.tiktok.track('Purchase');
    assert.equal(await first, true); assert.equal(await second, false); await p.api.whenIdle();
    assert.equal(tiktokCommands(p).filter(args => args[0] === 'track').length, 1);
});

test('TikTok SDK failures remain isolated and consent signal failures preserve denial', async t => {
    const failed = await page(t, { config: { trackers: { tiktok: tiktokConfig(), matomo: matomoConfig() } },
        files: { ...matomoFiles, '/i18n/pixel/events.js': new Error('offline') }, html: block('custom', 'marketing', inline('order.push("custom")')) });
    await failed.api.acceptAll(); await failed.api.whenIdle(); assert.equal(await failed.api.tiktok.track('Purchase'), false);
    assert.equal(await failed.api.matomo.event('Account', 'Login'), true); assert(failed.window.order.includes('custom'));
    assert.equal(failed.errors.filter(e => e.code === 'tiktok').length, 1);
    const p = await page(t, { config: { trackers: { tiktok: tiktokConfig() } }, files: tiktokFiles });
    await p.api.acceptAll(); await p.api.whenIdle(); p.window.ttq.revokeConsent = () => { throw new Error('signal failed'); };
    await p.api.rejectOptional(); await p.api.whenIdle(); assert.equal(p.api.allowed('marketing'), false); assert.equal(p.reloads.length, 1);
});

for (const phase of ['bootstrap', 'runtime']) {
    test(`TikTok ${phase} timeouts use bounded reload recovery and stop activation`, async t => {
        const p = await page(t, { config: { trackers: { tiktok: tiktokConfig() }, scriptTimeoutMs: 20 },
            files: { '/i18n/pixel/events.js': phase === 'bootstrap' ? 'hang' : 'window.bootstrapLoaded=true;' },
            html: block('custom', 'marketing', inline('order.push("custom")')) });
        await p.api.acceptAll(); await p.api.whenIdle(); assert.deepEqual(p.reloads, [{ reason: 'script-timeout' }]);
        assert.deepEqual(plain(p.window.order), []); assert.equal(await p.api.tiktok.pageView(), false);
        const session = [...Array(p.window.sessionStorage.length)].map((_,i) => [p.window.sessionStorage.key(i), p.window.sessionStorage.getItem(p.window.sessionStorage.key(i))]);
        const next = await page(t, { config: p.config, state: p.api.state(), files: { '/i18n/pixel/events.js': phase === 'bootstrap' ? 'hang' : 'window.bootstrapLoaded=true;' },
            before: window => session.forEach(([key, value]) => window.sessionStorage.setItem(key, value)) });
        assert.deepEqual(next.reloads, [{ reason: 'script-timeout', automatic: false }]);
    });
}

test('TikTok is gated in Google Advanced and preserves ordering alongside all existing presets', async t => {
    const p = await page(t, { config: { google: googleConfig('advanced'), trackers: { ...trackerConfig(), matomo: matomoConfig(), tiktok: tiktokConfig() } },
        files: { ...googleFiles, ...trackerFiles, ...matomoFiles, ...tiktokFiles }, html: block('custom', 'marketing', inline('order.push("custom")')) });
    assert.deepEqual(p.loader.requests, ['/gtag/js']); await p.api.choose({ analytics: true }); await p.api.whenIdle();
    assert.equal(p.loader.requests.includes('/i18n/pixel/events.js'), false);
    await p.api.acceptAll(); await p.api.whenIdle(); assert.deepEqual(p.loader.requests, ['/gtag/js', '/tag/abc123def4', '/analytics/matomo.js', '/en_US/fbevents.js', '/i18n/pixel/events.js']);
    assert.deepEqual(plain(p.window.order), ['matomo-page', 'tiktok-page', 'custom']);
    assert.equal(await p.api.google.event('G-ABCD1234', 'purchase'), true);
    assert.equal(await p.api.meta.track('Purchase'), true); assert.equal(await p.api.clarity.event('checkout'), true);
    assert.equal(await p.api.matomo.goal(1), true); assert.equal(await p.api.tiktok.track('Purchase'), true);
});

for (const global of ['ttq', 'TiktokAnalyticsObject']) {
    test(`TikTok detects an existing ${global} installation before optional activation`, async t => {
        const p = await page(t, { config: { trackers: { tiktok: tiktokConfig() } }, before: window => { window[global] = {}; } });
        assert.equal(p.api, undefined); assert(p.errors.some(e => e.code === 'configuration')); assert.deepEqual(p.loader.requests, []);
    });
}

test('TikTok rejects duplicate scripts, malformed runtime settings, and invalid API payloads', async t => {
    const duplicate = await page(t, { config: { trackers: { tiktok: tiktokConfig() } }, head: '<script type="application/json" src="https://analytics.tiktok.com/i18n/pixel/events.js"></script>' });
    assert.equal(duplicate.api, undefined);
    for (const config of [tiktokConfig({ id: 'bad' }), tiktokConfig({ sendPageView: 'true' }), null]) {
        const p = await page(t, { config: { trackers: { tiktok: config } } }); assert.equal(p.api, undefined);
    }
    const p = await page(t, { config: { trackers: { tiktok: tiktokConfig() } }, files: tiktokFiles });
    const circular = {}; circular.self = circular;
    const invalid = [() => p.api.tiktok.track(''), () => p.api.tiktok.track('9event'), () => p.api.tiktok.track('a'.repeat(51)),
        () => p.api.tiktok.track('Purchase', null), () => p.api.tiktok.track('Purchase', { value: NaN }),
        () => p.api.tiktok.track('Purchase', { value: undefined }), () => p.api.tiktok.track('Purchase', { fn() {} }),
        () => p.api.tiktok.track('Purchase', circular), () => p.api.tiktok.track('Purchase', {}, { eventID: '' }),
        () => p.api.tiktok.track('Purchase', {}, { eventID: 'line\nbreak' }), () => p.api.tiktok.track('Purchase', {}, { pixel_code: 'other' }),
        () => p.api.tiktok.identify({}), () => p.api.tiktok.identify({ email: 'plain@example.test' }),
        () => p.api.tiktok.identify({ external_id: 'not-a-hash' }), () => p.api.tiktok.identify({ sha256_email: 'A'.repeat(64) })];
    for (const call of invalid) await assert.rejects(call(), error => error.name === 'TypeError');
    assert.deepEqual(p.loader.requests, []);
    const disabled = await page(t); await assert.rejects(disabled.api.tiktok.track('Purchase'), /not enabled/);
});

test('TikTok audit grants wait for a durable receipt and failed audits never enable the Pixel', async t => {
    let acknowledge; const requests = [];
    const p = await page(t, { config: { audit: auditConfig, trackers: { tiktok: tiktokConfig() } }, html: auditNoticeHtml, files: tiktokFiles,
        before: window => { window.fetch = (url, options) => { requests.push(JSON.parse(options.body)); return new Promise(resolve => { acknowledge = () => resolve(auditReceipt(options)); }); }; } });
    const grant = p.api.acceptAll(); await delay(1); assert.equal(p.api.allowed('marketing'), false); assert.deepEqual(p.loader.requests, []);
    assert.equal(await p.api.tiktok.track('Purchase'), false); acknowledge(); await grant; await p.api.whenIdle();
    assert.equal(tiktokCommands(p).filter(args => args[0] === 'page').length, 1); assert.equal(requests[0].choices.marketing, true);
    const failure = await page(t, { config: { audit: auditConfig, trackers: { tiktok: tiktokConfig() } }, html: auditNoticeHtml, files: tiktokFiles,
        before: window => { window.fetch = async (url, options) => auditReceipt(options, 503); } });
    await assert.rejects(failure.api.acceptAll(), /503/); assert.equal(failure.api.allowed('marketing'), false); assert.deepEqual(failure.loader.requests, []);
});

test('TikTok audit withdrawal denies immediately while receipts fail and delayed receipts cannot revive it', async t => {
    let stalled = false;
    const p = await page(t, { config: { audit: auditConfig, trackers: { tiktok: tiktokConfig() } }, html: auditNoticeHtml, files: tiktokFiles,
        before: window => { window.fetch = (url, options) => stalled ? new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('deadline')))) : Promise.resolve(auditReceipt(options)); } });
    await p.api.acceptAll(); await p.api.whenIdle(); stalled = true;
    const refused = p.api.rejectOptional(); const rejection = assert.rejects(refused, /deadline/);
    assert.equal(p.api.allowed('marketing'), false); assert.deepEqual(tiktokCommands(p).at(-1), ['revokeConsent']);
    assert.equal(await p.api.tiktok.track('Purchase'), false); await rejection; await p.api.whenIdle(); assert.equal(p.reloads.length, 1);
    const held = [];
    const race = await page(t, { config: { audit: auditConfig, trackers: { tiktok: tiktokConfig() } }, html: auditNoticeHtml, files: tiktokFiles,
        before: window => { window.fetch = (url, options) => new Promise(resolve => held.push(() => resolve(auditReceipt(options)))); } });
    const grant = race.api.acceptAll(); const later = race.api.rejectOptional(); held[1](); held[0]();
    await Promise.all([grant, later]); await race.api.whenIdle(); assert.deepEqual(race.loader.requests, []);
});

test('PHP TikTok configuration and restored marketing permission work in the browser', async t => {
    const bridge = phpBridge({ presets: { tiktok_pixel: { enabled: true, pixel_id: 'C1234567890ABCDEFGHI' } }, choices: { marketing: true } });
    const p = await page(t, { config: bridge.config, state: bridge.decision, files: tiktokFiles });
    assert.equal(p.api.allowed('marketing'), true); assert.equal(await p.api.tiktok.track('Purchase'), true);
    assert.equal(tiktokCommands(p).filter(args => args[0] === 'page').length, 1);
});

test('TikTok rechecks a changed decision after its initialized grant before the first page view', async t => {
    const refusal = `document.cookie = 'consent_preferences=${encodeURIComponent(JSON.stringify(decision(configuration(), {})))}; Path=/';`;
    const fixture = tiktokFixture + `const grant = ttq.grantConsent; ttq.grantConsent = () => { grant(); ${refusal} };`;
    const p = await page(t, { config: { trackers: { tiktok: tiktokConfig() } }, files: { '/i18n/pixel/events.js': fixture } });
    await p.api.acceptAll(); await p.api.whenIdle();
    assert.equal(tiktokCommands(p).some(args => args[0] === 'page'), false);
    assert.equal(p.api.allowed('marketing'), false); assert.equal(p.reloads.length, 1);
});

test('TikTok provider event exceptions reject without poisoning subsequent helpers', async t => {
    const p = await page(t, { config: { trackers: { tiktok: tiktokConfig() } }, files: tiktokFiles });
    await p.api.acceptAll(); await p.api.whenIdle();
    const track = p.window.ttq.track; p.window.ttq.track = () => { throw new Error('provider failure'); };
    await assert.rejects(p.api.tiktok.track('Purchase'), /provider failure/); p.window.ttq.track = track;
    assert.equal(await p.api.tiktok.trackCustom('CheckoutRecovered'), true);
});
