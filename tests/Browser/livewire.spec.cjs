'use strict';
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const banner = '[data-consent-banner]';
const dialog = '[data-consent-dialog]';
const idle = page => page.evaluate(() => window.Consent.whenIdle());
async function visit(page, path = '/en/a') {
    const response = await page.goto(path);
    expect(response.status()).toBe(200);
    await idle(page);
    await expect(page.locator('[data-consent-ui]')).toHaveCount(1);
}
async function accept(page) {
    await page.locator(`${banner} [data-consent-action="accept"]`).click();
    await idle(page);
    await expect(page.locator('[data-consent-launcher]')).toBeVisible();
}
async function navigate(page, selector, title) {
    await page.locator(selector).click();
    await expect(page.locator('#page-title')).toHaveText(title);
    await idle(page);
}

test('pending and refused visits remain inert through navigation and browser history', async ({ page, request }) => {
    const before = (await (await request.get('/fixture/log')).json()).length;
    await visit(page);
    await navigate(page, '#page-b', 'en b');
    await page.goBack();
    await expect(page.locator('#page-title')).toHaveText('en a');
    await idle(page);
    expect(await page.evaluate(() => window.fixtureSdkLoads)).toBeUndefined();
    await page.locator(`${banner} [data-consent-action="reject"]`).click();
    await idle(page);
    const state = await page.evaluate(() => Consent.state());
    await navigate(page, '#page-c', 'en c');
    await page.goBack();
    await expect(page.locator('#page-title')).toHaveText('en a');
    await idle(page);
    expect(await page.evaluate(() => Consent.state())).toEqual(state);
    expect((await (await request.get('/fixture/log')).json()).length).toBe(before);
});

test('granted scripts load once while new blocks and morphs run in order', async ({ page }) => {
    await visit(page);
    await accept(page);
    const token = await page.evaluate(() => window.fixtureDocument);
    await navigate(page, '#page-b', 'en b');
    await page.locator('#update').click();
    await expect(page.locator('#counter')).toHaveText('1');
    await idle(page);
    await page.goBack();
    await expect(page.locator('#page-title')).toHaveText('en a');
    await idle(page);
    expect(await page.evaluate(() => ({ sdk: fixtureSdkLoads, init: fixtureInitialized, pages: fixturePages, token: fixtureDocument })))
        .toEqual({ sdk: 1, init: 1, pages: ['a', 'b'], token });
});

test('language navigation updates banner dialog labels and audit snapshot without changing consent', async ({ page }) => {
    await visit(page);
    await accept(page);
    const original = await page.evaluate(() => ({ state: Consent.state(), token: fixtureDocument }));
    for (const locale of ['pl', 'de', 'fr', 'it', 'es', 'pt', 'en']) {
        await navigate(page, `#language-${locale}`, `${locale} a`);
        await expect(page.locator('[data-consent-ui]')).toHaveAttribute('lang', locale);
        await page.locator('#outside').click();
        await expect(page.locator(dialog)).toBeVisible();
        const payload = await page.locator('script[data-consent-notice]').textContent();
        expect(JSON.parse(JSON.parse(payload).payload).locale).toBe(locale);
        await page.keyboard.press('Escape');
        expect(await page.evaluate(() => Consent.state())).toEqual(original.state);
    }
    expect(await page.evaluate(() => fixtureDocument)).toBe(original.token);
    expect(await page.evaluate(() => fixtureSdkLoads)).toBe(1);
});

test('component locale changes replace the protected UI and keep controls functional', async ({ page }) => {
    await visit(page, '/en/a?component=1');
    await page.locator('#outside').click();
    await page.locator('#consent-category-analytics').check();
    // Ordinary morphs preserve the open dialog and draft.
    await page.evaluate(() => Livewire.first().$set('counter', 1));
    await expect(page.locator('#counter')).toHaveText('1');
    await expect(page.locator(dialog)).toBeVisible();
    await expect(page.locator('#consent-category-analytics')).toBeChecked();
    await page.keyboard.press('Escape');
    await page.locator('#component-pl').click();
    await expect(page.locator('[data-consent-ui]')).toHaveAttribute('lang', 'pl');
    await page.locator('#outside').click();
    await expect(page.locator(dialog)).toBeVisible();
    await expect(page.locator('#consent-category-analytics')).not.toBeChecked();
    await page.locator('#consent-category-analytics').check();
    await page.locator(`${dialog} [data-consent-action="save"]`).click();
    await idle(page);
    expect(await page.evaluate(() => Consent.allowed('analytics'))).toBe(true);
    await page.locator('#component-en').click();
    await expect(page.locator('[data-consent-ui]')).toHaveAttribute('lang', 'en');
    expect(await page.evaluate(() => Consent.allowed('analytics'))).toBe(true);
});

