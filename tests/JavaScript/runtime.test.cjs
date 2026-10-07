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
