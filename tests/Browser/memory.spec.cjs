'use strict';
const { test, expect } = require('@playwright/test');

const idle = page => page.evaluate(() => Consent.whenIdle());
async function collect(page) {
    const session = await page.context().newCDPSession(page);
    try {
        await session.send('HeapProfiler.collectGarbage');
        await session.send('HeapProfiler.collectGarbage');
    } finally {
        await session.detach();
    }
}

for (const decision of ['pending', 'refused', 'granted']) {
    for (const stripped of [false, true]) {
        test(`${decision} Livewire pages release old bodies with ${stripped ? 'stripped control' : 'consent blocks'}`, async ({ page, browserName }) => {
            test.skip(browserName !== 'chromium', 'Full garbage collection requires Chromium CDP.');
            if (stripped) await page.route('**/en/memory-*', async route => {
                const response = await route.fetch();
                await route.fulfill({ response, body: (await response.text()).replace(/<template\b[^>]*data-consent-block[^>]*>[\s\S]*?<\/template>/g, '') });
            });
            await page.goto('/en/memory-0');
            await idle(page);
            if (decision !== 'pending') {
                await page.evaluate(granted => Consent.choose({ analytics: granted }), decision === 'granted');
                await idle(page);
            }
            const token = await page.evaluate(() => fixtureDocument);
            await page.evaluate(() => { window.fixtureOldBodies = []; });
            for (let index = 1; index <= 8; index++) {
                await page.evaluate(index => {
                    fixtureOldBodies.push(new WeakRef(document.body));
                    Livewire.navigate('/en/memory-' + index);
                }, index);
                await expect(page.locator('#page-title')).toHaveText('en memory-' + index);
                await idle(page);
            }
            expect(await page.evaluate(() => fixtureDocument)).toBe(token);
            // Livewire 3's progress transition can temporarily retain a departing body.
            await expect.poll(async () => {
                await collect(page);
                return page.evaluate(() => fixtureOldBodies.filter(ref => ref.deref()).length);
            }, { timeout: 5000 }).toBe(0);
            if (stripped) return;
            if (decision !== 'granted') {
                expect(await page.evaluate(() => window.fixtureSdkLoads)).toBeUndefined();
                await page.evaluate(() => Consent.choose({ analytics: true }));
                await idle(page);
                expect(await page.evaluate(() => fixturePages)).toEqual(['memory-8']);
            }
            await page.evaluate(() => Livewire.navigate('/en/memory-0'));
            await expect(page.locator('#page-title')).toHaveText('en memory-0');
            await idle(page);
            const pages = await page.evaluate(() => fixturePages);
            expect(pages).toEqual(decision === 'granted'
                ? Array.from({ length: 9 }, (_, index) => 'memory-' + index) : ['memory-8', 'memory-0']);
            expect(await page.evaluate(() => [fixtureSdkLoads, fixtureInitialized])).toEqual([1, 1]);
            await page.evaluate(() => Consent.rejectOptional());
            await page.waitForFunction(old => fixtureDocument !== old, token);
            await idle(page);
            expect(await page.evaluate(() => Consent.allowed('analytics'))).toBe(false);
        });
    }
}

for (const granted of [false, true]) {
    test(`removed SPA fragments are collectible with ${granted ? 'granted' : 'pending'} consent`, async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Full garbage collection requires Chromium CDP.');
        await page.goto('/en/a');
        await idle(page);
        if (granted) {
            await page.evaluate(() => Consent.choose({ analytics: true }));
            await idle(page);
        }
        await page.evaluate(() => { window.fixtureOldFragments = []; });
        for (let index = 0; index < 12; index++) {
            await page.evaluate(index => {
                const fragment = document.createElement('section');
                fragment.id = 'fragment-' + index;
                fragment.innerHTML = `<template data-consent-block="fragment-${index}" data-consent-category="analytics"><script>window.fixtureFragments = (window.fixtureFragments || 0) + 1; document.getElementById('fragment-${index}').append(document.currentScript);</script></template>`;
                document.body.append(fragment);
            }, index);
            await idle(page);
            if (granted) {
                await page.evaluate(() => document.querySelector('section template').remove());
                await idle(page);
            }
            await page.evaluate(() => {
                const fragment = document.querySelector('section');
                fixtureOldFragments.push(new WeakRef(fragment));
                fragment.remove();
            });
            await idle(page);
        }
        await collect(page);
        expect(await page.evaluate(() => fixtureOldFragments.filter(ref => ref.deref()).length)).toBe(0);
        expect(await page.evaluate(() => window.fixtureFragments || 0)).toBe(granted ? 12 : 0);
    });
}

