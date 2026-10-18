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

    function validMatomo(settings) {
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)
            || typeof settings.url !== 'string' || settings.url.length > 2048
            || typeof settings.siteId !== 'string' || !/^[1-9][0-9]{0,9}$/.test(settings.siteId) || Number(settings.siteId) > 2147483647
            || typeof settings.sendPageView !== 'boolean' || typeof settings.enableLinkTracking !== 'boolean'
            || typeof settings.cookiePath !== 'string' || !settings.cookiePath.startsWith('/') || /[;\x00-\x20\x7f]/.test(settings.cookiePath)
            || settings.cookieDomain !== null && (typeof settings.cookieDomain !== 'string' || settings.cookieDomain.length > 254
                || !/^\.?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(settings.cookieDomain))) return false;
        try {
            const source = new URL(settings.url);
            return ['http:', 'https:'].includes(source.protocol) && !source.username && !source.password
                && !source.search && !source.hash && source.pathname.endsWith('/') && source.href === settings.url;
        } catch { return false; }
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
        if (config.google != null && (!['basic', 'advanced'].includes(config.google.mode)
            || !Array.isArray(config.google.targets) || config.google.targets.some(target =>
                !config.categories.includes(target.category) || typeof target.sendPageView !== 'boolean'
                || !(target.category === 'analytics' && /^G-[A-Z0-9]{4,32}$/.test(target.id)
                    || target.category === 'marketing' && /^AW-[1-9][0-9]{0,19}$/.test(target.id))))) {
            throw new Error('Invalid Google runtime configuration.');
        }
        if (config.audit != null && (!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(config.audit.path)
            || !Number.isInteger(config.audit.timeoutMs) || config.audit.timeoutMs < 100 || config.audit.timeoutMs > 30000)) {
            throw new Error('Invalid consent audit configuration.');
        }
        const trackers = config.trackers ?? {};
        if (!trackers || typeof trackers !== 'object' || Object.keys(trackers).some(key => !['meta', 'clarity', 'matomo', 'tiktok'].includes(key))
            || Object.hasOwn(trackers, 'meta') && (!trackers.meta || typeof trackers.meta !== 'object' || !/^[1-9][0-9]{0,19}$/.test(trackers.meta.id)
                || typeof trackers.meta.id !== 'string' || typeof trackers.meta.sendPageView !== 'boolean' || !config.categories.includes('marketing'))
            || Object.hasOwn(trackers, 'clarity') && (!trackers.clarity || typeof trackers.clarity !== 'object' || !/^[a-z0-9]{1,32}$/.test(trackers.clarity.id)
                || typeof trackers.clarity.id !== 'string' || typeof trackers.clarity.advertising !== 'boolean'
                || !config.categories.includes('analytics') || trackers.clarity.advertising && !config.categories.includes('marketing'))
            || Object.hasOwn(trackers, 'matomo') && (!validMatomo(trackers.matomo) || !config.categories.includes('analytics'))
            || Object.hasOwn(trackers, 'tiktok') && (!trackers.tiktok || typeof trackers.tiktok !== 'object'
                || typeof trackers.tiktok.id !== 'string' || !/^[A-Z0-9]{20}$/.test(trackers.tiktok.id)
                || typeof trackers.tiktok.sendPageView !== 'boolean' || !config.categories.includes('marketing'))) {
            throw new Error('Invalid tracker runtime configuration.');
        }
        config.trackers = trackers;
        const livewire = config.livewire ?? { enabled: true, navigation: 'auto', major: null };
        if (!livewire || typeof livewire.enabled !== 'boolean' || !['auto', 'reload'].includes(livewire.navigation)
            || livewire.major !== null && !Number.isInteger(livewire.major)) throw new Error('Invalid Livewire consent configuration.');
        config.livewire = livewire;
        if (trackers.meta && (window.fbq !== undefined || window._fbq !== undefined)
            || trackers.clarity && window.clarity !== undefined
            || trackers.matomo && (window._paq !== undefined || window.Matomo !== undefined || window.Piwik !== undefined)
            || trackers.tiktok && (window.ttq !== undefined || window.TiktokAnalyticsObject !== undefined)
            || [...document.scripts].some(script => {
                if (!script.src) return false;
                const source = new URL(script.src, document.baseURI);
                return trackers.meta && source.hostname === 'connect.facebook.net' && source.pathname.endsWith('/fbevents.js')
                    || trackers.clarity && ['www.clarity.ms', 'clarity.ms'].includes(source.hostname) && source.pathname.startsWith('/tag/')
                    || trackers.matomo && /\/(?:matomo|piwik)\.js$/.test(source.pathname)
                    || trackers.tiktok && source.hostname === 'analytics.tiktok.com' && source.pathname.startsWith('/i18n/pixel/');
            })) {
            throw new Error('Place Consent before tracker libraries and remove duplicate tracker bootstraps.');
        }
        if (config.google != null && (window.gtag !== undefined || window.dataLayer !== undefined
            && (!Array.isArray(window.dataLayer) || window.dataLayer.length !== 0)
            || [...document.scripts].some(script => {
                if (!script.src) return false;
                const source = new URL(script.src, document.baseURI);
                return ['www.googletagmanager.com', 'googletagmanager.com'].includes(source.hostname)
                    && ['/gtag/js', '/gtm.js'].includes(source.pathname);
            }))) {
            throw new Error('Place Consent before Google tags and remove duplicate Google bootstraps.');
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
    let pendingAudit = null;
    let recoveringAudit = null;
    let ready = false;
    let markReady;
    const initialized = new Promise(resolve => { markReady = resolve; });
    let operations = Promise.resolve();
    let eventQueue = Promise.resolve();
    let cleanupQueue = Promise.resolve();
    let presetQueue = Promise.resolve();
    let loadQueue = Promise.resolve();
    let navigationQueue = Promise.resolve();
    let navigating = false;
    let navigationId = 0;
    let navigation = null;
    let previousUrl = window.location.href;
    const initialContext = document.querySelector('meta[data-consent-page]')?.content ?? null;
    const records = new Map();
    const templates = new WeakMap();
    const sources = new Map();
    const listeners = new Set();
    const revocationHooks = new Map();
    const revoking = new Set();
    const permits = (state, category) => category === 'necessary'
        || (validDecision(state) && config.categories.includes(category) && state.choices[category] === true);
    const canRun = category => !reloading && !navigating && !revoking.has(category) && permits(current, category);

    function checkCategory(category) {
        if (!knownCategories.includes(category)) throw new TypeError(`Unknown consent category [${category}].`);
    }

    function reload(reason, automatic = true) {
        if (reloading) return;
        reloading = true;
        navigation?.resolve();
        if (storageFailed && !rememberDenial()) {
            report('storage-denial', new Error('A refusal cannot be remembered across reloads. Leave this document to stop already running code.'));
            emit('reload-required', { reason, automatic: false });
            return;
        }
        if (!automatic) {
            emit('reload-required', { reason, automatic: false });
            return;
        }
        if (pendingAudit && !storageFailed) {
            try { rememberAudit(pendingAudit.body, pendingAudit.next, pendingAudit.baseline); }
            catch (error) { pendingAudit.error = error; report('audit', error); }
        }
        emit('reload-required', { reason });
        try { window.location.reload(); }
        catch (error) { report('reload', error); }
    }

    function navigationReload(reason) {
        if (reloading) return false;
        ++auditRevision; // A stale receipt cannot install a grant in a different runtime context.
        let automatic = false;
        try {
            const key = `consent:livewire-reload:${denialScope}:${window.location.href}`;
            if (sessionStorage.getItem(key) !== '1') {
                sessionStorage.setItem(key, '1');
                automatic = sessionStorage.getItem(key) === '1';
            }
        } catch {}
        report('livewire', new Error(reason === 'livewire-locale'
            ? 'The persisted consent interface must be refreshed for the current language.'
            : 'Livewire navigation requires a matching consent layout and runtime context.'));
        reload(reason, automatic);
        return false;
    }

    function checkPage() {
        if (reloading) return false;
        const markers = document.querySelectorAll('meta[data-consent-page]');
        if (markers.length !== 1 || !initialContext || markers[0].content !== initialContext) return navigationReload('livewire-context');
        const container = document.querySelector('[data-consent-container]');
        if (container && container.dataset.consentContext !== initialContext) return navigationReload('livewire-context');
        if (container && container.dataset.consentLocaleFixed !== 'true'
            && container.dataset.consentLocale !== markers[0].dataset.consentLocale) return navigationReload('livewire-locale');
        return true;
    }

    function retainNavigationSafety() {
        if (storageFailed && !rememberDenial()) {
            reload('storage-denial', false);
            return false;
        }
        if (!storageFailed) clearDenial();
        // Livewire 4 pushState drops fields outside state.alpine. Restore only the current recovery.
        if (pendingAudit && !storageFailed) {
            try { rememberAudit(pendingAudit.body, pendingAudit.next, pendingAudit.baseline); }
            catch (error) { pendingAudit.error = error; report('audit', error); }
        } else if (recoveringAudit && !storageFailed) {
            try { storeAudit(recoveringAudit); } catch (error) { report('audit', error); }
        } else if (!pendingAudit) clearSavedAudit();
        return true;
    }

    if (config.livewire.enabled) {
        document.addEventListener('livewire:navigate', event => {
            if (event.defaultPrevented) return;
            const full = config.livewire.navigation === 'reload'
                || Boolean(runtimeScript?.nonce) && config.livewire.major !== 4;
            if (!full && !reloading) return;
            event.preventDefault();
            if (reloading) return;
            let target;
            try { target = new URL(event.detail?.url, window.location.href); } catch { return; }
            if (target.origin !== window.location.origin) return;
            // A history-only refusal cannot be carried to another document by assigning its URL.
            let durableDenial = !storageFailed;
            try { durableDenial ||= sessionStorage.getItem(denialKey) === '1'; } catch {}
            if (!durableDenial) { reload('storage-denial', false); return; }
            window.location.assign(target.href);
        });
        document.addEventListener('livewire:navigating', event => {
            if (reloading) return;
            navigation?.resolve();
            let resolve;
            navigationQueue = new Promise(done => { resolve = done; });
            navigation = { id: ++navigationId, resolve, previousUrl, completed: false };
            navigating = true;
            emit('navigating', { id: navigationId });
            event.detail?.onSwap?.(() => { retainNavigationSafety(); checkPage(); });
        });
        document.addEventListener('livewire:navigated', () => {
            if (!retainNavigationSafety()) return;
            const visit = navigation;
            if (!visit || visit.completed) return; // Initial load and same-document hash visits.
            visit.completed = true;
            const destination = { id: visit.id, url: window.location.href, title: document.title, previousUrl: visit.previousUrl };
            (async () => {
                if (!checkPage()) return;
                sync();
                await cleanupQueue;
                if (navigation !== visit || reloading || !checkPage()) return;
                navigating = false;
                previousUrl = destination.url;
                schedule();
                emit('navigated', destination);
            })().catch(error => { report('livewire', error); navigationReload('livewire-context'); })
                .finally(() => visit.resolve());
        });
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
            const active = [...records.values(), ...googleRecords.values(), ...trackerRecords.values()].filter(record => record.category === category && record.started);
            const hooks = [...(revocationHooks.get(category) ?? [])];
            const inFlight = active.some(record => record.cancels.size > 0);
            if (inFlight || active.some(record => record.googlePreset || record.trackerPreset)
                || (active.length > 0 && (hooks.length === 0 || hooks.some(hook => hook.reload)))) requiresReload = true;
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
        updateGoogle();
        updateTrackers();
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

    function eventOperation(callback) {
        // Pending SDK events cannot hold up persisting a withdrawal.
        const result = eventQueue.then(callback);
        eventQueue = result.catch(() => {});
        return result;
    }

    let auditRevision = 0;
    const auditPendingKey = `consent:audit-pending:${denialScope}`;

    function savedAudit() {
        try {
            const value = sessionStorage.getItem(auditPendingKey);
            if (value !== null) return JSON.parse(value);
        } catch {}
        try {
            const value = history.state?.__consentForLaravelAudit;
            return value?.scope === denialScope ? value : null;
        } catch { return null; }
    }

    function clearSavedAudit(body) {
        if (body === undefined || pendingAudit?.body === body) pendingAudit = null;
        if (body === undefined || recoveringAudit?.body === body) recoveringAudit = null;
        if (body !== undefined && savedAudit()?.body !== body) return;
        try { sessionStorage.removeItem(auditPendingKey); } catch {}
        try {
            if (history.state?.__consentForLaravelAudit?.scope === denialScope) {
                const state = { ...history.state };
                delete state.__consentForLaravelAudit;
                history.replaceState(Object.keys(state).length ? state : null, '');
            }
        } catch {}
    }

    function rememberAudit(body, next, baseline) {
        const value = { scope: denialScope, path: config.audit.path, body, next, baseline,
            deadline: Date.now() + 2 * config.audit.timeoutMs + 5000 };
        storeAudit(value);
    }

    function storeAudit(value) {
        const serialized = JSON.stringify(value);
        try {
            sessionStorage.setItem(auditPendingKey, serialized);
            if (sessionStorage.getItem(auditPendingKey) === serialized) return;
        } catch {}
        try {
            const state = history.state;
            if (state === null || typeof state === 'object' && !Array.isArray(state)) {
                history.replaceState({ ...state, __consentForLaravelAudit: value }, '');
                if (JSON.stringify(savedAudit()) === serialized) return;
            }
        } catch {}
        throw new Error('The pending consent audit cannot be remembered across reloads.');
    }

    async function deliverAudit(body) {
        const endpoint = new URL(config.audit.path, window.location.origin);
        if (endpoint.origin !== window.location.origin) throw new Error('Consent audit must use the same origin.');
        for (let attempt = 0; attempt < 2; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), config.audit.timeoutMs);
            try {
                const response = await window.fetch(endpoint.href, {
                    method: 'POST', credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body, keepalive: true, signal: controller.signal,
                });
                if (!response.ok) {
                    const error = new Error(`Consent audit failed (${response.status}).`);
                    if (response.status < 500 || attempt === 1) throw Object.assign(error, { final: true });
                    continue;
                }
                const receipt = await response.json();
                if (receipt?.id !== JSON.parse(body).id) throw Object.assign(new Error('Invalid consent audit receipt.'), { final: true });
                return;
            } catch (error) {
                if (error?.final || attempt === 1) throw error;
            } finally { clearTimeout(timer); }
        }
    }

    async function auditDecision(action, state, prepared = () => {}) {
        if (!config.audit) return;
        try {
            const roots = document.querySelectorAll('[data-consent-ui]');
            const container = roots.length === 1 ? roots[0].closest('[data-consent-container]') : null;
            if (roots.length > 1) throw new Error('Consent audit requires one active consent interface.');
            const nodes = (container ?? document).querySelectorAll('script[data-consent-notice]');
            if (nodes.length !== 1) throw new Error('Consent audit requires exactly one signed notice from the banner.');
            const notice = JSON.parse(nodes[0].textContent);
            if (typeof notice?.payload !== 'string' || typeof notice.signature !== 'string') throw new Error('Invalid signed consent notice.');
            if (container) {
                const snapshot = JSON.parse(notice.payload);
                if (snapshot.policy_version !== config.policyVersion || snapshot.services_version !== config.servicesVersion
                    || snapshot.retention_days !== config.retentionDays || JSON.stringify(snapshot.categories) !== JSON.stringify(config.categories)
                    || container.dataset.consentContext !== initialContext) throw new Error('The consent notice does not match the active runtime.');
            }
            const body = JSON.stringify({ id: window.crypto.randomUUID(), notice, action, choices: state.choices });
            if (new TextEncoder().encode(body).byteLength > 61440) throw new Error('Consent audit request exceeds 60 KiB.');
            prepared(body);
            await deliverAudit(body);
        } catch (error) {
            report('audit', error);
            throw error;
        }
    }

    function resumeAudit() {
        const saved = savedAudit();
        if (saved === null) return;
        const matches = () => !storageFailed && validDecision(saved.next) && validDecision(saved.baseline)
            && saved.deadline >= Date.now() && JSON.stringify(read()) === JSON.stringify(saved.baseline);
        try {
            if (!config.audit || saved.scope !== denialScope || saved.path !== config.audit.path
                || !Number.isSafeInteger(saved.deadline) || typeof saved.body !== 'string'
                || new TextEncoder().encode(saved.body).byteLength > 61440 || !matches()
                || JSON.stringify(JSON.parse(saved.body).choices) !== JSON.stringify(saved.next.choices)) {
                clearSavedAudit();
                return;
            }
        } catch { clearSavedAudit(); return; }
        const revision = ++auditRevision;
        recoveringAudit = saved;
        const canResume = () => revision === auditRevision && !reloading && savedAudit()?.body === saved.body && matches();
        // Replay the same explicit decision/ID, never a new decision based on a cookie read.
        operation(async () => {
            try {
                if (!canResume()) return;
                await deliverAudit(saved.body);
                sync();
                if (canResume()) persistLocal(saved.next, 'choice');
            } catch (error) { report('audit', error); }
            finally { clearSavedAudit(saved.body); }
        });
    }

    function persistLocal(next, source) {
        try { write(next); clearDenial(); storageFailed = false; }
        catch (error) {
            storageFailed = true;
            rememberDenial();
            install(pending(), 'storage-error');
            report('storage', error);
            throw error;
        }
        install(next, source);
    }

    function choose(choices, action = 'save_preferences') {
        let next, revision, audit, body, recovery;
        try {
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
            next = { ...pending(), choices: normalized, decidedAt, expiresAt: decidedAt + config.retentionDays * 86400 };
            clearSavedAudit();
            revision = ++auditRevision;
            if (config.audit) {
                const reduced = { ...next, choices: Object.fromEntries(knownCategories.map(key =>
                    [key, key === 'necessary' || normalized[key] && permits(current, key)])) };
                const removes = knownCategories.some(key => key !== 'necessary' && current.choices[key] && !normalized[key]);
                const adds = knownCategories.some(key => key !== 'necessary' && normalized[key] && !permits(current, key));
                // Start keepalive delivery before cleanup can trigger a reload.
                audit = auditDecision(action, next, prepared => {
                    body = prepared;
                    if (removes && adds) recovery = pendingAudit = { body, next, baseline: reduced };
                });
                // Observe eager failures even while another operation is awaiting its receipt.
                audit.catch(() => {});
                // New grants wait for a receipt. Removals take effect immediately,
                // including when a previous grant is still waiting on the network.
                if (removes || !knownCategories.some(key => key !== 'necessary' && normalized[key])) persistLocal(reduced, 'choice');
            }
        } catch (error) {
            if (body !== undefined) clearSavedAudit(body);
            return Promise.reject(error);
        }
        return operation(async () => {
            try {
                if (audit) await audit;
                if (config.audit && revision !== auditRevision) return snapshot(current);
                if (recovery?.error) throw recovery.error;
                if (pendingAudit?.body === body) pendingAudit = null;
                persistLocal(next, 'choice');
                await cleanupQueue;
                return snapshot(current);
            } catch (error) {
                await cleanupQueue;
                throw error;
            } finally { if (body !== undefined) clearSavedAudit(body); }
        });
    }

    function forget() {
        let audit;
        clearSavedAudit();
        const revision = ++auditRevision;
        const remove = () => {
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
                throw error;
            }
            install(pending(), 'forget');
        };
        if (config.audit) {
            audit = auditDecision('withdraw', pending());
            audit.catch(() => {});
            try { remove(); } catch (error) { return Promise.reject(error); }
        }
        return operation(async () => {
            try {
                if (audit) await audit;
                else remove();
                if (config.audit && revision !== auditRevision) return snapshot(current);
                await cleanupQueue;
                return snapshot(current);
            } catch (error) {
                await cleanupQueue;
                throw error;
            }
        });
    }

    function validBlock(record) {
        const template = record.template;
        if (template.getAttribute('data-consent-block') === record.id
            && `${template.getAttribute('data-consent-category')}\n${template.innerHTML}` === record.signature) return true;
        record.status = 'failed';
        if (!template.hasAttribute('data-consent-conflict')) {
            template.setAttribute('data-consent-conflict', '');
            report('duplicate', new Error('Consent block IDs must identify identical scripts and categories.'), record.id);
        }
        return false;
    }

    const attachedBlock = record => document.documentElement?.contains(record.template) === true;

    function blockIdentity(template) {
        const copy = template.cloneNode(true);
        for (const script of copy.content?.querySelectorAll('script') ?? []) script.removeAttribute('nonce');
        return `${template.getAttribute('data-consent-category')}\n${copy.innerHTML}`;
    }

    function scan() {
        const ordered = [];
        for (const template of document.querySelectorAll(selector)) {
            const discovered = templates.get(template);
            if (discovered?.template === template && !validBlock(discovered)) continue;
            const id = template.getAttribute('data-consent-block');
            const category = template.getAttribute('data-consent-category');
            const signature = `${category}\n${template.innerHTML}`;
            const identity = blockIdentity(template);
            if (records.has(id)) {
                const record = records.get(id);
                if (record.template === template) validBlock(record);
                else if (!attachedBlock(record) && ['waiting', 'paused'].includes(record.status) && !record.started
                    && template.content?.nodeType === 11 && record.identity === identity && validBlock(record)) {
                    record.template = template;
                    record.signature = signature;
                    record.content = template.content.cloneNode(true);
                    templates.set(template, record);
                }
                if (record.identity !== identity && !template.hasAttribute('data-consent-conflict')) {
                    template.setAttribute('data-consent-conflict', '');
                    report('duplicate', new Error('Consent block IDs must identify identical scripts and categories.'), id);
                }
                if (record.template === template) ordered.push(record);
                continue;
            }
            if (!id || !knownCategories.includes(category) || template.content?.nodeType !== 11) {
                report('block', new Error('Invalid consent script block.'), id);
                continue;
            }
            const record = { id, category, signature, identity, template, content: template.content.cloneNode(true), cursor: 0,
                status: 'waiting', started: false, nodes: [], cancels: new Set() };
            records.set(id, record);
            templates.set(template, record);
            ordered.push(record);
        }
        return ordered;
    }

    async function execute(original, record) {
        sync();
        if (record.template && (!attachedBlock(record) || record.status === 'failed' || !validBlock(record))) return false;
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
        // Module load events can precede top-level await. Completion comes from an evaluated epilogue.
        const moduleEvent = type === 'module'
            ? `consent:module-complete:${crypto.getRandomValues(new Uint32Array(4)).join('-')}` : null;
        if (moduleEvent !== null && url === null) script.textContent += `\n;document.dispatchEvent(new Event(${JSON.stringify(moduleEvent)}));`;
        record.nodes.push(script);
        if (executable) record.started = true;
        const waits = url !== null || type === 'module';
        const retryKey = `consent:script-timeout:${JSON.stringify([denialScope, config.policyVersion, config.servicesVersion,
            record.id, record.template ? [...record.content.children].indexOf(original) : 'preset'])}`;
        const result = new Promise((resolve, reject) => {
            let settled = false;
            let timer = null;
            let moduleMarker = null;
            const settle = error => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                record.cancels.delete(cancel);
                script.removeEventListener('load', loaded);
                script.removeEventListener('error', failed);
                document.removeEventListener('securitypolicyviolation', blocked);
                if (moduleEvent !== null) document.removeEventListener(moduleEvent, completed);
                moduleMarker?.removeEventListener('error', failed);
                if (error) { script.remove(); moduleMarker?.remove(); reject(error); }
                else {
                    try { sessionStorage.removeItem(retryKey); } catch {}
                    resolve(true);
                }
            };
            const completed = () => settle();
            const loaded = () => {
                if (type !== 'module') { settle(); return; }
                if (url === null || moduleMarker !== null) return;
                // The original fetch enforces SRI/credentials. Import its cached module to await evaluation without running it twice.
                moduleMarker = document.createElement('script');
                moduleMarker.type = 'module';
                if (nonce) moduleMarker.nonce = nonce;
                for (const name of ['crossorigin', 'referrerpolicy']) {
                    if (original.hasAttribute(name)) moduleMarker.setAttribute(name, original.getAttribute(name));
                }
                moduleMarker.textContent = `import ${JSON.stringify(url.href)};\ndocument.dispatchEvent(new Event(${JSON.stringify(moduleEvent)}));`;
                moduleMarker.addEventListener('error', failed);
                record.nodes.push(moduleMarker);
                try { (document.head ?? document.documentElement).appendChild(moduleMarker); }
                catch (error) { settle(error); }
            };
            const failed = () => settle(new Error('Consent script failed to load or was blocked.'));
            const blocked = event => {
                if (event.disposition === 'enforce' && event.effectiveDirective?.startsWith('script-src')
                    && (event.target === script || event.target === moduleMarker
                        || ((!waits || moduleMarker !== null) && event.blockedURI === 'inline'))) failed();
            };
            const cancel = () => { const error = new Error('Consent was revoked while loading.'); error.name = 'AbortError'; settle(error); };
            document.addEventListener('securitypolicyviolation', blocked);
            if (moduleEvent !== null) document.addEventListener(moduleEvent, completed, { once: true });
            if (waits) {
                record.cancels.add(cancel);
                script.addEventListener('load', loaded);
                script.addEventListener('error', failed);
                timer = setTimeout(() => {
                    // Remember one retry across documents; repeated failures need manual recovery.
                    let retry = false;
                    try {
                        if (sessionStorage.getItem(retryKey) !== '1') {
                            sessionStorage.setItem(retryKey, '1');
                            retry = sessionStorage.getItem(retryKey) === '1';
                        }
                    } catch {}
                    failed();
                    reload('script-timeout', retry);
                }, config.scriptTimeoutMs);
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
        if (!ready || reloading || navigating) return;
        while (!reloading && !navigating) {
            sync();
            // Async loading can add, move, or remove blocks. Select from the current DOM each time.
            const record = scan().find(record => ['waiting', 'paused'].includes(record.status) && attachedBlock(record)
                && validBlock(record) && canRun(record.category));
            if (!record) break;
            record.status = 'loading';
            try {
                // Private copies cannot retain a mutated node after identical markup replaces the live template.
                const children = [...record.content.childNodes];
                if (children.some(node => node.nodeType !== 8 && !(node.nodeType === 3 && node.textContent.trim() === '')
                    && !(node.nodeType === 1 && node.tagName === 'SCRIPT'))) throw new Error('Consent blocks support only script elements, whitespace, and comments.');
                const scripts = children.filter(node => node.nodeType === 1);
                for (const original of scripts.slice(record.cursor)) {
                    if (navigating) break;
                    if (!await execute(original, record)) break;
                    record.cursor++;
                }
                if (record.status === 'loading') record.status = navigating && attachedBlock(record) && permits(current, record.category)
                    ? 'paused' : attachedBlock(record) && canRun(record.category) && record.cursor === scripts.length ? 'loaded' : 'stopped';
            } catch (error) {
                record.status = 'failed';
                if (error.name !== 'AbortError') report('script', error, record.id);
            }
        }
    }

    function schedulePresets() {
        // Custom modules may await event helpers, so preset readiness must exclude those modules.
        if (!ready || reloading || navigating) return presetQueue;
        presetQueue = presetQueue.then(async () => {
            await drainGoogle();
            await drainTrackers();
        }).catch(error => report('loader', error));
        return presetQueue;
    }

    function schedule() {
        if (!ready || reloading || navigating) return;
        const presets = schedulePresets();
        loadQueue = loadQueue.then(async () => { await presets; await drain(); }).catch(error => report('loader', error));
    }

    const googleRecords = new Map();
    const googleConfigured = new Set();
    let googleLoaded = false;
    let googleFailed = false;
    let googlePrevious = null;
    let googleCommand = null;

    function googleSignals(state) {
        const analytics = permits(state, 'analytics') ? 'granted' : 'denied';
        const marketing = permits(state, 'marketing') ? 'granted' : 'denied';
        return { analytics_storage: analytics, ad_storage: marketing, ad_user_data: marketing, ad_personalization: marketing,
            functionality_storage: 'denied', security_storage: 'granted', personalization_storage: marketing };
    }

    function updateGoogle() {
        if (!googleCommand) return;
        const signals = googleSignals(current);
        for (const target of config.google.targets.filter(target => target.category === 'analytics')) {
            window[`ga-disable-${target.id}`] = config.google.mode === 'basic'
                ? signals.analytics_storage === 'denied'
                : googlePrevious?.analytics_storage === 'granted' && signals.analytics_storage === 'denied'
                    || window[`ga-disable-${target.id}`] === true && signals.analytics_storage === 'denied';
        }
        if (JSON.stringify(signals) !== JSON.stringify(googlePrevious)) {
            try {
                googleCommand('consent', 'update', signals);
            } catch (error) {
                googleFailed = true;
                report('google', error);
            }
            googlePrevious = signals;
        }
    }

    if (config.google != null) {
        const layer = window.dataLayer ?? [];
        window.dataLayer = layer;
        googleCommand = function () { layer.push(arguments); };
        window.gtag = googleCommand;
        googleCommand('consent', 'default', googleSignals(pending()));
        googleCommand('set', 'ads_data_redaction', true);
        googleCommand('set', 'url_passthrough', false);
        updateGoogle();
    }

    async function drainGoogle() {
        if (!googleCommand || googleFailed || reloading || navigating) return;
        sync();
        const advanced = config.google.mode === 'advanced';
        const target = config.google.targets.find(target => advanced || canRun(target.category));
        if (!target) return;
        try {
            if (!googleLoaded) {
                const record = { id: 'google-tag', category: advanced ? 'necessary' : target.category,
                    started: false, nodes: [], cancels: new Set(), googlePreset: true };
                googleRecords.set(record.id, record);
                const script = document.createElement('script');
                script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(target.id)}`;
                googleCommand('js', new Date());
                if (!await execute(script, record)) return;
                googleLoaded = true;
            }
            for (const target of config.google.targets) {
                sync();
                if (reloading || navigating || googleConfigured.has(target.id) || !advanced && !canRun(target.category)) continue;
                googleCommand('config', target.id, target.category === 'analytics'
                    ? { send_page_view: target.sendPageView, allow_google_signals: false, allow_ad_personalization_signals: false }
                    : { allow_ad_personalization_signals: false });
                googleConfigured.add(target.id);
                googleRecords.set(target.id, { id: target.id, category: target.category,
                    started: true, nodes: [], cancels: new Set(), googlePreset: true });
            }
        } catch (error) {
            googleFailed = true;
            if (error.name !== 'AbortError') report('google', error);
        }
    }

    const googleApi = Object.freeze({
        state: () => { sync(); return Object.freeze(googleSignals(current)); },
        event: (destination, name, parameters = {}) => {
            try {
                if (typeof destination !== 'string' || typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name)
                    || !parameters || Object.prototype.toString.call(parameters) !== '[object Object]'
                    || Object.hasOwn(parameters, 'send_to') || Object.hasOwn(parameters, 'event_callback')) {
                    throw new TypeError('Google events require a destination, event name, and parameters without send_to or event_callback.');
                }
                const target = config.google?.targets.find(target => target.id === destination
                    || target.category === 'marketing' && destination.startsWith(`${target.id}/`)
                        && /^[A-Za-z0-9_-]{1,128}$/.test(destination.slice(target.id.length + 1)));
                if (!target || target.category === 'marketing' && (name !== 'conversion' || destination === target.id)) {
                    throw new TypeError('Unknown Google destination or missing Ads conversion label.');
                }
                const data = JSON.parse(JSON.stringify(parameters));
                sync();
                const permitted = canRun(target.category);
                return eventOperation(async () => {
                    sync();
                    if (!permitted || !canRun(target.category)) return false;
                    await initialized;
                    await schedulePresets();
                    sync();
                    if (!canRun(target.category) || !googleConfigured.has(target.id) || googleFailed) return false;
                    googleCommand('event', name, { ...data, send_to: destination });
                    return true;
                });
            } catch (error) { return Promise.reject(error); }
        },
    });

    const trackerRecords = new Map();
    const trackerLoaded = new Set();
    const trackerFailed = new Set();
    let metaPrevious = null;
    let clarityPrevious = null;
    let tiktokPrevious = null;
    let matomoTracker = null;
    let matomoPrevious = null;
    let matomoLastPageUrl = null;

    function claritySignals() {
        const analytics = permits(current, 'analytics');
        return { analytics_Storage: analytics ? 'granted' : 'denied',
            ad_Storage: analytics && config.trackers.clarity?.advertising && permits(current, 'marketing') ? 'granted' : 'denied' };
    }

    function trackerCommand(preset, ...args) {
        if (preset === 'matomo') {
            const [method, ...parameters] = args;
            if (!matomoTracker || typeof matomoTracker[method] !== 'function') throw new Error(`The Matomo ${method} API is unavailable.`);
            return matomoTracker[method](...parameters);
        }
        if (preset === 'tiktok') {
            const [method, ...parameters] = args;
            if (typeof window.ttq?.[method] !== 'function') throw new Error(`The TikTok ${method} API is unavailable.`);
            return window.ttq[method](...parameters);
        }
        const command = window[preset === 'meta' ? 'fbq' : 'clarity'];
        if (typeof command !== 'function') throw new Error(`The ${preset} browser API is unavailable.`);
        command(...args);
    }

    function updateTrackers() {
        for (const preset of ['meta', 'clarity', 'tiktok']) {
            if (!config.trackers[preset]) continue;
            const signals = preset === 'clarity' ? claritySignals() : permits(current, 'marketing') ? 'grant' : 'revoke';
            const previous = preset === 'meta' ? metaPrevious : preset === 'tiktok' ? tiktokPrevious : clarityPrevious;
            if (JSON.stringify(signals) === JSON.stringify(previous)) continue;
            try {
                if (preset === 'tiktok') trackerCommand(preset, signals === 'grant' ? 'grantConsent' : 'revokeConsent');
                else trackerCommand(preset, preset === 'meta' ? 'consent' : 'consentv2', signals);
                if (preset === 'meta') metaPrevious = signals;
                else if (preset === 'tiktok') tiktokPrevious = signals;
                else {
                    clarityPrevious = signals;
                    if (trackerRecords.get('clarity')?.started && signals.ad_Storage === 'granted') {
                        trackerRecords.set('clarity-ads', { id: 'clarity-ads', category: 'marketing',
                            started: true, nodes: [], cancels: new Set(), trackerPreset: true });
                    }
                }
            } catch (error) {
                trackerFailed.add(preset);
                report(preset, error);
                if (trackerRecords.get(preset)?.started && (preset !== 'clarity' ? signals === 'revoke'
                    : signals.analytics_Storage === 'denied' || signals.ad_Storage === 'denied' && previous?.ad_Storage === 'granted')) {
                    reload('tracker-consent');
                }
            }
        }
        if (matomoTracker) {
            const permitted = permits(current, 'analytics');
            if (permitted === matomoPrevious) return;
            try {
                trackerCommand('matomo', permitted ? 'setConsentGiven' : 'forgetConsentGiven');
                matomoPrevious = permitted;
                if (!permitted) {
                    trackerCommand('matomo', 'disableLinkTracking');
                    trackerCommand('matomo', 'disableHeartBeatTimer');
                    trackerCommand('matomo', 'deleteCookies');
                }
            } catch (error) {
                trackerFailed.add('matomo');
                report('matomo', error);
                if (!permitted && trackerRecords.get('matomo')?.started) reload('tracker-consent');
            }
        }
    }

    if (config.trackers.meta) {
        const fbq = function () { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
        Object.assign(fbq, { push: fbq, loaded: true, version: '2.0', queue: [] });
        window.fbq = window._fbq = fbq;
        trackerCommand('meta', 'consent', 'revoke');
        metaPrevious = 'revoke';
    }
    if (config.trackers.clarity) {
        const clarity = function () { clarity.q.push(arguments); };
        clarity.q = [];
        window.clarity = clarity;
    }
    if (config.trackers.matomo) {
        const settings = config.trackers.matomo;
        window._paq = [
            ['requireConsent'], ['setTrackerUrl', `${settings.url}matomo.php`], ['setSiteId', settings.siteId],
            ['setCookiePath', settings.cookiePath], ['forgetConsentGiven'],
        ];
        if (settings.cookieDomain !== null) window._paq.push(['setCookieDomain', settings.cookieDomain]);
        if (window.location.protocol === 'https:') window._paq.push(['setSecureCookie', true]);
    }
    if (config.trackers.tiktok) {
        const ttq = [];
        window.TiktokAnalyticsObject = 'ttq';
        window.ttq = ttq;
        ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group',
            'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
        ttq.setAndDefer = (queue, method) => { queue[method] = (...args) => queue.push([method, ...args]); };
        for (const method of ttq.methods) ttq.setAndDefer(ttq, method);
        ttq._i = {}; ttq._t = {}; ttq._o = {};
        ttq.instance = id => {
            const queue = ttq._i[id] ?? [];
            for (const method of ttq.methods) ttq.setAndDefer(queue, method);
            return queue;
        };
        trackerCommand('tiktok', 'holdConsent');
        trackerCommand('tiktok', 'revokeConsent');
        tiktokPrevious = 'revoke';
    }
    updateTrackers();

    function waitTikTok(record) {
        // events.js loads another asynchronous script; its own load event does not establish SDK readiness.
        const retryKey = `consent:script-timeout:${JSON.stringify([denialScope, config.policyVersion, config.servicesVersion, record.id, 'sdk'])}`;
        return new Promise((resolve, reject) => {
            let interval, timer, settled = false;
            const settle = error => {
                if (settled) return;
                settled = true; clearInterval(interval); clearTimeout(timer); record.cancels.delete(cancel);
                if (error) reject(error);
                else { try { sessionStorage.removeItem(retryKey); } catch {} resolve(); }
            };
            const cancel = () => { const error = new Error('Consent was revoked while loading TikTok.'); error.name = 'AbortError'; settle(error); };
            const check = () => {
                try {
                    sync();
                    if (!canRun('marketing')) { cancel(); return; }
                    const instance = window.ttq?.instance?.(config.trackers.tiktok.id);
                    const instances = window.ttq?.instances?.();
                    if (instance && !Array.isArray(instance) && Array.isArray(instances) && instances.includes(instance)
                        && typeof instance.track === 'function' && typeof instance.page === 'function') settle();
                } catch (error) { settle(error); }
            };
            record.cancels.add(cancel);
            interval = setInterval(check, 10);
            timer = setTimeout(() => {
                let retry = false;
                try {
                    if (sessionStorage.getItem(retryKey) !== '1') {
                        sessionStorage.setItem(retryKey, '1'); retry = sessionStorage.getItem(retryKey) === '1';
                    }
                } catch {}
                settle(new Error('The TikTok SDK did not initialize before the script deadline.'));
                reload('script-timeout', retry);
            }, config.scriptTimeoutMs);
            check();
        });
    }

    async function drainTrackers() {
        for (const preset of ['meta', 'clarity', 'matomo', 'tiktok']) {
            const settings = config.trackers[preset];
            const category = ['meta', 'tiktok'].includes(preset) ? 'marketing' : 'analytics';
            sync();
            if (!settings || trackerLoaded.has(preset) || trackerFailed.has(preset) || !canRun(category)) continue;
            const record = { id: preset, category, started: false, nodes: [], cancels: new Set(), trackerPreset: true };
            trackerRecords.set(preset, record);
            try {
                const script = document.createElement('script');
                script.src = preset === 'meta' ? 'https://connect.facebook.net/en_US/fbevents.js'
                    : preset === 'clarity' ? `https://www.clarity.ms/tag/${encodeURIComponent(settings.id)}`
                        : preset === 'matomo' ? `${settings.url}matomo.js`
                            : `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(settings.id)}&lib=ttq`;
                if (preset === 'tiktok') {
                    window.ttq._i[settings.id] = [];
                    window.ttq._i[settings.id]._u = 'https://analytics.tiktok.com/i18n/pixel/events.js';
                    window.ttq._t[settings.id] = Date.now(); window.ttq._o[settings.id] = {};
                }
                if (preset === 'clarity' && claritySignals().ad_Storage === 'granted') {
                    trackerRecords.set('clarity-ads', { id: 'clarity-ads', category: 'marketing',
                        started: true, nodes: [], cancels: new Set(), trackerPreset: true });
                }
                if (!await execute(script, record)) continue;
                if (preset === 'tiktok') {
                    await waitTikTok(record);
                    tiktokPrevious = null;
                    updateTrackers();
                }
                sync();
                if (!canRun(category)) continue;
                if (preset === 'meta') {
                    trackerCommand('meta', 'init', settings.id);
                    sync();
                    if (settings.sendPageView && canRun(category)) trackerCommand('meta', 'track', 'PageView');
                }
                if (preset === 'tiktok' && settings.sendPageView && canRun(category) && !trackerFailed.has(preset)) trackerCommand('tiktok', 'page');
                if (preset === 'matomo') {
                    matomoTracker = window.Matomo?.getAsyncTracker?.(`${settings.url}matomo.php`, settings.siteId);
                    if (!matomoTracker || typeof matomoTracker.requireConsent !== 'function') throw new Error('The Matomo tracker did not initialize.');
                    updateTrackers();
                    sync();
                    if (!canRun(category) || trackerFailed.has(preset)) continue;
                    if (settings.enableLinkTracking) trackerCommand('matomo', 'enableLinkTracking');
                    sync();
                    if (settings.sendPageView && canRun(category)) sendMatomoPageView({ url: window.location.href, title: document.title, referrer: document.referrer });
                }
                trackerLoaded.add(preset);
                // The Clarity library replaces its queue stub. Always address the current API.
                if (preset === 'clarity') {
                    clarityPrevious = null;
                    updateTrackers();
                }
            } catch (error) {
                trackerFailed.add(preset);
                if (error.name !== 'AbortError') report(preset, error);
            }
        }
    }

    async function trackerEvent(preset, args) {
        const category = ['meta', 'tiktok'].includes(preset) ? 'marketing' : 'analytics';
        if (!config.trackers[preset]) throw new TypeError(`The ${preset} preset is not enabled.`);
        sync();
        if (!canRun(category)) return false;
        await initialized;
        await schedulePresets();
        sync();
        if (!canRun(category) || !trackerLoaded.has(preset) || trackerFailed.has(preset)) return false;
        trackerCommand(preset, ...args);
        return true;
    }

    function eventName(name) {
        if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(name)) {
            throw new TypeError('Tracker event names must start with a letter and contain at most 128 letters, digits, underscores, dots, or hyphens.');
        }
        return name;
    }

    function metaEvent(method, name, parameters, options) {
        try {
            eventName(name);
            if (!parameters || Object.prototype.toString.call(parameters) !== '[object Object]'
                || !options || Object.prototype.toString.call(options) !== '[object Object]'
                || Object.keys(options).some(key => key !== 'eventID')
                || Object.hasOwn(options, 'eventID') && (typeof options.eventID !== 'string' || !options.eventID.trim() || options.eventID.length > 128)) {
                throw new TypeError('Meta events require a parameter object and an optional eventID string of 1-128 characters.');
            }
            const data = JSON.parse(JSON.stringify(parameters));
            const eventOptions = { ...options };
            sync();
            const permitted = canRun('marketing');
            return eventOperation(() => {
                if (!config.trackers.meta) throw new TypeError('The meta preset is not enabled.');
                return permitted ? trackerEvent('meta', [method, name, data, eventOptions]) : false;
            });
        } catch (error) { return Promise.reject(error); }
    }

    const metaApi = Object.freeze({
        track: (name, parameters = {}, options = {}) => metaEvent('track', name, parameters, options),
        trackCustom: (name, parameters = {}, options = {}) => metaEvent('trackCustom', name, parameters, options),
    });
    const clarityApi = Object.freeze({
        state: () => { sync(); return Object.freeze(claritySignals()); },
        event: name => {
            try {
                eventName(name);
                sync();
                const permitted = canRun('analytics');
                return eventOperation(() => {
                    if (!config.trackers.clarity) throw new TypeError('The clarity preset is not enabled.');
                    return permitted ? trackerEvent('clarity', ['event', name]) : false;
                });
            } catch (error) { return Promise.reject(error); }
        },
    });

    function tiktokData(value) {
        if (!value || Object.prototype.toString.call(value) !== '[object Object]') throw new TypeError('TikTok parameters must be a JSON object.');
        return JSON.parse(JSON.stringify(value, (key, item) => {
            if (item === undefined || ['function', 'symbol', 'bigint'].includes(typeof item)
                || typeof item === 'number' && !Number.isFinite(item)) throw new TypeError('TikTok parameters must contain only JSON values with finite numbers.');
            return item;
        }));
    }

    function tiktokOperation(args) {
        sync();
        const permitted = canRun('marketing');
        return eventOperation(() => {
            if (!config.trackers.tiktok) throw new TypeError('The tiktok preset is not enabled.');
            return permitted ? trackerEvent('tiktok', args) : false;
        });
    }

    function tiktokTrack(name, parameters, options) {
        try {
            if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(name)) throw new TypeError('TikTok event names must start with a letter and contain at most 50 letters, digits, or underscores.');
            const data = tiktokData(parameters);
            if (!options || Object.prototype.toString.call(options) !== '[object Object]' || Object.keys(options).some(key => key !== 'eventID')
                || Object.hasOwn(options, 'eventID') && (typeof options.eventID !== 'string' || !options.eventID.trim()
                    || options.eventID.length > 128 || /[\x00-\x1f\x7f]/.test(options.eventID))) throw new TypeError('TikTok options accept only an eventID string of 1-128 characters.');
            return tiktokOperation(['track', name, data, { pixel_code: config.trackers.tiktok?.id, ...(Object.hasOwn(options, 'eventID') ? { event_id: options.eventID } : {}) }]);
        } catch (error) { return Promise.reject(error); }
    }

    const tiktokApi = Object.freeze({
        track: (name, parameters = {}, options = {}) => tiktokTrack(name, parameters, options),
        trackCustom: (name, parameters = {}, options = {}) => tiktokTrack(name, parameters, options),
        pageView: () => { try { return tiktokOperation(['page']); } catch (error) { return Promise.reject(error); } },
        identify: identity => {
            try {
                const data = tiktokData(identity);
                if (!Object.keys(data).length || Object.entries(data).some(([key, value]) => !['sha256_email', 'sha256_phone_number', 'external_id'].includes(key)
                    || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) throw new TypeError('TikTok identify requires lowercase SHA-256 values for sha256_email, sha256_phone_number, or external_id.');
                return tiktokOperation(['identify', data]);
            } catch (error) { return Promise.reject(error); }
        },
    });

    function matomoText(value, label, optional = false) {
        if (optional && value === undefined) return undefined;
        if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) {
            throw new TypeError(`Matomo ${label} must be a non-empty string of at most 1024 characters without control characters.`);
        }
        return value;
    }

    function matomoNumber(value, label, optional = false) {
        if (optional && value === undefined) return undefined;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(`Matomo ${label} must be a finite non-negative number.`);
        return value;
    }

    function matomoObject(value, keys) {
        if (!value || Object.prototype.toString.call(value) !== '[object Object]' || Object.keys(value).some(key => !keys.includes(key))) {
            throw new TypeError('Invalid Matomo options.');
        }
    }

    function matomoUrl(value, referrer = false) {
        if (referrer && value === '') return '';
        matomoText(value, 'URL');
        const source = new URL(value, document.baseURI);
        if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) throw new TypeError('Matomo URLs must use HTTP(S) without credentials.');
        return source.href;
    }

    function matomoOperation(prepare, dispatch) {
        try {
            const data = prepare();
            if (!config.trackers.matomo) throw new TypeError('The matomo preset is not enabled.');
            sync();
            const permitted = canRun('analytics');
            return eventOperation(async () => {
                if (!permitted) return false;
                sync();
                if (!canRun('analytics')) return false;
                await initialized;
                await schedulePresets();
                sync();
                if (!canRun('analytics') || !trackerLoaded.has('matomo') || trackerFailed.has('matomo')) return false;
                // Multi-command operations also recheck before each command, including the final measurement.
                const command = (...args) => {
                    sync();
                    if (!canRun('analytics')) return false;
                    trackerCommand('matomo', ...args);
                    return true;
                };
                return dispatch(data, command);
            });
        } catch (error) { return Promise.reject(error); }
    }

    function matomoPageOptions(options) {
        matomoObject(options, ['url', 'title', 'referrer']);
        return { url: matomoUrl(options.url === undefined ? window.location.href : options.url),
            title: options.title === undefined ? document.title : matomoText(options.title, 'page title'),
            referrer: options.referrer === undefined ? undefined : matomoUrl(options.referrer, true) };
    }

    function sendMatomoPageView(data, command = (...args) => {
        sync();
        if (!canRun('analytics')) return false;
        trackerCommand('matomo', ...args);
        return true;
    }) {
        if (!command('setCustomUrl', data.url) || !command('setDocumentTitle', data.title)
            || !command('setReferrerUrl', data.referrer ?? matomoLastPageUrl ?? document.referrer)
            || !command('trackPageView')) return false;
        matomoLastPageUrl = data.url;
        return true;
    }

    function matomoCommerce(options, order) {
        matomoObject(options, order ? ['id', 'total', 'subtotal', 'tax', 'shipping', 'discount', 'items'] : ['total', 'items']);
        if (!Array.isArray(options.items) || options.items.length > 200) throw new TypeError('Matomo commerce requires an items array of at most 200 products.');
        const skus = new Set();
        const items = options.items.map(item => {
            matomoObject(item, ['sku', 'name', 'category', 'price', 'quantity']);
            const sku = matomoText(item.sku, 'product SKU');
            if (skus.has(sku)) throw new TypeError('Matomo product SKUs must be unique within an operation.');
            skus.add(sku);
            let category = item.category;
            if (Array.isArray(category)) {
                if (category.length > 5) throw new TypeError('Matomo supports at most five product categories.');
                category = category.map(value => matomoText(value, 'product category'));
            } else category = matomoText(category, 'product category', true);
            const quantity = item.quantity === undefined ? 1 : item.quantity;
            if (!Number.isSafeInteger(quantity) || quantity < 1) throw new TypeError('Matomo product quantity must be a positive safe integer.');
            return [sku, matomoText(item.name, 'product name', true), category, matomoNumber(item.price, 'product price', true), quantity];
        });
        return { items, total: matomoNumber(options.total, 'total'),
            ...(order ? { id: matomoText(options.id, 'order ID'), subtotal: matomoNumber(options.subtotal, 'subtotal', true),
                tax: matomoNumber(options.tax, 'tax', true), shipping: matomoNumber(options.shipping, 'shipping', true), discount: matomoNumber(options.discount, 'discount', true) } : {}) };
    }

    function sendMatomoCommerce(data, command, order) {
        if (!command('clearEcommerceCart')) return false;
        try {
            for (const item of data.items) if (!command('addEcommerceItem', ...item)) return false;
            return order ? command('trackEcommerceOrder', data.id, data.total, data.subtotal, data.tax, data.shipping, data.discount)
                : command('trackEcommerceCartUpdate', data.total);
        } finally {
            // Do not leave an application's products attached to a later independent operation.
            trackerCommand('matomo', 'clearEcommerceCart');
        }
    }

    const matomoApi = Object.freeze({
        event: (category, action, name, value) => matomoOperation(() => [matomoText(category, 'event category'), matomoText(action, 'event action'),
            matomoText(name, 'event name', true), matomoNumber(value, 'event value', true)], (args, command) => command('trackEvent', ...args)),
        pageView: (options = {}) => matomoOperation(() => matomoPageOptions(options), sendMatomoPageView),
        goal: (id, revenue) => matomoOperation(() => {
            if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw new TypeError('Matomo goal ID must be a positive integer up to 2147483647.');
            return [id, matomoNumber(revenue, 'goal revenue', true)];
        }, (args, command) => command('trackGoal', ...args)),
        search: (keyword, category, resultsCount) => matomoOperation(() => {
            if (resultsCount !== undefined && (!Number.isSafeInteger(resultsCount) || resultsCount < 0)) throw new TypeError('Matomo search results count must be a non-negative safe integer.');
            return [matomoText(keyword, 'search keyword'), matomoText(category, 'search category', true), resultsCount];
        }, (args, command) => command('trackSiteSearch', ...args)),
        link: (url, type = 'link') => matomoOperation(() => {
            if (!['link', 'download'].includes(type)) throw new TypeError('Matomo link type must be link or download.');
            return [matomoUrl(url), type];
        }, (args, command) => command('trackLink', ...args)),
        ecommerceCart: options => matomoOperation(() => matomoCommerce(options, false), (data, command) => sendMatomoCommerce(data, command, false)),
        ecommerceOrder: options => matomoOperation(() => matomoCommerce(options, true), (data, command) => sendMatomoCommerce(data, command, true)),
    });

    const api = {
        __consentForLaravel: true,
        google: googleApi,
        meta: metaApi,
        clarity: clarityApi,
        matomo: matomoApi,
        tiktok: tiktokApi,
        state: () => snapshot(sync()),
        allowed: category => { checkCategory(category); sync(); return category === 'necessary' || canRun(category); },
        choose,
        acceptAll: () => choose(Object.fromEntries(config.categories.map(key => [key, true])), 'accept_all'),
        rejectOptional: () => choose({}, 'reject_optional'),
        openPreferences: () => !document.dispatchEvent(new CustomEvent('consent:open-preferences', { cancelable: true })),
        forget,
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
                previous = [operations, cleanupQueue, presetQueue, loadQueue, eventQueue, navigationQueue];
                await Promise.all(previous);
            } while (previous[0] !== operations || previous[1] !== cleanupQueue || previous[2] !== presetQueue
                || previous[3] !== loadQueue || previous[4] !== eventQueue || previous[5] !== navigationQueue);
            return snapshot(current);
        },
    };
    window.Consent = Object.freeze(api);
    function start() {
        ready = true;
        resumeAudit();
        cleanCookies(knownCategories.filter(key => key !== 'necessary' && !permits(current, key)));
        schedule();
        new MutationObserver(changes => {
            if (changes.some(change => change.type === 'attributes' && change.target.matches(selector)
                || [...change.addedNodes].some(node => node.nodeType === 1 && (node.matches(selector) || node.querySelector(selector))))) schedule();
        }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-consent-block', 'data-consent-category'] });
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
