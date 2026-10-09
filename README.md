# Consent for Laravel

Service-based cookie preferences for Laravel, with ready-made banners, a native preferences dialog, and consent-aware script loading. Configure your purposes, add two Blade components, and let visitors accept, refuse, or change their choices.

**Stable release: `v1.1.3`.** PHP 8.3+ · Laravel 12–13 · MIT · No frontend framework, database, or npm build required in your application.

[Documentation](https://consent.lipinskijakub.pl/docs/introduction) · [Live preview](https://consent.lipinskijakub.pl/#preview) · [Packagist](https://packagist.org/packages/jakub-lipinski/consent-for-laravel) · [Releases](https://github.com/jakub-lipinski/consent-for-laravel/releases)

## What is included

- Matching Standard and Compact banners/preferences dialogs, three positions, editable colors and wording, and a reopening button.
- English and Polish translations in the stable release.
- Five purpose categories, versioned preferences, equal acceptance/refusal retention, and safe defaults without a valid decision.
- Cache-safe Blade script blocks with ordered loading, duplicate prevention, and permission checks before activation.
- GA4, Google Ads, Meta Pixel, and Microsoft Clarity presets, including Google Consent Mode v2.
- Consent withdrawal with declared cookie cleanup and a default reload when optional code is already running.
- Keyboard interaction, native modal semantics, responsive layouts, and optional non-blocking contrast diagnostics.

The additional languages, custom locale fallback, dark mode, and 72-hour warning suppression in this checkout are [unreleased](#unreleased-changes).

## Install

Run these in your existing Laravel application:

```bash
composer require jakub-lipinski/consent-for-laravel
php artisan vendor:publish --tag=consent-config
```

Laravel discovers the provider automatically. All presets are disabled and custom services are empty by default. With no optional purpose configured, only the preferences launcher appears. See [installation](https://consent.lipinskijakub.pl/docs/installation) for requirements, publishing options, and troubleshooting.

## Quick start with GA4

Enable the existing GA4 entry in your application's `config/consent.php`, keeping the other settings and presets:

```php
'ga4' => [
    'enabled' => true,
    'measurement_id' => env('CONSENT_GA4_ID'),
    'send_page_view' => true,
],
```

This entry belongs inside `presets`. Set your actual ID in the application's `.env`:

```dotenv
CONSENT_GA4_ID=G-XXXXXXXXXX
```

Add the components to your shared Blade layout:

```blade
<head>
    <x-consent::head />
</head>
<body>
    {{-- Your application content --}}
    <x-consent::banner />
</body>
```

The enabled preset registers its purpose and manages loading; no manual service or script wrapper is needed. In the default Google Basic mode, GA4 waits for analytics permission. Remove duplicate tracking snippets, set `ui.policy_url` to your real policy page, and refresh cached configuration after changes:

```bash
php artisan config:clear
```

During production deployment, use `php artisan config:cache` after setting environment values and restart long-running workers. Verify pending, refusal, acceptance, and active withdrawal in your application's browser Network panel. Setting an ID alone never enables a preset.

For other presets or your own scripts, follow [the complete quick start](https://consent.lipinskijakub.pl/docs/quick-start).

## Built-in integrations

| Preset | Environment ID | Required permission |
|---|---|---|
| `ga4` | `CONSENT_GA4_ID` | Analytics for Basic loading and guarded events |
| `google_ads` | `CONSENT_GOOGLE_ADS_ID` | Marketing for Basic loading and guarded conversions |
| `meta_pixel` | `CONSENT_META_PIXEL_ID` | Marketing |
| `clarity` | `CONSENT_CLARITY_ID` | Analytics; advertising also requires explicit enablement and marketing |

Google Advanced is an explicit opt-in that allows tags and cookieless pings before permission. Meta and Clarity remain strictly gated. Read the [integration guides](https://consent.lipinskijakub.pl/docs/integrations) for account settings, events, CSP, cookie scopes, and withdrawal.

## Your own scripts

[Register the service and its purpose](https://consent.lipinskijakub.pl/docs/services-and-categories), then gate its scripts:

```blade
@consent('analytics', 'site-analytics')
    <script src="https://your-provider.example/analytics.js"></script>
@endconsent
```

The URL is a placeholder for your provider. The head component must precede gated code. Blocks render as inert templates and activate in the browser only when permitted, including after a choice on the same page. Registration alone does not load code; requests outside this flow remain your responsibility. See [Blade directives](https://consent.lipinskijakub.pl/docs/blade-directives).

## Customize the interface

Edit the existing `ui` section. These options work in stable `v1.1.3`:

```php
'variant' => 'compact',
'position' => 'bottom-right',
'locale' => null,
'policy_url' => '/cookies',
'validate_contrast' => false,
'colors' => [],
```

Choose `standard` or `compact`, and `bottom-left`, `bottom-right`, or `bottom-center`. A null locale follows the application; stable explicit overrides accept `en` or `pl`. Provide your own policy page. Empty colors inherit package defaults; override selected keys with six-digit HEX values. Contrast diagnostics preserve chosen colors and never interrupt rendering.

No asset or translation publishing is required to use the defaults. Publish only for customization or external assets. See [banner and theme](https://consent.lipinskijakub.pl/docs/banner-and-theme), [translations](https://consent.lipinskijakub.pl/docs/translations), and [CSP and caching](https://consent.lipinskijakub.pl/docs/csp-and-caching).

## Unreleased changes

The following additions are implemented in this checkout but **not yet published on Packagist**:

- German, French, Italian, Spanish, and European Portuguese, plus custom locales with per-key parent-language and English fallback.
- Configuration-only `ui.theme`: `light`, `dark`, or `auto`, for both variants. Independent `colors` and `dark_colors` overrides default to empty arrays. No visitor-facing theme button is added.
- Both-palette contrast diagnostics with one logging attempt per identical palette/issue group every 72 hours through the app's default cache. Cache/logger failures preserve rendering.
- A config organized into Laravel-style sections, with supported values and commented color/service examples.

Existing configs retain the light default; these presentation changes preserve saved choices and their expiry. Stable `v1.1.3` rejects the new `theme` and `dark_colors` keys. Use the [unreleased upgrade guidance](https://consent.lipinskijakub.pl/docs/upgrading#unreleased-ui-update) only after installing a version containing these additions; update customized views and published CSS together. No new version or tag is announced here.

## Documentation and updates

The [documentation website](https://consent.lipinskijakub.pl/docs/introduction) contains the complete configuration reference and guides:

- [Configuration](https://consent.lipinskijakub.pl/docs/configuration), [translations](https://consent.lipinskijakub.pl/docs/translations), and [accessibility](https://consent.lipinskijakub.pl/docs/accessibility).
- [Browser API](https://consent.lipinskijakub.pl/docs/browser-api), [PHP API](https://consent.lipinskijakub.pl/docs/php-api), and [SPA integration](https://consent.lipinskijakub.pl/docs/spa-integration).
- [Persistence](https://consent.lipinskijakub.pl/docs/persistence), [withdrawal](https://consent.lipinskijakub.pl/docs/withdrawal), and [security](https://consent.lipinskijakub.pl/docs/security).
- [Upgrading](https://consent.lipinskijakub.pl/docs/upgrading), including earlier VCS installs, and [troubleshooting](https://consent.lipinskijakub.pl/docs/troubleshooting).

Update within your application's allowed Composer constraint, preserve your published customizations, commit the application's lock file, and refresh deployment caches. The package's source-oriented guides remain in [docs](docs/interface.md); release history is in [CHANGELOG.md](CHANGELOG.md).

The browser-readable preference cookie is user-editable and must not be used for authorization or an audit trail. The package provides consent tooling; it does not certify legal compliance or the accessibility of your host website. Describe actual purposes and test the integrated application.

## Development

```bash
composer install
npm ci --ignore-scripts
composer format
composer check
```

Node is used only for development tests. See [CONTRIBUTING.md](CONTRIBUTING.md) for compatibility and native browser verification.

## License

[MIT](LICENSE.md).
