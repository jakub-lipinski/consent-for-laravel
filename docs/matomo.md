# Matomo

Matomo is a web analytics platform available as a hosted Cloud service or on your own server. Its browser tracker sends visits and interactions to your instance's `matomo.php` endpoint for the configured website ID. Reports depend on that instance's settings and the data visitors permit you to collect.

The package provides a disabled-by-default preset, automatic service registration, strict analytics gating, and guarded browser helpers. Google configuration and GTM are not needed for Matomo.

## Enable the preset

After [installing the package and publishing its configuration](../README.md#install), edit the existing `matomo` entry inside your application's `consent.presets`:

```php
'matomo' => [
    'enabled' => true,
    'url' => env('CONSENT_MATOMO_URL'),
    'site_id' => env('CONSENT_MATOMO_SITE_ID'),
    'send_page_view' => true,
    'enable_link_tracking' => true,
    'cookie_path' => '/',
    'cookie_domain' => null,
],
```

Set the instance base URL and the website's numeric ID, as shown in Matomo's tracking settings:

```dotenv
# Self-hosted example, including an optional subdirectory:
CONSENT_MATOMO_URL=https://stats.example.com/analytics/
CONSENT_MATOMO_SITE_ID=3

# For Cloud, use your own account's URL instead:
# CONSENT_MATOMO_URL=https://your-account.matomo.cloud/
```

Use the base URL, without `matomo.js`, `matomo.php`, query parameters, credentials, or a fragment. The preset appends the script and collection endpoints. HTTP is supported for local testing; use HTTPS on HTTPS sites. Missing trailing slashes, host casing, and default ports are normalized. `site_id` accepts a positive integer or decimal string up to `2147483647`, without leading zeroes. Invalid definitions are rejected even when disabled.

Keep the two components in the shared Blade layout:

```blade
<head>
    <x-consent::head />
</head>
<body>
    {{-- Application content --}}
    <x-consent::banner />
</body>
```

Remove other Matomo/Piwik tracking snippets and Matomo tags in a tag manager before enabling this preset. It owns `_paq` and one tracker; pre-existing `_paq`, `Matomo`, `Piwik`, or Matomo/Piwik script tags cause initialization to fail closed. Do not dispatch measurements directly through these vendor APIs, because they bypass the package's event checks.

Rebuild Laravel's cached configuration and restart persistent workers after deployment. No manual service entry or `@consent` wrapper is needed for the preset.

## What happens automatically

Without a valid analytics grant, the package loads no Matomo SDK and sends no Matomo measurements. A marketing-only decision does not enable it. Google Advanced mode does not change this gate.

After analytics permission, the preset loads `matomo.js` once, configures your endpoint/site ID and cookie scope, gives Matomo consent for the current document, sends one page view, and enables automatic outlink/download tracking. The default page view includes the current URL, document title, and referrer. Matomo can derive visit counts, sources, device/browser details, geography, and other standard reports from the collected data; availability and accuracy depend on its configuration, including geolocation.

Each full document load with a restored, valid grant sends its own initial page view. Same-document SPA navigation needs an explicit `pageView` call. An optional refusal, stale decision, failed preference write, or blocked SDK does not produce a page view. Denied helper calls are never saved for later acceptance.

`send_page_view` disables only the initial page view. `enable_link_tracking` disables only automatic outlink/download listeners. Both are actual boolean values and default to `true`; manual helpers remain available when either is `false`.

The preset registers the reserved service ID `matomo` in `analytics`. Its purpose is displayed in all seven bundled languages. Optional canonical `name` and `description` overrides use the same translation rules as other presets. Unknown config keys and manual service ID collisions are rejected.

## Browser API

All helpers return `Promise<boolean>`: `true` means the command was dispatched to the tracker, not that a Matomo server stored it; `false` means permission or initialization prevented dispatch. Invalid arguments and calls to a disabled preset reject with `TypeError`. A vendor command exception rejects the call. Handle rejected promises as you would for the other preset helpers.

Permission is checked when called and immediately before dispatch. Calls accepted during SDK loading wait for initialization; withdrawal can still save immediately and cancels the pending measurement. Helpers use an ordered queue independent of custom script completion, so a gated module may await them. Do not await `Consent.whenIdle()` inside a gated module.

### Events

```js
await Consent.matomo.event('Account', 'Login');
await Consent.matomo.event('Checkout', 'Payment method selected', 'card');
await Consent.matomo.event('Product', 'Rating', 'Boots', 5);
```

Signature: `event(category, action, name?, value?)`. Category and action are required strings; name and numeric value are optional. This category is Matomo's event grouping, such as `Account`, not the consent category; every helper requires `analytics`. The value must be a finite, non-negative number.

### Goals

Create a goal in the Matomo website settings, then use its numeric ID:

```js
await Consent.matomo.goal(7);
await Consent.matomo.goal(8, 49.90);
```

Signature: `goal(id, revenue?)`. The ID must be an integer from 1 to `2147483647`; optional revenue is finite and non-negative. The preset does not create goals or configure their reporting rules.

### Internal search

```js
await Consent.matomo.search('winter boots', 'Products', 12);
await Consent.matomo.search('missing product', undefined, 0);
```

Signature: `search(keyword, category?, resultsCount?)`. Keyword is required; category is optional; the optional results count must be a non-negative safe integer. This explicitly records a search result action, independently of automatic search URL detection configured in Matomo.

### Links and downloads

```js
await Consent.matomo.link('https://partner.example.com/');
await Consent.matomo.link('/downloads/catalog.pdf', 'download');
```

Signature: `link(url, type = 'link')`. The type is `link` or `download`. Relative URLs resolve against the document base URL; only HTTP(S) URLs without credentials are accepted. Use this for interactions the automatic listeners do not cover, or disable those listeners to avoid measuring the same click twice.

### Page views and SPA navigation

```js
// Call after updating the URL and rendered document title.
await Consent.matomo.pageView();

await Consent.matomo.pageView({
    url: '/checkout',
    title: 'Checkout',
    referrer: '/cart',
});
```

Signature: `pageView({ url?, title?, referrer? } = {})`. URL and title default to their values at invocation. Relative URLs are accepted. Referrer defaults to the previous successfully dispatched page view's URL, or the document referrer for the first one. Set `referrer: ''` to explicitly omit it. The helper sets all three fields before tracking and only advances its remembered URL after dispatch.

For an SPA that already tracks its first route, set `send_page_view` to `false` and call the helper once per completed route. The package does not install router listeners, deduplicate application calls, or generate views for route changes without permission.

### E-commerce

Enable e-commerce for the website in Matomo and configure its currency. Helpers use that site currency; they do not accept a per-call `currency` field.

```js
await Consent.matomo.ecommerceCart({
    total: 199.80,
    items: [
        { sku: 'boots-42', name: 'Winter boots', category: ['Shoes', 'Winter'], price: 99.90, quantity: 2 },
    ],
});

// Call after the application confirms a successful order.
await Consent.matomo.ecommerceOrder({
    id: 'order-2026-1042',
    total: 251.75,
    subtotal: 199.80,
    tax: 45.95,
    shipping: 6,
    discount: 0,
    items: [
        { sku: 'boots-42', name: 'Winter boots', category: 'Shoes', price: 99.90, quantity: 2 },
    ],
});
```

`ecommerceCart({ total, items })` records a cart update. `ecommerceOrder({ id, total, subtotal?, tax?, shipping?, discount?, items })` records a completed order. Totals and optional money fields must be finite, non-negative numbers; values are supplied by your application and are not calculated by the helper. Use a stable, unique order ID and prevent duplicate success callbacks in the application.

`items` is required and may contain zero to 200 products. Each product requires a unique string `sku`; optional fields are `name`, `category`, `price`, and `quantity`. Category accepts a string or an array of up to five strings. Price is non-negative; quantity defaults to 1 and must be a positive safe integer. Product data is copied at invocation, and the tracker cart is cleared before and after every operation so products cannot leak into a later measurement. A changed permission stops a multi-command operation before its next command, including the final measurement.

Required strings and supplied optional strings must be non-blank, contain no control characters, and fit within 1024 JavaScript characters. URLs share this helper limit. Optional parameters may be omitted or set to `undefined`; unknown object fields are rejected.

## Consent, cookies, and withdrawal

Matomo is configured with `requireConsent`, rather than `requireCookieConsent`. The latter alone can allow tracking without cookies. The package clears any remembered native Matomo consent during initialization and uses `setConsentGiven` for the current document only. The package's versioned preference cookie remains the source of permission; Matomo does not remember a separate grant.

Active analytics withdrawal calls `forgetConsentGiven` synchronously before application consent-change listeners. It disables link tracking and heartbeat timers, asks Matomo to delete its cookies, and expires the declared browser cookies. Active or in-flight SDK withdrawal always reloads, even if an application hook returns `reload: false`. This cannot undo measurements already dispatched.

The preset configures the SDK with the same `cookie_path` and optional `cookie_domain` used for cleanup. On HTTPS documents it enables secure cookies. Cleanup uses the configured site-specific prefixes `_pk_id.<site>.`, `_pk_ses.<site>.`, `_pk_ref.<site>.`, `_pk_cvar.<site>.`, and `_pk_hsr.<site>.`, plus exact names `_pk_testcookie`, `mtm_consent`, `mtm_cookie_consent`, and `mtm_consent_removed`. Analytics cookies from a different site ID are not matched. Native Matomo consent markers are shared names; avoid independent trackers sharing this cookie scope.

Custom cookie prefixes, plugin cookies, extra domains/paths, cookies set by an earlier configuration, and HttpOnly cookies require explicit owner-managed cleanup. Preserve the application's encrypted session and CSRF cookies. The browser preference cookie is not an authorization mechanism or a server audit record.

## Loading, CSP, and deployment

The preset uses the existing ordered loader, timeout/recovery mechanism, and nonce inheritance. It runs after eligible Google, Meta, and Clarity presets and before custom Blade blocks. SDK load or initialization failure emits `consent:error` with code `matomo`, and is not retried in the same document. Independent permitted presets/blocks can continue after ordinary failure. A timeout uses the shared reload recovery path. A failed withdrawal signal preserves denial and requires reload.

For nonce CSP, pass your request's nonce to both components. Permit the Matomo script origin in `script-src` if your policy does not authorize dynamic scripts through a nonce/`strict-dynamic`. Permit the collection origin in `connect-src` and `img-src`; Matomo may use both beacon/XHR and image requests. Review the actual SDK/plugins installed on your instance for any additional requirements. A script nonce does not permit network connections or images. Test HTTPS, CSP, blockers, and real account reporting on the application's host.

Blade HTML remains independent of visitor preferences and safe for HTML caching. Keep locale-aware cache keys for translated UI. Published configuration and custom translation dictionaries need the new preset entry/wording. Republish and cache-bust `consent.js` if serving published assets; mixing an old runtime with a new enabled preset fails closed.

The preference schema is unchanged. Matomo disabled preserves existing service fingerprints. Enabling it or changing the normalized instance URL, site ID, automatic behavior, canonical purposes, or cookie scope invalidates old decisions; visitors must choose again. UI-only translations and presentation changes do not invalidate consent.

Local tests cover PHP configuration caching, consent fingerprints, seven translations, guarded helper behavior, loading failures, races, expiry, and cookie cleanup. Native Chrome verification uses a disposable Laravel host and the official Matomo SDK with a local collection endpoint; it checks emitted measurement payloads, cookies, CSP, modules, and UI behavior. It does not establish processing/reporting by a live Cloud account or self-hosted Matomo server. CI compatibility coverage and locally executed framework versions are separate claims.

## Primary references

Technical behavior and consent guidance were checked on 2026-10-10:

- [Matomo tracking consent](https://developer.matomo.org/guides/tracking-consent).
- [Matomo JavaScript tracker API](https://developer.matomo.org/api-reference/tracking-javascript).
- [Matomo SPA tracking](https://developer.matomo.org/guides/spa-tracking).
- [Matomo tracker cookies](https://matomo.org/faq/general/faq_146/).
- [Official Matomo tracker source](https://github.com/matomo-org/matomo/blob/5.x-dev/js/piwik.js).
- [Google consent behavior](https://developers.google.com/tag-platform/security/guides/consent), including why Google's Advanced mode is separate from Matomo gating.
- [EDPB Guidelines 05/2020 on consent](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf).
