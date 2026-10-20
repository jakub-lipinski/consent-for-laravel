'use strict';
const { test, expect } = require('@playwright/test');

for (const format of ['single', 'multi']) {
    test(`serialized HTML in a ${format}-file Livewire component stays inert while pending and refused`, async ({ page, request }) => {
        const before = (await (await request.get('/fixture/log')).json()).length;
        const response = await page.goto(`/en/serialized-${format}`);
        expect(response.status()).toBe(200);
        await page.evaluate(() => Consent.whenIdle());
        if (!await page.locator('#serialized-update').count()) test.skip(true, 'Livewire 4 file compilers.');
        expect(await page.evaluate(() => [window.fixtureSerializedLoads, window.fixtureSerializedValues, window.literal])).toEqual([undefined, undefined, undefined]);
        await page.locator('#serialized-update').click();
        await expect(page.locator('#serialized-count')).toHaveText('1');
        await page.evaluate(() => Consent.whenIdle());
        await page.evaluate(() => Consent.rejectOptional());
        await page.locator('#serialized-update').click();
        await expect(page.locator('#serialized-count')).toHaveText('2');
        await page.evaluate(() => Consent.whenIdle());
        expect(await page.evaluate(() => [window.fixtureSerializedLoads, window.fixtureSerializedValues, window.literal])).toEqual([undefined, undefined, undefined]);
        expect((await (await request.get('/fixture/log')).json()).length).toBe(before);
        await page.evaluate(() => Consent.choose({ analytics: true }));
        await page.evaluate(() => Consent.whenIdle());
        const expected = {
            value: '</script><script>', label: '</script> @endconsent', modern: '</script><script>',
            multiline: '\n</script>\n<script>window.literal = true;</script>\n@endconsent', count: 2,
        };
        expect(await page.evaluate(() => fixtureSerializedValues)).toEqual([expected]);
        await page.locator('#serialized-update').click();
        await page.waitForFunction(() => window.fixtureSerializedValues?.length === 2);
        await page.evaluate(() => Consent.whenIdle());
        expect(await page.evaluate(() => fixtureSerializedValues)).toEqual([expected, { ...expected, count: 3 }]);
        expect(await page.evaluate(() => fixtureSerializedLoads)).toBe(1);
        expect(await page.evaluate(() => window.literal)).toBeUndefined();
        expect((await (await request.get('/fixture/log')).json()).slice(before).filter(line => line === 'serialized')).toHaveLength(1);
    });
}
