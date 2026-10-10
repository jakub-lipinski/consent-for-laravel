# Microsoft Clarity

## When to Read This Reference

Read when configuring recordings/heatmaps, Clarity events, optional advertising signals, or masking private page regions.

## Configuration

Edit the existing entry inside `consent.presets`:

```php
'clarity' => [
    'enabled' => true,
    'project_id' => env('CONSENT_CLARITY_ID'),
    'advertising' => false,
],
```

```dotenv
CONSENT_CLARITY_ID=abc123def4
```

Use the real project ID, a string of 1–32 lowercase letters/digits. Remove other Clarity bootstraps. In the project settings, enable the provider's cookie-consent requirement and review masking. The preset registers `microsoft-clarity` in analytics. Advertising is off unless explicitly enabled; enabling it adds a separate marketing purpose, `microsoft-clarity-ads`.

## Automatic Measurements

The SDK loads only with analytics permission and performs its configured recordings, heatmaps, and navigation behavior. Marketing alone never loads it. Google Advanced does not change this gate.

| Permission/configuration | `analytics_Storage` | `ad_Storage` |
| --- | --- | --- |
| Analytics denied | denied | denied |
| Analytics allowed, advertising false | granted | denied |
| Analytics allowed, advertising true, marketing denied | granted | denied |
| Analytics and marketing allowed, advertising true | granted | granted |

These are the exact Clarity Consent API v2 field names. The preset supplies them; do not replace them with Google consent commands. Accept all does not turn advertising on when the configuration keeps it false.

## Additional Measurements

```js
await Consent.clarity.event('checkout-completed');
const signals = Consent.clarity.state();
```

`event(name)` requires analytics and initialized SDK. Names start with a letter and use up to 128 letters/digits/underscores/dots/hyphens. `state()` returns a frozen signal snapshot, works with the preset disabled, and does not load Clarity. Common dispatch semantics are in [browser API](../browser-api.md).

The package exposes no Clarity identify helper. Consent does not mask private content; use the actual project's masking rules and explicit markup when appropriate:

```blade
<div data-clarity-mask="true">
    {{-- Private account details --}}
</div>
```

## Consent and Withdrawal

Signals update before change listeners. Active analytics withdrawal, or active advertising withdrawal when enabled, requires reload. Declared first-party cleanup covers `_clck`/`_clsk`; match actual cleanup scopes in configuration. Do not reload/reinstall the SDK on every SPA route.

## Verification

Check the permission/configuration matrix, custom event names, masked regions, blocked SDK, and both analytics and advertising withdrawal. Inspect actual recordings in the configured project when available; a locally dispatched event does not prove reporting or masking in that account.

## Common Pitfalls

- Treating advertising as automatically enabled by Accept all.
- Granting analytics solely because marketing was accepted.
- Assuming consent makes sensitive page regions safe to record.
- Inventing a `Consent.clarity.identify()` API or using incorrect signal casing.
