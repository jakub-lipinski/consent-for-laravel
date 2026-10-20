'use strict';
const { test, expect } = require('@playwright/test');
const idle = page => page.evaluate(() => Consent.whenIdle());
const root = '[data-consent-ui]';
const banner = '[data-consent-banner]';
const dialog = '[data-consent-dialog]';
const launcher = '[data-consent-launcher]';
const toggle = '[data-fixture-theme-toggle]';
const palettes = {
    default: { light: { background: 'rgb(255, 255, 255)', text: 'rgb(24, 39, 34)' }, dark: { background: 'rgb(17, 27, 23)', text: 'rgb(237, 244, 239)' } },
    custom: { light: { background: 'rgb(255, 241, 230)', text: 'rgb(36, 31, 31)' }, dark: { background: 'rgb(32, 22, 41)', text: 'rgb(245, 234, 255)' } },
};
async function colors(page, palette) {
    for (const selector of [banner, dialog, launcher]) await expect(page.locator(selector)).toHaveCSS('background-color', palette.background);
    await expect(page.locator(root)).toHaveCSS('color', palette.text);
    await expect(page.locator(dialog)).toHaveCSS('color', palette.text);
}

for (const variant of ['standard', 'compact']) for (const published of [false, true]) {
    test(`inherited ${variant} theme follows the site with ${published ? 'published' : 'inline'} assets and preserves drafts`, async ({ page }) => {
        for (const custom of [false, true]) {
            const palette = palettes[custom ? 'custom' : 'default'];
            await page.context().clearCookies();
            await page.emulateMedia({ colorScheme: 'dark' });
            await page.goto(`/en/a?theme=inherit&site-theme=1&variant=${variant}&custom-colors=${Number(custom)}&assets=${Number(published)}&nonce=1`);
            await idle(page);
            const before = await page.evaluate(() => ({ state: Consent.state(), cookie: document.cookie, token: fixtureDocument }));
            await colors(page, palette.light);
            await page.locator(toggle).click();
            await colors(page, palette.dark);
            await page.emulateMedia({ colorScheme: 'light' });
            await colors(page, palette.dark);
            await page.locator(`${banner} [data-consent-action="open"]`).click();
            await page.locator('#consent-category-analytics').check();
            await page.evaluate(() => document.querySelector('[data-fixture-theme-toggle]').click());
            await colors(page, palette.light);
            await expect(page.locator(dialog)).toBeVisible();
            await expect(page.locator('#consent-category-analytics')).toBeChecked();
            expect(await page.evaluate(() => ({ state: Consent.state(), cookie: document.cookie, token: fixtureDocument }))).toEqual(before);
            expect(await page.evaluate(() => window.fixtureSdkLoads)).toBeUndefined();
            await page.keyboard.press('Escape');
            await page.locator(`${banner} [data-consent-action="reject"]`).click();
            await idle(page);
            await expect(page.locator(launcher)).toBeVisible();
            const saved = await page.evaluate(() => Consent.state());
            await page.locator(toggle).click();
            await colors(page, palette.dark);
            expect(await page.evaluate(() => Consent.state())).toEqual(saved);
            expect(await page.evaluate(() => window.fixtureCsp || [])).toEqual([]);
        }
    });
}

for (const theme of ['light', 'dark', 'auto']) {
    test(`${theme} keeps its existing meaning when the site has a theme switch`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto(`/en/a?theme=${theme}&site-theme=1`);
        await idle(page);
        await colors(page, palettes.default[theme === 'light' ? 'light' : 'dark']);
        await page.locator(toggle).click();
        await colors(page, palettes.default[theme === 'light' ? 'light' : 'dark']);
        await page.emulateMedia({ colorScheme: 'light' });
        await colors(page, palettes.default[theme === 'dark' ? 'dark' : 'light']);
        await page.addStyleTag({ content: '.consent-banner { --consent-background: #fff1e6; }' });
        await expect(page.locator(banner)).toHaveCSS('background-color', 'rgb(255, 241, 230)');
    });
}

test('inherited theme follows the nearest ancestor and survives a Livewire remount', async ({ page }) => {
    await page.goto('/en/a?theme=inherit&site-theme=1');
    await idle(page);
    await page.locator(toggle).click();
    await colors(page, palettes.default.dark);
    await page.evaluate(() => {
        const scope = document.createElement('div');
        scope.style.colorScheme = 'light';
        document.body.append(scope);
        scope.append(document.querySelector('[data-consent-container]'));
    });
    await colors(page, palettes.default.light);
    const token = await page.evaluate(() => fixtureDocument);
    await page.evaluate(() => Livewire.navigate('/pl/b?theme=inherit&site-theme=1'));
    await expect(page.locator('#page-title')).toHaveText('pl b');
    await idle(page);
    await page.locator(toggle).click();
    await colors(page, palettes.default.dark);
    expect(await page.evaluate(() => fixtureDocument)).toBe(token);
    expect(await page.evaluate(() => window.fixtureSdkLoads)).toBeUndefined();
});

test('inherit uses light without a host scheme and delegates only when the host supports both schemes', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en/a?theme=inherit');
    await idle(page);
    await colors(page, palettes.default.light);
    await page.evaluate(() => { document.documentElement.style.colorScheme = 'light dark'; });
    await colors(page, palettes.default.dark);
    await page.emulateMedia({ colorScheme: 'light' });
    await colors(page, palettes.default.light);
    expect(await page.evaluate(() => Consent.state().decidedAt)).toBeNull();
});

test('inherit keeps a readable light fallback without light-dark support', async ({ page }) => {
    await page.route('**/vendor/consent/consent.css', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace('@supports (color: light-dark(#ffffff, #000000))', '@supports (color: unsupported-consent-color)') });
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/en/a?theme=inherit&site-theme=1&assets=1');
    await idle(page);
    await page.locator(toggle).click();
    await colors(page, palettes.default.light);
    await page.locator(`${banner} [data-consent-action="open"]`).click();
    await expect(page.locator(dialog)).toBeVisible();
    await expect(page.locator('#consent-category-analytics')).not.toBeChecked();
});
