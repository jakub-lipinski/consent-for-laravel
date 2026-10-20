'use strict';
const { test, expect } = require('@playwright/test');

const bootstrap = `
window.fixtureTikTokBootstraps = (window.fixtureTikTokBootstraps || 0) + 1;
const sdk = document.createElement('script');
sdk.src = 'https://analytics.tiktok.com/fixture-runtime.js';
document.head.appendChild(sdk);
`;
const sdk = `
window.fixtureTikTokStages = (window.fixtureTikTokStages || 0) + 1;
window.fixtureFinishTikTok = () => {
    window.fixtureTikTokCalls = ttq.map(args => Array.from(args));
    const instance = { track() {}, page() {} };
    window.ttq = Object.fromEntries(['page', 'track', 'identify', 'holdConsent', 'revokeConsent', 'grantConsent'].map(method =>
        [method, (...args) => fixtureTikTokCalls.push([method, ...args])]));
    ttq.instance = () => instance;
    ttq.instances = () => [instance];
};
`;

for (const readiness of ['before', 'during', 'after']) {
    test(`TikTok readiness ${readiness} a real Livewire swap preserves tracking without replay or duplicate initialization`, async ({ page }) => {
        let releaseVisit;
        const requests = [];
        await page.route('https://analytics.tiktok.com/**', route => {
            requests.push(new URL(route.request().url()).pathname);
            return route.fulfill({ contentType: 'application/javascript', body: route.request().url().includes('events.js') ? bootstrap : sdk });
        });
        await page.route('**/fixture/tiktok-visit.js', async route => {
            await new Promise(resolve => { releaseVisit = resolve; });
            await route.fulfill({ contentType: 'application/javascript', body: 'window.fixtureTikTokVisit = true;' });
        });
        await page.route('**/pl/b?tiktok=1', async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: (await response.text()).replace('</head>', '<script src="/fixture/tiktok-visit.js"></script></head>') });
        });
        await page.goto('/en/a?tiktok=1');
        await page.evaluate(() => {
            window.fixtureTikTokErrors = [];
            document.addEventListener('consent:error', event => fixtureTikTokErrors.push(event.detail.code));
            document.addEventListener('consent:navigating', () => { window.fixtureTikTokPaused = true; });
            document.addEventListener('consent:navigated', () => { window.fixtureTikTokPaused = false; });
            return Consent.choose({ marketing: true });
        });
        await page.waitForFunction(() => typeof fixtureFinishTikTok === 'function');
        if (readiness === 'before') await page.evaluate(async () => { fixtureFinishTikTok(); await Consent.whenIdle(); });
        await page.evaluate(() => Livewire.navigate('/pl/b?tiktok=1'));
        await expect.poll(() => typeof releaseVisit).toBe('function');
        expect(await page.evaluate(() => fixtureTikTokPaused)).toBe(true);
        await page.evaluate(() => { window.fixtureTikTokPausedEvent = Consent.tiktok.track('Paused'); });
        if (readiness === 'during') await page.evaluate(() => fixtureFinishTikTok());
        await expect.poll(() => page.evaluate(() => Consent.allowed('marketing'))).toBe(false);
        await page.waitForTimeout(40);
        expect(await page.evaluate(() => (window.fixtureTikTokCalls || []).filter(args => args[0] === 'page').length)).toBe(readiness === 'before' ? 1 : 0);
        releaseVisit();
        await page.waitForFunction(() => fixtureTikTokPaused === false);
        if (readiness === 'after') await page.evaluate(() => fixtureFinishTikTok());
        expect(await page.evaluate(() => fixtureTikTokPausedEvent)).toBe(false);
        await page.evaluate(() => Consent.whenIdle());
        expect(await page.evaluate(() => Consent.tiktok.track('Purchase'))).toBe(true);
        await page.evaluate(() => Livewire.navigate('/en/c?tiktok=1'));
        await expect(page.locator('#page-title')).toHaveText('en c');
        await page.evaluate(() => Consent.whenIdle());
        expect(await page.evaluate(() => Consent.tiktok.track('CompleteRegistration'))).toBe(true);
        expect(await page.evaluate(() => Consent.allowed('marketing'))).toBe(true);
        expect(await page.evaluate(() => fixtureTikTokCalls.filter(args => args[0] === 'track').map(args => args[1]))).toEqual(['Purchase', 'CompleteRegistration']);
        expect(await page.evaluate(() => fixtureTikTokCalls.filter(args => args[0] === 'page').length)).toBe(1);
        expect(await page.evaluate(() => [fixtureTikTokBootstraps, fixtureTikTokStages])).toEqual([1, 1]);
        expect(requests).toEqual(['/i18n/pixel/events.js', '/fixture-runtime.js']);
        expect(await page.evaluate(() => fixtureTikTokErrors)).toEqual([]);
    });
}