test('execution copies are retained only while a script chain needs them', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Full garbage collection requires Chromium CDP.');
    let release;
    await page.route('**/fixture/copy.js', async route => {
        await new Promise(resolve => { release = resolve; });
        await route.fulfill({ contentType: 'application/javascript', body: 'window.fixtureCopyLibrary = true;' });
    });
    await page.goto('/en/a');
    await idle(page);
    await page.evaluate(() => {
        window.fixtureCopies = [];
        const clone = DocumentFragment.prototype.cloneNode;
        DocumentFragment.prototype.cloneNode = function (...args) {
            const copy = clone.apply(this, args);
            if (this.textContent.includes('fixtureCopyTail')) fixtureCopies.push(new WeakRef(copy));
            return copy;
        };
        document.body.insertAdjacentHTML('beforeend', '<template data-consent-block="copy" data-consent-category="analytics"><script src="/fixture/copy.js"></script><script>window.fixtureCopyTail = fixtureCopyLibrary;</script></template>');
    });
    await idle(page);
    expect(await page.evaluate(() => fixtureCopies.length)).toBe(0);
    await page.evaluate(() => Consent.choose({ analytics: true }));
    await expect.poll(() => typeof release).toBe('function');
    await collect(page);
    expect(await page.evaluate(() => fixtureCopies.filter(ref => ref.deref()).length)).toBe(1);
    release();
    await idle(page);
    expect(await page.evaluate(() => fixtureCopyTail)).toBe(true);
    await collect(page);
    expect(await page.evaluate(() => fixtureCopies.filter(ref => ref.deref()).length)).toBe(0);
});

test('an in-flight chain releases its removed owner without starting the detached tail', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Full garbage collection requires Chromium CDP.');
    let release;
    await page.route('**/fixture/removed.js', async route => {
        await new Promise(resolve => { release = resolve; });
        await route.fulfill({ contentType: 'application/javascript', body: 'window.fixtureRemovedLibrary = true;' });
    });
    await page.goto('/en/a');
    await idle(page);
    await page.evaluate(() => {
        const owner = document.createElement('section');
        owner.id = 'removed-owner';
        owner.innerHTML = '<template data-consent-block="removed" data-consent-category="analytics"><script src="/fixture/removed.js"></script><script>window.fixtureRemovedTail = true;</script></template>';
        document.body.append(owner);
        return Consent.choose({ analytics: true });
    });
    await expect.poll(() => typeof release).toBe('function');
    await page.evaluate(() => {
        const owner = document.getElementById('removed-owner');
        window.fixtureRemovedOwner = new WeakRef(owner);
        owner.remove();
    });
    await collect(page);
    expect(await page.evaluate(() => fixtureRemovedOwner.deref() === undefined)).toBe(true);
    release();
    await idle(page);
    expect(await page.evaluate(() => fixtureRemovedLibrary)).toBe(true);
    expect(await page.evaluate(() => window.fixtureRemovedTail)).toBeUndefined();
    const token = await page.evaluate(() => fixtureDocument);
    await page.evaluate(() => Consent.rejectOptional());
    await page.waitForFunction(old => fixtureDocument !== old, token);
    await idle(page);
    expect(await page.evaluate(() => Consent.allowed('analytics'))).toBe(false);
});
