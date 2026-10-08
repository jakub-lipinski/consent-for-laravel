# Google Consent Mode v2 and presets

The package provides a gtag.js consent bridge and built-in GA4 / Google Ads initialization. The package is not a Google-certified CMP and does not certify a site's legal compliance.

## Quick setup

Publish the configuration and enable the required preset in `config/consent.php`:

```php
'presets' => [
    'ga4' => [
        'enabled' => true,
        'measurement_id' => env('CONSENT_GA4_ID'),
        'send_page_view' => true,
    ],
    'google_ads' => [
        'enabled' => true,
        'conversion_id' => env('CONSENT_GOOGLE_ADS_ID'),
    ],
],
```

```dotenv
CONSENT_GA4_ID=G-XXXXXXXXXX
CONSENT_GOOGLE_ADS_ID=AW-123456789
```

Replace the example IDs with your own. Either preset can be enabled independently. No manual service definition, vendor bootstrap, or `@consent` block is needed for a preset:

```blade
<head>
    <x-consent::head :nonce="$cspNonce" />
</head>
<body>
    {{-- Application content --}}
    <x-consent::banner :nonce="$cspNonce" />
</body>
```

Omit nonce props when the host does not use nonce-based CSP. Render the head before any Google tag, config, event, or consumer of `Consent`. Remove old standalone gtag snippets and duplicate GA4/Ads installations, including tracking supplied by another package. A detected preexisting gtag, populated/non-array dataLayer, or Google bootstrap script makes the runtime fail closed with a `configuration` diagnostic. The package cannot undo earlier requests.

## Basic and Advanced

`google.enabled` defaults to `null`: automatically enable the bridge when a preset is enabled. `true` enables consent signals for custom gated gtag code without requiring a preset. `false` disables the bridge and is rejected alongside enabled presets. `google.mode` defaults to `basic`.

**Basic** queues consent commands locally but makes no Google tag request while pending or refused. After a valid grant, it loads one shared gtag.js library using the first allowed destination's ID and configures only allowed destinations. Analytics alone never configures Ads. Granting another category later reuses that library. Each destination initializes once per document.

**Advanced** is explicit:

```php
'google' => ['enabled' => null, 'mode' => 'advanced'],
```

Enabled presets load and configure while optional consent is denied. Google's tags can then send cookieless measurement pings. This is processing before consent, not a promise of zero requests or zero personal data. Decide whether this is appropriate for the site's processing and jurisdiction, explain it in the policy, and test the actual network. The built-in banner and dialog display an additional English/Polish disclosure. The event helper still refuses optional events without permission. Custom `@consent` blocks remain gated in both modes; Advanced changes built-in presets only.

## Signals and ordering

Every page begins with denied optional defaults, followed by the restored/current decision before measurement configuration. A persisted change updates Google synchronously before change listeners, new script activation, or withdrawal reload.

| Signal | Mapping |
| --- | --- |
| `analytics_storage` | Analytics |
| `ad_storage` | Marketing |
| `ad_user_data` | Marketing |
| `ad_personalization` | Marketing |
| `personalization_storage` | Marketing |
| `functionality_storage` | Always denied; no functionality preset is supplied |
| `security_storage` | Granted for necessary security storage |

The bridge sets `ads_data_redaction: true` and `url_passthrough: false`. Presets disable Google signals and ad personalization signals; category acceptance does not enable these optional product features. Do not add conflicting global commands outside the package. Region-specific defaults, enhanced conversions, user ID, user-provided data, and arbitrary gtag configuration are not provided by the package.

```javascript
const signals = Consent.google.state();
```

This returns a frozen mapped snapshot, not proof of Google's delivery or a valid audit record. The method exists even without an enabled bridge; it does not itself load Google.

## Events and conversion routing

Use an explicit registered destination:

```javascript
const queued = await Consent.google.event('G-XXXXXXXXXX', 'purchase', {
    transaction_id: 'order-123',
    value: 49.90,
    currency: 'PLN',
});

const conversionQueued = await Consent.google.event(
    'AW-123456789/YOUR_CONVERSION_LABEL',
    'conversion',
    { transaction_id: 'order-123', value: 49.90, currency: 'PLN' },
);
```

