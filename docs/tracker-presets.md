# Meta Pixel and Microsoft Clarity

The package provides optional ID-based presets. Both stay disabled by default and use strict browser gates, independently of Google's Basic/Advanced setting. No Meta or Clarity library request is made while the required category is pending or denied.

## Setup

Merge these settings into your published `config/consent.php`:

```php
'presets' => [
    // Keep your existing GA4 / Google Ads settings when needed.
    'meta_pixel' => [
        'enabled' => true,
        'pixel_id' => env('CONSENT_META_PIXEL_ID'),
        'send_page_view' => true,
    ],
    'clarity' => [
        'enabled' => true,
        'project_id' => env('CONSENT_CLARITY_ID'),
        'advertising' => false,
    ],
],
```

```dotenv
CONSENT_META_PIXEL_ID=123456789012345
CONSENT_CLARITY_ID=abc123def4
```

Replace these examples with your own IDs. Meta IDs must be strings of 1-20 digits, starting with 1-9. Clarity IDs must be strings of 1-32 lowercase letters/digits. Enabled presets require their ID; booleans must be actual booleans. Disabled definitions are validated too. Never use an access token in these browser-visible fields.

Continue using the existing layout:

```blade
<head>
    <x-consent::head />
</head>
<body>
    {{-- Your application --}}
    <x-consent::banner />
</body>
```

Remove previous vendor snippets, noscript pixels, tag-manager installations of these trackers, and duplicate manual services. Put the head before vendor code. The presets own their browser globals and reject existing `fbq`, `_fbq`, `clarity`, or matching bootstrap script elements. That failure leaves the package's optional scripts inert; it cannot undo another install's earlier requests. Do not wrap the built-in presets in `@consent`.

## Meta Pixel

The `meta-pixel` service uses `marketing`. Its default English/Polish purpose is shown automatically. The preset creates the vendor-compatible `fbq` queue with revoked consent, applies a current saved grant, then loads `https://connect.facebook.net/en_US/fbevents.js` only with marketing permission. It rechecks permission before `init` and the optional `PageView`. Initialization and automatic PageView happen once per document. There is no noscript tracking image, automatic matching payload, Conversions API request, or server-side event integration supplied by this preset.

### Standard and custom events

```javascript
try {
    const queued = await Consent.meta.track('Purchase', {
        value: 49.90,
        currency: 'PLN',
    }, { eventID: 'order-123' });

    await Consent.meta.trackCustom('NewsletterSignup', { source: 'footer' });
} catch (error) {
    // Handle invalid input or an unavailable provider API.
}
```

`track(name, parameters = {}, options = {})` calls the vendor's `track`; `trackCustom` calls `trackCustom`. Use Meta standard event names with `track` and your own names with `trackCustom`. The preset owns one Pixel ID; do not initialize other pixels through the same `fbq` global.

Parameters must be an object with JSON-serializable data. The optional options object accepts only `eventID`, a non-empty string up to 128 characters, for your own event deduplication strategy. An event ID does not add a server-side integration or deduplicate every repeated browser call automatically. Do not include personal data or sensitive page contents in event parameters.

Both helpers return `Promise<boolean>`: `true` means a command was submitted to the local vendor API, not delivered to Meta; `false` means permission or initialization was unavailable. They check consent at invocation and again immediately before dispatch. Calls made without permission are discarded, including calls behind an already queued acceptance. Failed or denied events are never replayed after a later grant. Invalid input or a disabled preset rejects. Payloads are captured at invocation so later mutations do not alter a pending event.

Event names accepted by the package start with an ASCII letter, use letters/digits/underscores/dots/hyphens, and are at most 128 characters. Meta can impose further restrictions on its own event schemas.

### SPA page views

Set `send_page_view` to `false` when your router owns page views. After a committed route change, call `Consent.meta.track('PageView')` once. Keep one head/runtime per document; remounting the banner or inserting Blade fragments must not initialize a second pixel. Events requested without permission are not retained for later navigation.

### Meta product settings

Review Events Manager's automatic events, matching, data-sharing, and event setup separately. The preset does not configure your Meta account or police code calling `fbq` directly. A marketing grant is not permission to send arbitrary identifiers, form values, or sensitive URLs. Review the actual processing and describe it in the host's policy.

## Microsoft Clarity

The `microsoft-clarity` service uses `analytics`, with an English/Polish recording and heatmap purpose. The preset installs a queue stub and loads `https://www.clarity.ms/tag/PROJECT_ID` only after analytics permission. It uses the recommended `consentv2` API, including its exact case-sensitive keys. Calls address the current `window.clarity` because the SDK replaces the stub.

In your Clarity project, enable **Require cookie consent** and review masking before production. Microsoft excludes sites/apps targeting users under 18 from Clarity use; review provider eligibility. The package passes site-level consent signals; it does not register as a Microsoft CMP partner or send a fabricated CMP source ID.

### Signals and optional advertising

| Visitor/configuration state | `analytics_Storage` | `ad_Storage` | Load Clarity |
| --- | --- | --- | --- |
| Pending, refused, or analytics denied | `denied` | `denied` | No |
| Analytics granted, default `advertising: false` | `granted` | `denied` | Yes |
| Analytics granted, advertising enabled, marketing denied | `granted` | `denied` | Yes |
| Analytics and marketing granted, advertising enabled | `granted` | `granted` | Yes |

Advertising remains off even after Accept all unless explicitly enabled in configuration. When you enable `presets.clarity.advertising`, the registry adds the separate `microsoft-clarity-ads` marketing purpose, so the marketing category appears even without another marketing tool. You can customize that purpose with `advertising_name` and `advertising_description`. Marketing alone never starts Clarity.