test('navigation discards a draft and leaves no modal backdrop or stale focus', async ({ page }) => {
    await visit(page);
    await page.locator('#outside').click();
    await page.locator('#consent-category-analytics').check();
    await page.evaluate(() => Livewire.navigate('/pl/b'));
    await expect(page.locator('#page-title')).toHaveText('pl b');
    await idle(page);
    await expect(page.locator(dialog)).not.toBeVisible();
    await expect(page.locator(banner)).toBeVisible();
    expect(await page.evaluate(() => Consent.state().decidedAt)).toBeNull();
    await page.locator('#outside').click();
    await expect(page.locator('#consent-category-analytics')).not.toBeChecked();
    await expect(page.locator('#consent-preferences-title')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#outside')).toBeFocused();
});

test('persisted interfaces follow a language switch through a safe full refresh', async ({ page }) => {
    await visit(page, '/en/a?persist=1');
    await accept(page);
    const state = await page.evaluate(() => Consent.state());
    await navigate(page, '#page-b', 'en b');
    await navigate(page, '#language-pl', 'pl b');
    await expect(page.locator('[data-consent-ui]')).toHaveAttribute('lang', 'pl');
    expect(await page.evaluate(() => Consent.state())).toEqual(state);
    await page.locator('#outside').click();
    await expect(page.locator(dialog)).toBeVisible();
});

test('active withdrawal after navigation performs a full reload and deletes declared cookies', async ({ page }) => {
    await visit(page);
    await accept(page);
    await navigate(page, '#page-b', 'en b');
    const token = await page.evaluate(() => fixtureDocument);
    await page.locator('#outside').click();
    await page.locator(`${dialog} [data-consent-action="reject"]`).click();
    await page.waitForFunction(old => window.fixtureDocument !== old, token);
    await idle(page);
    expect(await page.evaluate(() => Consent.allowed('analytics'))).toBe(false);
    expect(await page.evaluate(() => window.fixtureSdkLoads)).toBeUndefined();
    expect((await page.context().cookies()).some(cookie => cookie.name === '_fixture')).toBe(false);
});

test('single-file unindented scripts remain inert until consent including after morph', async ({ page }) => {
    await visit(page, '/en/single');
    if (!await page.locator('#single-update').count()) test.skip(true, 'Single-file compilation is a Livewire 4 feature.');
    expect(await page.evaluate(() => window.fixtureSingle)).toBeUndefined();
    await page.locator('#single-update').click();
    await page.waitForFunction(() => document.querySelector('template[data-consent-block="single-1"]'));
    expect(await page.evaluate(() => window.fixtureSingle)).toBeUndefined();
    await accept(page);
    expect(await page.evaluate(() => fixtureSingle)).toBe(1);
    await page.locator('#single-update').click();
    await page.waitForFunction(() => window.fixtureSingle === 2);
});

for (const published of [false, true]) {
    test(`nonce CSP and module completion work across visits with ${published ? 'published' : 'inline'} assets`, async ({ page }) => {
        await visit(page, `/en/a?nonce=1${published ? '&assets=1' : ''}`);
        await accept(page);
        await page.evaluate(() => Livewire.navigate('/pl/modules?nonce=1' + (location.search.includes('assets=1') ? '&assets=1' : '')));
        await expect(page.locator('#page-title')).toHaveText('pl modules');
        await page.waitForFunction(() => window.fixtureModuleTail === 42);
        await idle(page);
        expect(await page.evaluate(() => window.fixtureCsp ?? [])).toEqual([]);
        await expect(page.locator('[data-consent-ui]')).toHaveAttribute('lang', 'pl');
    });
}

test('invalid explicit nonce blocks dependent scripts without repairing the nonce', async ({ page }) => {
    await visit(page, '/en/blocked?nonce=1');
    await accept(page);
    expect(await page.evaluate(() => [window.fixtureBlocked, window.fixtureBlockedTail])).toEqual([undefined, undefined]);
    expect(await page.evaluate(() => (window.fixtureCsp ?? []).some(e => e.directive === 'script-src-elem'))).toBe(true);
});

test('changed policy requires a fresh document before activating another page', async ({ page }) => {
    await visit(page);
    await accept(page);
    const token = await page.evaluate(() => fixtureDocument);
    await navigate(page, '#page-b', 'en b');
    await page.evaluate(() => Livewire.navigate('/en/context'));
    await page.waitForFunction(old => window.fixtureDocument !== old, token);
    await idle(page);
    expect(await page.evaluate(() => Consent.state().decidedAt)).toBeNull();
    expect(await page.evaluate(() => window.fixtureSdkLoads)).toBeUndefined();
});

test('a delayed audit keeps its original language and cannot revive a newer refusal', async ({ page }) => {
    const submitted = [];
    let release;
    await page.route('**/consent/decisions', async route => {
        submitted.push(route.request().postDataJSON());
        const response = await route.fetch();
        if (submitted.length === 1) await new Promise(resolve => { release = resolve; });
        await route.fulfill({ response });
    });
    await visit(page);
    await page.locator(`${banner} [data-consent-action="accept"]`).click();
    await expect.poll(() => typeof release).toBe('function');
    expect(await page.evaluate(() => Consent.allowed('analytics'))).toBe(false);
    await page.evaluate(() => Livewire.navigate('/pl/b'));
    await expect(page.locator('#page-title')).toHaveText('pl b');
    await expect(page.locator('[data-consent-ui]')).toHaveAttribute('lang', 'pl');
    await page.locator(`${banner} [data-consent-action="reject"]`).click();
    await expect.poll(() => submitted.length).toBe(2);
    release();
    await idle(page);
    expect(JSON.parse(submitted[0].notice.payload).locale).toBe('en');
    expect(JSON.parse(submitted[1].notice.payload).locale).toBe('pl');
    expect(submitted[0].id).not.toBe(submitted[1].id);
    expect(await page.evaluate(() => Consent.allowed('analytics'))).toBe(false);
    expect(await page.evaluate(() => window.fixtureSdkLoads)).toBeUndefined();
});

test('an unavailable audit leaves a retryable interface without activating a grant', async ({ page }) => {
    await page.route('**/consent/decisions', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await visit(page);
    await page.locator(`${banner} [data-consent-action="accept"]`).click();
    await idle(page);
    await expect(page.locator(`${banner} [data-consent-error]`)).toBeVisible();
    expect(await page.evaluate(() => Consent.allowed('analytics'))).toBe(false);
    expect(await page.evaluate(() => window.fixtureSdkLoads)).toBeUndefined();
});

test('a cancelled Livewire navigation keeps the open draft and makes no decision', async ({ page }) => {
    await visit(page);
    await page.locator('#outside').click();
    await page.locator('#consent-category-analytics').check();
    await page.evaluate(() => {
        document.addEventListener('livewire:navigate', event => event.preventDefault(), { once: true });
        Livewire.navigate('/pl/b');
    });
    await expect(page.locator('#page-title')).toHaveText('en a');
    await expect(page.locator(dialog)).toBeVisible();
    await expect(page.locator('#consent-category-analytics')).toBeChecked();
    expect(await page.evaluate(() => Consent.state().decidedAt)).toBeNull();
});

test('history-only refusal survives an active reload and subsequent Livewire pushState', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Blocked storage'); } }));
    await visit(page);
    await accept(page);
    const token = await page.evaluate(() => fixtureDocument);
    await page.evaluate(() => {
        const cookie = document.cookie;
        Object.defineProperty(document, 'cookie', { get: () => cookie, set() {} });
        setTimeout(() => Consent.rejectOptional().catch(() => {}), 0);
    });
    await page.waitForFunction(old => window.fixtureDocument !== old, token);
    await idle(page);
    expect(await page.evaluate(() => Consent.allowed('analytics'))).toBe(false);
    await navigate(page, '#page-b', 'en b');
    expect(await page.evaluate(() => Consent.allowed('analytics'))).toBe(false);
    expect(await page.evaluate(() => history.state.__consentForLaravelDenied)).toBe('["consent_preferences","/",null]');
    expect(await page.evaluate(() => window.fixtureSdkLoads)).toBeUndefined();
});

test('native modal keyboard, contrast, reflow and text resizing survive navigation', async ({ page }) => {
    await visit(page, '/en/a?variant=compact&position=bottom-center&theme=dark');
    await navigate(page, '#language-fr', 'fr a');
    await page.locator('#outside').click();
    await expect(page.locator('#consent-preferences-title')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator(`${dialog} [data-consent-action="save"]`)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator(`${dialog} [data-consent-action="close"]`)).toBeFocused();
    await page.locator('#consent-category-analytics').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#consent-category-analytics')).toBeChecked();
    await page.setViewportSize({ width: 320, height: 800 });
    await page.addStyleTag({ content: 'html { font-size: 200% } .consent-ui * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important }' });
    await page.locator(`${dialog} [data-consent-action="save"]`).focus();
    const geometry = await page.locator(dialog).evaluate(el => ({ width: el.getBoundingClientRect().width, scroll: el.scrollWidth, client: el.clientWidth }));
    expect(geometry.width).toBeLessThanOrEqual(320);
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addScriptTag({ content: axe });
    const results = await page.evaluate(() => axe.run('[data-consent-ui]', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }));
    expect(results.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#outside')).toBeFocused();
});

test('both variants reflow in every position and theme after a locale change', async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 320, height: 800 });
    for (const variant of ['standard', 'compact']) for (const position of ['bottom-left', 'bottom-right', 'bottom-center']) for (const theme of ['light', 'dark', 'auto']) {
        await page.emulateMedia({ colorScheme: 'dark' });
        await visit(page, `/en/a?variant=${variant}&position=${position}&theme=${theme}`);
        await navigate(page, '#language-de', 'de a');
        await page.locator('#outside').click();
        await page.addStyleTag({ content: 'html { font-size: 200% } .consent-ui * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important }' });
        await page.locator(`${dialog} [data-consent-action="save"]`).focus();
        const size = await page.locator(dialog).evaluate(el => ({ width: el.getBoundingClientRect().width, scroll: el.scrollWidth, client: el.clientWidth }));
        expect(size.width).toBeLessThanOrEqual(320);
        expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
        await page.keyboard.press('Escape');
    }
});
