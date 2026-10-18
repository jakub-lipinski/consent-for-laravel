# TikTok Pixel

TikTok Pixel is a browser tracker for TikTok advertising. Page visits and events sent to your configured Pixel can support advertising measurement, attribution, and audience/optimization features in TikTok Ads Manager. Available reports depend on the account, campaign, and matching settings.

The package provides a disabled-by-default preset, automatic service registration, strict marketing gating, and guarded browser helpers. Google configuration and GTM are not needed.

## Enable the preset

After [installing the package and publishing its configuration](../README.md#install), edit the existing `tiktok_pixel` entry inside your application's `consent.presets`:

```php
'tiktok_pixel' => [
    'enabled' => true,
    'pixel_id' => env('CONSENT_TIKTOK_PIXEL_ID'),
    'send_page_view' => true,
    'cookie_path' => '/',
    'cookie_domain' => null,
],
```

```dotenv
# Replace this illustrative code with your Pixel ID from TikTok Events Manager.
CONSENT_TIKTOK_PIXEL_ID=C1234567890ABCDEFGHI
```

The preset accepts a 20-character uppercase alphanumeric Pixel ID. An ID alone does not enable it. `enabled` and `send_page_view` must be actual booleans; invalid definitions are rejected even when disabled. Browser configuration contains this public ID, never an Events API access token.

Keep `<x-consent::head />` early in the shared Blade layout and `<x-consent::banner />` in its body. No manual service entry or `@consent` wrapper is needed. Remove previous TikTok snippets, tag-manager installations, and noscript pixels first. The preset owns `ttq` and one Pixel; existing `ttq`, `TiktokAnalyticsObject`, or TikTok Pixel script elements cause initialization to fail closed. Direct vendor calls bypass the package's event checks.

Rebuild Laravel's cached configuration and restart persistent workers after deployment. Republish and cache-bust published JavaScript; an old runtime rejects an enabled TikTok preset.

## What happens automatically

Without a current marketing grant, no TikTok SDK is requested and no TikTok measurement is dispatched. Analytics-only permission and Google's Advanced mode do not enable it. The local stub records consent signals only.

After permission, the preset loads TikTok's `events.js` once, waits for its second-stage Pixel runtime, applies current consent, and sends one `page()` call. Each full document load with a restored valid grant sends its own initial page view. Setting `send_page_view` to `false` disables this package-generated view and keeps manual helpers available.

The preset does not infer purchases, registrations, or other business events. Account-controlled automatic event detection, SPA handling, matching, cookie, and data-sharing settings may cause additional SDK behavior. Review those settings in Events Manager; disable overlapping automatic measurements when your application sends the same events explicitly.

The reserved service `tiktok-pixel` belongs to `marketing`. Its purpose is displayed in all nine bundled languages; optional canonical `name` and `description` overrides use the existing translation rules. Unknown config keys and manual service ID collisions are rejected.

## Browser API

Every helper returns `Promise<boolean>`. `true` means a command was dispatched to the local SDK, not that TikTok received or reported it. `false` means permission or initialization prevented dispatch. Invalid arguments or a disabled preset reject with `TypeError`; SDK exceptions reject the call.

Permission is checked at invocation and immediately before dispatch. Permitted calls wait for SDK initialization. Calls made without permission are discarded and never replayed after acceptance. Withdrawal cancels pending measurements and does not wait for the event queue. Gated modules may await these helpers; do not await `Consent.whenIdle()` inside a gated module.

### Standard and custom events

```js
await Consent.tiktok.track('ViewContent', {
    contents: [{ content_id: 'boots-42', content_type: 'product', quantity: 1 }],
});

await Consent.tiktok.track('CompleteRegistration');

// Call after the application confirms a successful order.
await Consent.tiktok.track('Purchase', {
    value: 199.80,
    currency: 'PLN',
    contents: [{ content_id: 'boots-42', content_type: 'product', price: 99.90, quantity: 2 }],
}, { eventID: 'order-2026-1042' });

await Consent.tiktok.trackCustom('NewsletterSignup', { source: 'footer' });
```

Signatures: `track(name, parameters = {}, options = {})` and `trackCustom(name, parameters = {}, options = {})`. Both use TikTok's `track` command. Use current TikTok standard names with `track`, and your own names with `trackCustom`; there is no separate vendor `trackCustom` command. The package accepts names starting with an ASCII letter, followed by letters, digits, or underscores, up to 50 characters. TikTok's own schema restrictions still apply.

Parameters must be a JSON object containing finite numbers and serializable JSON values. Functions, symbols, BigInt, `undefined` values, and circular references are rejected. Data is copied at invocation. Your application supplies the correct values, currency, product IDs, and business-event timing.

Options accept only a non-blank `eventID` string of 1–128 characters without control characters. It maps to TikTok's `event_id`; the preset supplies `pixel_code` for its own ID. A stable ID can participate in TikTok's browser/server deduplication rules when your separately implemented Events API sends the corresponding event and ID. It does not install a server integration or prevent every repeated browser call.

### SPA page views

```js
// Call after committing the route's URL and document title.
await Consent.tiktok.pageView();
```

Signature: `pageView()`. It calls TikTok's `page` API for the current document. For application-managed first routes, set `send_page_view` to `false`. The package adds no router listeners; avoid duplicate calls and review TikTok's automatic SPA settings.

### Optional Advanced Matching

```js
await Consent.tiktok.identify({
    sha256_email: normalizedEmailSha256,
    sha256_phone_number: normalizedPhoneSha256,
    external_id: stableUserIdSha256,
});
```

Signature: `identify(identity)`. Supply one or more of these three keys; every value must be a lowercase, 64-character hexadecimal SHA-256 digest. Normalize and hash identifiers in your application according to TikTok's matching guidance. Raw email addresses, telephone numbers, and IDs are rejected. This helper dispatches `identify` only with marketing consent; it does not automatically read user fields, generate hashes, or enable account-level automatic matching. Hashing does not make these identifiers anonymous. Supply matching identifiers before the relevant events when your account setup uses them.

## Consent, cookies, and audit

The local bootstrap starts with `holdConsent` and `revokeConsent`. Unlike a configuration that loads a held Pixel before consent, this preset also gates all SDK loading. Once its runtime is ready, it reapplies the current permission before page views or helper calls. The package's versioned preference decision remains the source of permission.

Marketing withdrawal sends `revokeConsent` synchronously before application change listeners and cancels queued events. Active or in-flight withdrawal always reloads, even if an application hook returns `reload: false`. It cannot undo measurements already dispatched or third-party processing.

Cleanup expires first-party `_ttp`, `ttclid`, `ttcsid`, `_tt_enable_cookie`, and names beginning with `ttcsid_` at the configured scope. `cookie_path` and `cookie_domain` describe cleanup only; they do not configure TikTok's native cookie scope. Match the actual site's cookies, and register owner-managed cleanup for additional paths/domains, former configurations, or plugin cookies. Third-party cookies on TikTok/Pangle domains and HttpOnly cookies cannot be removed by this browser runtime. Protected session, CSRF, preference, and audit identity cookies remain protected.

The existing optional audit includes TikTok's canonical purpose and translated banner/dialog in its signed notice and database snapshot. A new grant waits for a durable audit receipt. Refusal and withdrawal deny locally immediately, including when the database or receipt delivery fails. Rendering, reading consent, and measuring events do not create audit decisions.

The preference schema is unchanged. Disabled TikTok preserves existing fingerprints. Enabling it or changing the Pixel ID, initial page-view behavior, canonical purpose, or cleanup scope invalidates old decisions. UI translations, themes, positions, and variants remain presentation-only.

## Loading, CSP, and verification

TikTok uses the ordered loader after eligible Google, Meta, Clarity, and Matomo presets, before custom blocks. Both SDK stages have bounded waits; withdrawal can cancel either. Ordinary failures emit `consent:error` with code `tiktok`, leave helpers unavailable, and allow independent permitted integrations to continue. Timeout recovery uses a bounded session reload, including a separate marker for second-stage initialization. A failed consent signal preserves denial and requires reload.

Pass your request's CSP nonce to both Blade components. The controlled bootstrap inherits that nonce; TikTok creates additional scripts itself. Use nonce plus `strict-dynamic`, or authorize `https://analytics.tiktok.com` in `script-src` for those scripts. Allow required TikTok collection origins in `connect-src` and `img-src`; a nonce alone does not permit these requests. Review the current SDK and enabled account/plugins for additional origins, and test your actual CSP, blockers, and reporting.

Local tests cover configuration caching, fingerprints, bundled languages, audit writes, API payloads, loading order, expiry, failure/withdrawal races, protected cookies, and coexistence with existing presets. Native Chrome verification uses a disposable Laravel host, the official TikTok SDK, simulated Pixel settings, and intercepted collection endpoints. It verifies SDK requests and payloads, not processing or reports in a live TikTok Ads account. Configured CI coverage and locally executed PHP/Laravel versions are separate claims.

## Primary references

Technical behavior and consent guidance were checked on 2026-10-11:

- [TikTok Pixel consent mode](https://business-api.tiktok.com/portal/docs/pixel-cookie-consent-mode/v1.3).
- [TikTok standard events and parameters](https://ads.tiktok.com/resources/help/article/standard-events-parameters).
- [TikTok custom events](https://ads.tiktok.com/resources/help/article/custom-events).
- [TikTok event deduplication](https://ads.tiktok.com/resources/help/article/event-deduplication).
- [TikTok Pixel cookies](https://ads.tiktok.com/resources/help/article/using-cookies-with-tiktok-pixel).
- [Official TikTok GTM template](https://github.com/tiktok/gtm-template-pixel/blob/main/template.tpl), including event options and matching field mappings.
- [Google consent behavior](https://developers.google.com/tag-platform/security/guides/consent), which is separate from TikTok gating.
- [EDPB Guidelines 05/2020 on consent](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf).