`event(destination, name, parameters = {})` returns a promise resolving to `true` when the command was queued, or `false` when permission/initialization is unavailable. It captures JSON parameters and checks permission when called, waits for preset initialization, and rechecks permission immediately before queueing. It does not remember denied events for later replay, confirm network delivery, or deduplicate transactions for you. Use your actual Ads conversion label; enabling Ads alone sends no conversion event. Keep personally identifying data out of ordinary event parameters and assess the provider's applicable data rules.

Invalid destinations, missing Ads labels, non-conversion Ads events, invalid event names, non-object parameters, and `send_to` / `event_callback` overrides reject with `TypeError`. GA4 uses its exact registered ID. Ads requires its registered `AW-...` ID plus a label of 1-128 letters, digits, underscores, or hyphens. Event names start with a letter and use letters, digits, or underscores up to 40 characters. Provider-specific event parameter validation remains the application's responsibility.

For SPA navigation, set `ga4.send_page_view` to `false` and send the intended `page_view` through this helper after each permitted navigation. Re-grant after active withdrawal occurs on the reloaded document, preventing an old tracker instance from silently resuming.

## Preset configuration and cleanup

Both presets accept actual boolean `enabled` (default `false`), optional canonical `name` / `description`, and optional `cookie_path` (default `/`) / `cookie_domain` (default `null`). GA4 additionally accepts boolean `send_page_view` (default `true`). Unknown keys are rejected. IDs must match `G-` plus 4-32 uppercase letters/digits, or `AW-` plus 1-20 digits starting with 1-9. Disabled definitions are also validated; a disabled ID can be null.

Enabled GA4 registers `google-ga4` in analytics with `_ga` and `_ga_` cleanup rules. Enabled Ads registers `google-ads` in marketing with `_gcl_` rules. These IDs must not collide with custom services. Default purposes have English and Polish display translations. Canonical overrides take precedence over built-in default wording; `consent::services` translations can still explicitly override display fields. Describe the real processing rather than relying on generic defaults.

Match cleanup scopes to the cookies actually written by the vendor. Google can choose a parent-domain cookie automatically; if appropriate, explicitly set the matching domain:

```php
'ga4' => [
    'enabled' => true,
    'measurement_id' => env('CONSENT_GA4_ID'),
    'cookie_domain' => '.example.com',
    'cookie_path' => '/',
],
```

These options declare deletion scope, not gtag cookie configuration. Additional scopes require custom cookie rules in separately named service definitions. Only declared visible first-party cookies can be removed; HttpOnly, third-party, other storage, or previous remote processing cannot be erased by this library.

Active preset withdrawal always reloads, even if a custom `onRevoke` hook uses `reload: false`. Google has no complete cooperative stop lifecycle supplied by the package. GA4 is disabled immediately on Basic denial and on active Advanced withdrawal, and Google receives denied consent before cleanup/reload. In Advanced, a subsequent refused document again runs the explicitly enabled cookieless mode.

Changing enabled targets, IDs, mode, page-view settings, canonical purposes, or cleanup rules changes the service fingerprint. Old decisions become pending. With the bridge disabled and presets inactive, existing fingerprints are preserved. UI-only variant/translation/position/color changes do not invalidate or extend consent.

## CSP and verification

The dynamic Google loader inherits the head component's nonce and uses the existing timeout/cancellation path. Allow the required script, connection, image, and frame destinations according to your actual Google setup. A script nonce alone does not allow outbound measurement requests. Do not copy a broad CSP wildcard; inspect the provider's current guidance and your host's policy.

Use a staging property, the real site's CSP, browser network inspection, and Google Tag Assistant to verify actual vendor behavior. Test pending/refusal/restored grant, separate category grants, expiry, cross-tab changes, blocked cookies, blocked provider requests, and withdrawal. Local package checks use mock tags rather than sending measurements to a live Google property; they establish command ordering and lifecycle behavior, not vendor account configuration or legal certification.

Primary references checked for this milestone:

- [Google consent implementation and ordering](https://developers.google.com/tag-platform/security/guides/consent)
- [Basic and Advanced Consent Mode](https://developers.google.com/tag-platform/security/concepts/consent-mode)
- [gtag API reference](https://developers.google.com/tag-platform/gtagjs/reference)
- [Google privacy controls](https://developers.google.com/tag-platform/security/guides/privacy)
- [EDPB consent guidelines, including withdrawal](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf)

Google Consent Mode is a vendor signal protocol. It is not a substitute for the site's valid legal basis, accurate information, meaningful choices, or evidence obligations.
