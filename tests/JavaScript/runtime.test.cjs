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
