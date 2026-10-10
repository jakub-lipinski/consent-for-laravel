---
name: consent-for-laravel-development
description: >-
  Configure and use Consent for Laravel in Laravel applications. Activate when
  working with this package's consent interface, tracking presets, guarded events,
  custom scripts, consent withdrawal, translations, or decision auditing.
license: MIT
metadata:
  author: jakub-lipinski
---

# Consent for Laravel Development

## Before Making Changes

Inspect the installed `jakub-lipinski/consent-for-laravel` version, `config/consent.php`, the shared layout, and existing tracking code. Follow the application's frontend and testing conventions. Keep other presets, services, published customizations, and explicit user choices when editing configuration.

Use the references below for the current task. Their examples describe this package's API; replace illustrative IDs, URLs, order data, and purposes with application values. Inspect the installed source if its version differs. Package-specific references are bundled here; do not assume Boost's documentation search indexes this third-party package.

## Basic Usage

The provider is auto-discovered. Include one runtime and banner in the shared layout:

```blade
<head>
    <x-consent::head />
</head>
<body>
    {{-- Application content --}}
    <x-consent::banner />
</body>
```

Enable only the requested presets through `consent.presets`, or define services for custom providers. An ID alone does not enable a preset. With no optional services, the interface shows only its preferences launcher. Built-in presets need no manual SDK snippet, service entry, or `@consent` wrapper.

## Task Reference

Read the relevant reference, rather than every file:

| Task | Reference |
| --- | --- |
| Install, configure services, refresh caches, or update published assets | [Setup](references/setup.md) |
| Change layout, colors, themes, languages, wording, or published views | [Interface](references/interface.md) |
| Gate a custom provider, ordered scripts, modules, or nonce CSP | [Custom scripts](references/custom-scripts.md) |
| Build consent controls, observe changes, synchronize choices, or implement cleanup | [Browser API](references/browser-api.md) |
| Read or persist preferences in PHP | [PHP API](references/php-api.md) |
| Enable database history, configure retention, or investigate audit failures | [Audit](references/audit.md) |
| Configure GA4/Google Ads or send Google events/conversions | [Google](references/integrations/google.md) |
| Configure Meta Pixel or send Meta standard/custom events | [Meta Pixel](references/integrations/meta-pixel.md) |
| Configure recordings, heatmaps, Clarity events, or advertising signals | [Microsoft Clarity](references/integrations/clarity.md) |
| Configure Matomo, goals, searches, links, SPA views, or e-commerce | [Matomo](references/integrations/matomo.md) |
| Configure TikTok Pixel, events, SPA views, or hash-based matching | [TikTok](references/integrations/tiktok.md) |
| Verify integration or investigate missing measurements, CSP, and loading failures | [Verification](references/verification.md) |

## Measurement Choices

| Integration | Required permission | Package-generated measurement after initialization |
| --- | --- | --- |
| GA4 | Analytics for Basic loading and event helpers | Initial page view by default |
| Google Ads | Marketing for Basic loading and conversions | Initializes the destination; no automatic conversion |
| Meta Pixel | Marketing | Initial PageView by default |
| Microsoft Clarity | Analytics; advertising also needs explicit enablement and marketing | SDK-managed recordings/heatmaps |
| Matomo | Analytics | Initial page view and automatic outlinks/downloads by default |
| TikTok Pixel | Marketing | Initial page view by default |

Google Advanced explicitly allows Google tags and cookieless pings before permission. It does not change other presets' gates or permit guarded events without their category. Do not infer business events from enabling a preset: measure purchases after the application confirms the order and registrations after successful completion.

## Verification

Use focused tests appropriate to the change and the application's browser. Check pending consent, explicit refusal, each relevant category, restored consent, and active withdrawal. For events, inspect destination, payload, and duplicate calls. For audit changes, verify a durable receipt and database rows. For UI changes, verify keyboard behavior, contrast, narrow viewports, and enlarged text. Use [verification](references/verification.md) for specific diagnostics.

## Common Pitfalls

- Duplicate vendor snippets or direct calls to `gtag`, `fbq`, `ttq`, `_paq`, or `clarity` bypass ownership or event checks.
- Request-cookie conditionals around tracking markup make cached HTML depend on the visitor. Use browser-gated blocks instead.
- Helpers return dispatch status, not proof of vendor delivery. Denied events are discarded, so do not save them for replay after acceptance.
- `Consent.choose()` replaces the full optional selection. Build it from the intended complete selection.
- `Consent.whenIdle()` includes custom module completion; awaiting it inside a gated module can deadlock. Preset event helpers may be awaited there.
- Removing a running script cannot stop its listeners or requests. Active built-in withdrawal requires reload, including with a custom `reload: false` hook.
- PHP cookie persistence is separate from the optional audit protocol. Opening preferences, reading consent, and rendering the page do not record a decision.
