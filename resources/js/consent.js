(() => {
    'use strict';

    const runtimeScript = document.currentScript;
    const configNode = document.querySelector('script[data-consent-config]');
    const knownCategories = ['necessary', 'analytics', 'marketing', 'performance', 'other'];
    const selector = 'template[data-consent-block]';
    const emit = (name, detail) => document.dispatchEvent(new CustomEvent(`consent:${name}`, { detail }));
    const report = (code, error, block = null) => emit('error', {
        code, message: error instanceof Error ? error.message : String(error), block,
    });

    if (window.Consent) {
        if (!window.Consent.__consentForLaravel) report('namespace', new Error('window.Consent is already in use.'));
        return;
    }

    let config;
    try {
        config = JSON.parse(configNode?.textContent ?? 'null');
        if (config?.schemaVersion !== 1 || typeof config.policyVersion !== 'string'
            || typeof config.servicesVersion !== 'string' || !Array.isArray(config.categories)
            || !config.categories.includes('necessary') || config.categories.some(key => !knownCategories.includes(key))
            || !config.cookie?.name || !Number.isInteger(config.retentionDays)
            || config.retentionDays < 1 || config.retentionDays > 365
            || !Array.isArray(config.services) || !Array.isArray(config.protectedCookies)
            || !Number.isInteger(config.scriptTimeoutMs) || config.scriptTimeoutMs < 1
            || !Number.isInteger(config.cleanupTimeoutMs) || config.cleanupTimeoutMs < 1) {
            throw new Error('Invalid consent runtime configuration.');
        }
    } catch (error) {
        report('configuration', error);
        return;
    }

    const now = () => Math.floor(Date.now() / 1000);
    const denied = () => Object.fromEntries(knownCategories.map(key => [key, key === 'necessary']));
    const pending = () => ({
        schemaVersion: 1, policyVersion: config.policyVersion, servicesVersion: config.servicesVersion,
        choices: denied(), decidedAt: null, expiresAt: null,
    });
    const snapshot = state => Object.freeze({ ...state, choices: Object.freeze({ ...state.choices }) });
    const validDecision = state => state?.schemaVersion === 1 && state.policyVersion === config.policyVersion
        && state.servicesVersion === config.servicesVersion && Object.keys(state).length === 6
        && Number.isSafeInteger(state.decidedAt) && state.decidedAt > 0 && state.decidedAt <= now()
        && Number.isSafeInteger(state.expiresAt) && state.expiresAt > now()
        && state.expiresAt - state.decidedAt <= config.retentionDays * 86400
        && state.choices && Object.keys(state.choices).length === knownCategories.length
        && knownCategories.every(key => typeof state.choices[key] === 'boolean'
            && (key !== 'necessary' || state.choices[key])
            && (config.categories.includes(key) || !state.choices[key]));
    const rawCookie = () => {
        const matches = document.cookie.split(';').map(part => part.trim())
            .filter(part => part.startsWith(`${config.cookie.name}=`));
        if (matches.length === 0) return null;
        if (matches.length !== 1) return '!duplicate!';
        try { return decodeURIComponent(matches[0].slice(config.cookie.name.length + 1)); }
        catch { return '!invalid!'; }
    };
    const read = () => {
        try {
            const value = rawCookie();
            if (value === null || new TextEncoder().encode(value).byteLength > 3072) return pending();
            const state = JSON.parse(value);
            // JSON.parse erases the integer/float distinction enforced by PHP's decoder.
            const numbers = value.replace(/"(?:[^"\\]|\\[\s\S])*"/g, '').match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
            if (numbers.length !== 3 || numbers.some(number => !/^[1-9]\d*$/.test(number))) return pending();
            return validDecision(state) ? state : pending();
        } catch { return pending(); }
    };

    const denialScope = JSON.stringify([config.cookie.name, config.cookie.path, config.cookie.domain]);
    const denialKey = `consent:storage-denied:${denialScope}`;
    function rememberedDenial() {
        try { if (sessionStorage.getItem(denialKey) === '1') return true; } catch {}
        try { return history.state?.__consentForLaravelDenied === denialScope; } catch { return false; }
    }
    function rememberDenial() {
        // A failed refusal must not restore an old grant when active scripts require a reload.
        try { sessionStorage.setItem(denialKey, '1'); if (rememberedDenial()) return true; } catch {}
        try {
            const state = history.state;
            if (state !== null && (typeof state !== 'object' || Array.isArray(state))) return false;
            history.replaceState({ ...state, __consentForLaravelDenied: denialScope }, '');
            return rememberedDenial();
        } catch { return false; }
    }
    function clearDenial() {
        try { sessionStorage.removeItem(denialKey); } catch {}
        try {
            if (history.state?.__consentForLaravelDenied === denialScope) {
                const state = { ...history.state };
                delete state.__consentForLaravelDenied;
                history.replaceState(Object.keys(state).length ? state : null, '');
            }
        } catch {}
    }
    let storageFailed = rememberedDenial();
    let current = snapshot(storageFailed ? pending() : read());
    let reloading = false;
    let ready = false;
    let markReady;
    const initialized = new Promise(resolve => { markReady = resolve; });
    let operations = Promise.resolve();
    let cleanupQueue = Promise.resolve();
    let loadQueue = Promise.resolve();
    const records = new Map();
    const sources = new Map();
    const listeners = new Set();
    const revocationHooks = new Map();
    const revoking = new Set();
    const permits = (state, category) => category === 'necessary'
        || (validDecision(state) && config.categories.includes(category) && state.choices[category] === true);
    const canRun = category => !reloading && !revoking.has(category) && permits(current, category);

    function checkCategory(category) {
        if (!knownCategories.includes(category)) throw new TypeError(`Unknown consent category [${category}].`);
    }

    function reload(reason) {
        if (reloading) return;
        reloading = true;
        if (storageFailed && !rememberDenial()) {
            report('storage-denial', new Error('A refusal cannot be remembered across reloads. Leave this document to stop already running code.'));
            emit('reload-required', { reason, automatic: false });
            return;
        }
        emit('reload-required', { reason });
        try { window.location.reload(); }
        catch (error) { report('reload', error); }
    }

    function expireCookie(name, path, domain) {
        let value = `${name}=; Path=${path}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
        if (domain !== null) value += `; Domain=${domain}`;
        if (window.location.protocol === 'https:') value += '; Secure';
        document.cookie = value;
    }

    function cleanCookies(categories) {
        let visible;
        try { visible = document.cookie.split(';').map(part => part.trim().split('=')[0]); }
        catch (error) { report('cookie-cleanup', error); return; }
        for (const service of config.services) {
            if (!categories.includes(service.category) || service.category === 'necessary') continue;
            for (const rule of service.cookies ?? []) {
                for (const name of visible) {
                    if (!name || config.protectedCookies.includes(name) || name.startsWith('remember_')) continue;
                    if ((rule.name !== null && rule.name !== undefined && rule.name === name)
                        || (typeof rule.prefix === 'string' && name.startsWith(rule.prefix))) {
                        try { expireCookie(name, rule.path, rule.domain); }
                        catch (error) { report('cookie-cleanup', error); }
                    }
                }
            }
        }
    }

    function bounded(promise, milliseconds) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Consent cleanup timed out.')), milliseconds);
            Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
        });
    }

    async function revoke(categories, state) {
        let requiresReload = false;
        const tasks = [];
        for (const category of categories) {
            const active = [...records.values()].filter(record => record.category === category && record.started);
            const hooks = [...(revocationHooks.get(category) ?? [])];
            const inFlight = active.some(record => record.cancels.size > 0);
            if (inFlight || (active.length > 0 && (hooks.length === 0 || hooks.some(hook => hook.reload)))) requiresReload = true;
            for (const record of active) {
                for (const cancel of [...record.cancels]) cancel();
                for (const node of record.nodes) node.remove();
            }
            for (const hook of hooks) {
                try {
                    const result = hook.callback(snapshot(state));
                    tasks.push(bounded(result, config.cleanupTimeoutMs).catch(error => {
                        report('cleanup', error);
                        requiresReload = true;
                    }));
                } catch (error) {
                    report('cleanup', error);
                    requiresReload = true;
                }
            }
        }
        cleanCookies(categories);
        // Already running or in-flight code needs a fresh document unless its owner declares cooperative cleanup.
        if (requiresReload) reload('revocation');
        await Promise.all(tasks);
        if (requiresReload) reload('cleanup');
        for (const category of categories) revoking.delete(category);
        if (!reloading) schedule();
    }

    function install(next, source) {
        if (JSON.stringify(next) === JSON.stringify(current)) return;
        const previous = current;
        current = snapshot(next);
        // Previous choices were validated when installed. Expiry must still revoke code that ran earlier.
        const revoked = knownCategories.filter(key => key !== 'necessary' && previous.decidedAt !== null
            && previous.choices[key] && !permits(current, key));
        for (const category of revoked) revoking.add(category);
        if (revoked.length > 0) {
            cleanupQueue = cleanupQueue.then(() => revoke(revoked, next)).catch(error => { report('cleanup', error); reload('cleanup'); });
        }
        emit('change', { current: snapshot(current), previous: snapshot(previous), source });
        for (const listener of listeners) {
            try { Promise.resolve(listener(snapshot(current), snapshot(previous), source)).catch(error => report('listener', error)); }
            catch (error) { report('listener', error); }
        }
        schedule();
    }

    function sync() {
        if (!storageFailed) install(read(), 'refresh');
        return current;
    }

    function write(state) {
        let cookie = `${config.cookie.name}=${encodeURIComponent(JSON.stringify(state))}; Path=${config.cookie.path}`
            + `; Max-Age=${state.expiresAt - now()}; Expires=${new Date(state.expiresAt * 1000).toUTCString()}; SameSite=${config.cookie.sameSite}`;
        if (config.cookie.domain !== null) cookie += `; Domain=${config.cookie.domain}`;
        if (config.cookie.secure ?? window.location.protocol === 'https:') cookie += '; Secure';
        document.cookie = cookie;
        const restored = read();
        if (!validDecision(restored) || JSON.stringify(restored) !== JSON.stringify(state)) throw new Error('Consent preferences could not be stored.');
    }

    function operation(callback) {
        const result = operations.then(callback);
        operations = result.catch(() => {});
        return result;
    }

    function choose(choices) {
        return operation(async () => {
            if (reloading) throw new Error('A consent reload is in progress.');
            if (!choices || Object.prototype.toString.call(choices) !== '[object Object]') throw new TypeError('Consent choices must be an object.');
            const normalized = denied();
            for (const [category, choice] of Object.entries(choices)) {
                checkCategory(category);
                if (typeof choice !== 'boolean' || (category === 'necessary' && !choice)
                    || (!config.categories.includes(category) && choice)) throw new TypeError('Consent choices must be booleans for used categories; necessary cannot be denied.');
                normalized[category] = choice;
            }
            const decidedAt = now();
            const next = { ...pending(), choices: normalized, decidedAt, expiresAt: decidedAt + config.retentionDays * 86400 };
            try { write(next); clearDenial(); storageFailed = false; }
            catch (error) {
                storageFailed = true;
                rememberDenial();
                install(pending(), 'storage-error');
                report('storage', error);
                await cleanupQueue;
                throw error;
            }
            install(next, 'choice');
            await cleanupQueue;
            return snapshot(current);
        });
    }

    function scan() {
        for (const template of document.querySelectorAll(selector)) {
            const id = template.getAttribute('data-consent-block');
            const category = template.getAttribute('data-consent-category');
            const signature = `${category}\n${template.innerHTML}`;
            if (records.has(id)) {
                if (records.get(id).signature !== signature && !template.hasAttribute('data-consent-conflict')) {
                    template.setAttribute('data-consent-conflict', '');
                    report('duplicate', new Error('Consent block IDs must identify identical scripts and categories.'), id);
                }
                continue;
            }
            if (!id || !knownCategories.includes(category)) { report('block', new Error('Invalid consent script block.'), id); continue; }
            records.set(id, { id, category, signature, template, status: 'waiting', started: false, nodes: [], cancels: new Set() });
        }
    }

    async function execute(original, record) {
        sync();
        if (!canRun(record.category)) return false;
        const type = (original.getAttribute('type') ?? '').trim().toLowerCase();
        const executable = ['', 'text/javascript', 'application/javascript', 'module'].includes(type);
        const data = ['application/json', 'application/ld+json'].includes(type);
        if (!executable && !data) throw new Error(`Unsupported consent script type [${type}].`);
        if (original.hasAttribute('nomodule') && 'noModule' in document.createElement('script')) return true;
        if (data && original.hasAttribute('src')) throw new Error('Consent data scripts cannot have a source URL.');
        let url = null;
        let key = null;
        if (original.hasAttribute('src')) {
            if (!original.getAttribute('src')) throw new Error('Consent script source cannot be empty.');
            url = new URL(original.getAttribute('src'), document.baseURI);
            if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Consent script sources must use HTTP or HTTPS.');
            key = JSON.stringify([url.href, type === 'module' ? 'module' : 'classic', original.getAttribute('integrity'), original.getAttribute('crossorigin'), original.getAttribute('referrerpolicy')]);
        }
        if (key !== null && sources.has(key)) { record.started = true; await sources.get(key); return true; }
        const script = document.createElement('script');
        for (const attribute of original.attributes) {
            if (!['async', 'defer', 'nonce', 'src'].includes(attribute.name)) script.setAttribute(attribute.name, attribute.value);
        }
        const nonce = original.nonce || runtimeScript?.nonce;
        if (nonce) script.nonce = nonce;
        script.async = false;
        script.textContent = original.textContent;
        if (url !== null) script.src = url.href;
        // Inline modules do not reliably emit a load event. An epilogue runs after their imports and top-level await.
        const moduleEvent = type === 'module' && url === null
            ? `consent:module-complete:${crypto.getRandomValues(new Uint32Array(4)).join('-')}` : null;
        if (moduleEvent !== null) script.textContent += `\n;document.dispatchEvent(new Event(${JSON.stringify(moduleEvent)}));`;
        record.nodes.push(script);
        if (executable) record.started = true;
        const waits = url !== null || type === 'module';
        const result = new Promise((resolve, reject) => {
            let settled = false;
            let timer = null;
            const settle = error => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                record.cancels.delete(cancel);
                script.removeEventListener('load', loaded);
                script.removeEventListener('error', failed);
                document.removeEventListener('securitypolicyviolation', blocked);
                if (moduleEvent !== null) document.removeEventListener(moduleEvent, loaded);
                if (error) { script.remove(); reject(error); } else resolve(true);
            };
            const loaded = () => settle();
            const failed = () => settle(new Error('Consent script failed to load or was blocked.'));
            const blocked = event => {
                if (event.disposition === 'enforce' && event.effectiveDirective?.startsWith('script-src')
                    && (event.target === script || (!waits && event.blockedURI === 'inline'))) failed();
            };
            const cancel = () => { const error = new Error('Consent was revoked while loading.'); error.name = 'AbortError'; settle(error); };
            document.addEventListener('securitypolicyviolation', blocked);
            if (moduleEvent !== null) document.addEventListener(moduleEvent, loaded, { once: true });
            if (waits) {
                record.cancels.add(cancel);
                script.addEventListener('load', loaded);
                script.addEventListener('error', failed);
                timer = setTimeout(() => { failed(); reload('script-timeout'); }, config.scriptTimeoutMs);
            }
            // Classic inline code executes during insertion. Stop dependent scripts if it throws.
            const inlineError = event => settle(event.error ?? new Error(event.message));
            if (!waits && executable) window.addEventListener('error', inlineError);
            try { (document.head ?? document.documentElement).appendChild(script); }
            catch (error) { settle(error); }
            finally { window.removeEventListener('error', inlineError); }
            if (!waits) timer = setTimeout(() => settle(), 0);
        });
        if (key !== null) sources.set(key, result);
        await result;
        return true;
    }

    async function drain() {
        if (!ready || reloading) return;
        scan();
        for (const record of records.values()) {
            sync();
            if (record.status !== 'waiting' || !canRun(record.category)) continue;
            record.status = 'loading';
            try {
                const children = [...record.template.content.childNodes];
                if (children.some(node => node.nodeType !== 8 && !(node.nodeType === 3 && node.textContent.trim() === '')
                    && !(node.nodeType === 1 && node.tagName === 'SCRIPT'))) throw new Error('Consent blocks support only script elements, whitespace, and comments.');
                for (const original of children.filter(node => node.nodeType === 1)) {
                    if (!await execute(original, record)) break;
                }
                record.status = canRun(record.category) ? 'loaded' : 'stopped';
            } catch (error) {
                record.status = 'failed';
                if (error.name !== 'AbortError') report('script', error, record.id);
            }
        }
    }

    function schedule() {
        if (!ready || reloading) return;
        loadQueue = loadQueue.then(drain).catch(error => report('loader', error));
    }

    const api = {
        __consentForLaravel: true,
        state: () => snapshot(sync()),
        allowed: category => { checkCategory(category); sync(); return category === 'necessary' || canRun(category); },
        choose,
        acceptAll: () => choose(Object.fromEntries(config.categories.map(key => [key, true]))),
        rejectOptional: () => choose({}),
        forget: () => operation(async () => {
            try {
                expireCookie(config.cookie.name, config.cookie.path, config.cookie.domain);
                if (rawCookie() !== null) throw new Error('Consent preferences could not be removed.');
                storageFailed = false;
                clearDenial();
            } catch (error) {
                storageFailed = true;
                rememberDenial();
                install(pending(), 'storage-error');
                report('storage', error);
                await cleanupQueue;
                throw error;
            }
            install(pending(), 'forget');
            await cleanupQueue;
            return snapshot(current);
        }),
        refresh: async () => { sync(); await cleanupQueue; return snapshot(current); },
        onChange: callback => {
            if (typeof callback !== 'function') throw new TypeError('Consent change callback must be a function.');
            listeners.add(callback);
            return () => listeners.delete(callback);
        },
        onRevoke: (category, callback, options = {}) => {
            checkCategory(category);
            if (category === 'necessary' || typeof callback !== 'function' || !options || typeof options !== 'object'
                || (options.reload !== undefined && typeof options.reload !== 'boolean')) throw new TypeError('Invalid consent revocation hook.');
            const hook = { callback, reload: options.reload !== false };
            if (!revocationHooks.has(category)) revocationHooks.set(category, new Set());
            revocationHooks.get(category).add(hook);
            return () => revocationHooks.get(category).delete(hook);
        },
        whenIdle: async () => {
            await initialized;
            let previous;
            do {
                previous = [operations, cleanupQueue, loadQueue];
                await Promise.all(previous);
            } while (previous[0] !== operations || previous[1] !== cleanupQueue || previous[2] !== loadQueue);
            return snapshot(current);
        },
    };
    window.Consent = Object.freeze(api);
    function start() {
        ready = true;
        cleanCookies(knownCategories.filter(key => key !== 'necessary' && !permits(current, key)));
        schedule();
        new MutationObserver(changes => {
            if (changes.some(change => [...change.addedNodes].some(node => node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))))) schedule();
        }).observe(document.documentElement, { childList: true, subtree: true });
        markReady();
        emit('ready', { current: snapshot(current) });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
    setInterval(sync, 1000);
    window.addEventListener('focus', sync);
    window.addEventListener('pageshow', sync);
    document.addEventListener('visibilitychange', sync);
})();
