(() => {
    'use strict';
    if (window.__consentUiLoaded) return;
    window.__consentUiLoaded = true;
    let controller = null;
    const roots = '[data-consent-ui]';

    function mount(root) {
        const api = window.Consent;
        const banner = root.querySelector('[data-consent-banner]');
        const dialog = root.querySelector('[data-consent-dialog]');
        const launcher = root.querySelector('[data-consent-launcher]');
        const form = root.querySelector('[data-consent-form]');
        const status = root.querySelector('[data-consent-status]');
        const fallback = root.querySelector('[data-consent-fallback]');
        if (!api?.__consentForLaravel || !banner || !launcher || !form || !status || typeof dialog?.showModal !== 'function') return null;
        const fields = [...form.querySelectorAll('input[data-consent-category]')];
        const optional = fields.some(field => field.dataset.consentCategory !== 'necessary');
        let busy = false;
        let dismissed = false;
        let trigger = null;
        let lastError = '';
        const events = new AbortController();
        const on = (target, name, callback) => target.addEventListener(name, callback, { signal: events.signal });
        const announce = key => { status.textContent = root.dataset[`message${key}`] ?? ''; };
        const selection = state => fields.forEach(field => { field.checked = state.choices[field.dataset.consentCategory] === true; });
        const covers = (overlay, focus) => overlay.width > 0 && overlay.height > 0 && focus.width > 0 && focus.height > 0
            && overlay.left <= focus.left && overlay.right >= focus.right && overlay.top <= focus.top && overlay.bottom >= focus.bottom;
        const error = message => {
            lastError = message;
            for (const node of root.querySelectorAll('[data-consent-error]')) { node.textContent = message; node.hidden = message === ''; }
        };
        function reveal(state = api.state()) {
            banner.hidden = dialog.open || !optional || dismissed || state.decidedAt !== null;
            launcher.hidden = dialog.open || !banner.hidden;
            if (!root.contains(document.activeElement) && document.activeElement instanceof Element
                && document.activeElement !== document.body && document.activeElement !== document.documentElement) {
                launcher.hidden ||= covers(launcher.getBoundingClientRect(), document.activeElement.getBoundingClientRect());
            }
        }
        function restoreFocus(preferred) {
            if (preferred?.isConnected && !preferred.closest('[hidden]') && !dialog.contains(preferred)) preferred.focus({ preventScroll: true });
            else if (!launcher.hidden) launcher.focus({ preventScroll: true });
        }
        function close() {
            if (!dialog.open) return;
            dialog.close();
            reveal();
            restoreFocus(trigger);
        }
        function open(opener = document.activeElement) {
            if (dialog.open) return true;
            selection(api.state());
            trigger = opener;
            try { dialog.showModal(); }
            catch { return false; }
            reveal();
            dialog.scrollTop = 0;
            dialog.querySelector('h2').focus({ preventScroll: true });
            return true;
        }
        function collapse() {
            const focusedInside = banner.contains(document.activeElement);
            dismissed = true;
            reveal();
            if (focusedInside) restoreFocus(null);
        }
        async function save(action) {
            if (busy) return;
            const focusedInside = banner.contains(document.activeElement) || dialog.contains(document.activeElement);
            if (!dialog.open) trigger = document.activeElement;
            busy = true;
            error('');
            root.setAttribute('aria-busy', 'true');
            for (const button of root.querySelectorAll('[data-consent-action="accept"], [data-consent-action="reject"], [data-consent-action="save"]')) button.setAttribute('aria-disabled', 'true');
            for (const field of fields) field.disabled = true;
            announce('Saving');
            try {
                if (action === 'accept') await api.acceptAll();
                else if (action === 'reject') await api.rejectOptional();
                else await api.choose(Object.fromEntries(fields.map(field => [field.dataset.consentCategory, field.checked])));
                dismissed = false;
                announce('Saved');
                close();
                reveal();
                if (focusedInside) restoreFocus(trigger);
            } catch {
                error(lastError || root.dataset.messageError);
                // The choice was not saved. Keep a visible route to retry it, even after a same-tab denial.
                dismissed = false;
                reveal();
                if (!dialog.open) banner.hidden = false;
                launcher.hidden = true;
                status.textContent = '';
            } finally {
                busy = false;
                root.removeAttribute('aria-busy');
                for (const button of root.querySelectorAll('[aria-disabled]')) button.removeAttribute('aria-disabled');
                for (const field of fields) field.disabled = field.dataset.consentCategory === 'necessary';
            }
        }
        on(root, 'click', event => {
            const button = event.target.closest('[data-consent-action]');
            if (!button || !root.contains(button)) return;
            const action = button.dataset.consentAction;
            if (action === 'save') return; // Form submission also supports Enter and assistive technology.
            event.preventDefault();
            if (action === 'open') open(button);
            else if (action === 'close') close();
            else if (action === 'dismiss') collapse();
            else if (action === 'accept' || action === 'reject') save(action);
        });
        on(form, 'submit', event => { event.preventDefault(); save('save'); });
        on(dialog, 'cancel', event => { event.preventDefault(); close(); });
        on(dialog, 'close', () => {
            if (!dialog.open) {
                const needsFocus = dialog.contains(document.activeElement) || document.activeElement === document.body;
                reveal();
                if (needsFocus) restoreFocus(trigger);
            }
        });
        on(dialog, 'click', event => {
            const rect = dialog.getBoundingClientRect();
            if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) close();
        });
        on(dialog, 'keydown', event => {
            if (event.key !== 'Tab') return;
            const focusable = [...dialog.querySelectorAll('button, a[href], input, [tabindex="0"]')].filter(node => !node.disabled && !node.closest('[hidden]'));
            const first = focusable[0], last = focusable.at(-1);
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.querySelector('h2'))) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        });
        on(document, 'keydown', event => {
            if (event.key === 'Escape' && !dialog.open && !banner.hidden) collapse();
        });
        on(document, 'focusin', event => {
            if (dialog.open || root.contains(event.target) || !(event.target instanceof Element)) return;
            if (!banner.hidden && covers(banner.getBoundingClientRect(), event.target.getBoundingClientRect())) dismissed = true;
            reveal();
        });
        on(document, 'consent:error', event => {
            if (event.detail.code === 'storage-denial') error(root.dataset.messageLeave);
        });
        const unsubscribe = api.onChange((current, previous, source) => {
            if (!busy) {
                selection(current);
                if (dialog.open) announce('Changed');
                if (current.decidedAt === null && previous.decidedAt !== null) dismissed = false;
            }
            reveal(current);
            if (!busy && source !== 'storage-error' && root.contains(document.activeElement) && !dialog.open && banner.hidden) restoreFocus(null);
        });
        fallback.hidden = true;
        selection(api.state());
        reveal();
        return { root, open, destroy() { unsubscribe(); events.abort(); if (dialog.open) dialog.close(); } };
    }

    function boot() {
        if (controller && !controller.root.isConnected) { controller.destroy(); controller = null; }
        if (!controller) {
            const root = document.querySelector(roots);
            if (root) controller = mount(root);
        }
    }
    document.addEventListener('consent:open-preferences', event => {
        boot();
        if (controller?.open(document.activeElement)) event.preventDefault();
    });
    document.addEventListener('click', event => {
        const opener = event.target.closest('[data-consent-open]');
        if (!opener) return;
        boot();
        if (controller?.open(opener)) event.preventDefault();
    });
    document.addEventListener('consent:ready', boot);
    function start() {
        boot();
        new MutationObserver(changes => {
            if (changes.some(change => [...change.addedNodes, ...change.removedNodes].some(node => node.nodeType === 1 && (node.matches(roots) || node.querySelector(roots))))) boot();
        }).observe(document.documentElement, { childList: true, subtree: true });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
})();