```php
'clarity' => [
    'enabled' => true,
    'project_id' => env('CONSENT_CLARITY_ID'),
    'advertising' => true,
    'advertising_description' => 'Your accurate Clarity advertising purpose.',
],
```

Both consent fields are sent before change listeners and before reload. Saved decisions, expiry, forgetting, external cookie updates, and storage failures use the same mapping; draft switches never signal a grant. Google consent settings do not substitute for Clarity's consent API.

### Clarity events and state

```javascript
const signals = Consent.clarity.state();
// Frozen { analytics_Storage: 'granted' | 'denied', ad_Storage: ... }.

try {
    const queued = await Consent.clarity.event('checkout-completed');
} catch (error) {
    // Handle invalid input or an unavailable provider API.
}
```

`event(name)` submits Clarity's custom event only with analytics permission and initialized SDK. It has the same promise, permission checks, no-replay rule, and package event-name rules as Meta events. `state()` only inspects signals, is available with the preset disabled, and never loads a tracker. No user identification API is supplied. Existing recording and SPA tracking remain the SDK's responsibility; do not reload the SDK on route changes.

### Masking and privacy

Consent does not remove sensitive content from recordings. Configure the project's masking and use explicit masks for private regions:

```blade
<div data-clarity-mask="true">
    {{-- Private account details --}}
</div>
```

Avoid sensitive data in URLs, event names, attributes, and CSS. Exclude recording entirely from pages where the configured masking and purposes are insufficient. The package does not change remote masking settings or delete historical recordings.

## Withdrawal and cleanup

Meta receives `fbq('consent', 'revoke')`; Clarity receives the new `consentv2` values synchronously before change listeners. Active preset withdrawal always requires a fresh document, even with a custom `onRevoke(..., { reload: false })` hook. This includes Clarity advertising withdrawal while analytics stays granted, and advertising withdrawal while its library is in flight. After reload, only still-allowed presets start again.

Clarity's denied mode can still perform limited cookieless tracking. The package therefore gates its library and reloads active withdrawal rather than treating a denied storage signal as a complete stop API. Removing a script element cannot stop already running code. Signals are best-effort SDK commands, not a guarantee that no in-flight request completes during navigation or that previously transmitted data disappears.

Declared first-party cleanup cookies are `_fbp`/`_fbc` for Meta and `_clck`/`_clsk` for Clarity. Each preset accepts `cookie_path` (default `/`) and `cookie_domain` (default `null`), plus optional canonical `name` and `description`. Match actual vendor cookies, especially parent domains on subdomains:

```php
'meta_pixel' => [
    'enabled' => true,
    'pixel_id' => env('CONSENT_META_PIXEL_ID'),
    'cookie_path' => '/',
    'cookie_domain' => '.example.com',
],
```

Cleanup declarations do not configure the SDK's cookie scope. Only accessible declared cookies at matching scopes can be deleted; third-party, HttpOnly, and remote stored data are outside this cleanup. Session, CSRF, remember-me, and preference cookies remain protected. Supply separate application processes for data access/deletion requests.

## CSP, errors, and verification

All preset bootstrap script elements inherit the head nonce, use the existing ordered loader and timeout, and initialize once. They run after eligible Google presets and before custom Blade blocks. Failed presets emit `consent:error` with code `meta` or `clarity` and are not retried in the same document. Ordinary load/initialization failures do not prevent independent permitted presets or blocks; a load timeout requests a fresh document through the shared loader and stops further activation. A withdrawal signal failure still preserves denial and requires reload.

For production CSP, permit the required script, connection, and image origins after reviewing the vendors' current policies. Clarity documents `*.clarity.ms` and `c.bing.com`; Meta's bootstrap origin is `connect.facebook.net`. A nonce alone does not authorize fetches or images. Keep a nonce/strict-dynamic policy where appropriate and scope vendor origins to the required directives instead of copying a broad unsafe-inline policy. Validate real SDK behavior and account events on your host.

Local verification uses provider mocks to check queues, decisions, events, replacement APIs, cookie cleanup, timeout/race handling, nonce CSP, and UI behavior. It does not establish delivery to a live Pixel/Clarity project or certify legal compliance, vendor approval, or all assistive technologies.

## Deploying presets

Merge the new preset fields and English/Polish `messages.presets` translations. Reserved IDs are `meta-pixel`, `microsoft-clarity`, and, when advertising is enabled, `microsoft-clarity-ads`. Manual collisions are rejected. Customize views/translations deliberately and republish/cache-bust assets if using external files.

The cookie schema is unchanged. With these new presets inactive, existing fingerprints stay compatible, including Google-only installations. Enabling a preset or changing its ID, initialization options, purposes, advertising mode, or cleanup scope changes the service fingerprint and makes old decisions pending. Rebuild configuration and restart persistent workers.

## Primary references

Provider behavior was checked on 2026-10-08. Meta's developer documentation was rate-limited in this environment; its official maintained WooCommerce source confirms the bootstrap, queue, consent grant/revoke, events, and first-party cookie names. That source is a technical reference, not the package's consent policy.

- [Meta's official pixel implementation source](https://github.com/facebook/facebook-for-woocommerce/blob/main/facebook-commerce-pixel-event.php).
- [Meta Pixel consent documentation](https://developers.facebook.com/docs/meta-pixel/implementation/gdpr/).
- [Clarity Consent API v2](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2).
- [Clarity cookies](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-cookies).
- [Clarity client API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-api).
- [Clarity masking](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-masking).
- [Clarity CSP](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-csp).
- [EDPB consent guidance, section 5.2](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf).
