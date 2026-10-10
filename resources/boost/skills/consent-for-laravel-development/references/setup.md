# Setup

## When to Read This Reference

Read when installing the package, configuring purposes, updating an application, or investigating a missing banner/runtime.

## Installation

In the consuming Laravel application:

```bash
composer require jakub-lipinski/consent-for-laravel
php artisan vendor:publish --tag=consent-config
```

Provider discovery is automatic. Edit the existing `config/consent.php`; preserve its other sections. Configuration uses serializable arrays, strings, booleans, and null values. Keep `env()` calls in configuration files so Laravel's configuration cache works.

Render `<x-consent::head />` before tracking code or consumers of `window.Consent`, and `<x-consent::banner />` in the shared body. Defaults embed assets and require no application npm build. Use the application's CSP nonce when needed; see [custom scripts](custom-scripts.md).

## Configuration

| Section | Purpose |
| --- | --- |
| `policy_version`, `retention_days` | Decision validity and lifetime |
| `cookie` | Browser preference cookie settings |
| `services` | Custom providers and declared cookie cleanup |
| `presets`, `google` | Built-in integrations and Google Basic/Advanced |
| `loader` | Managed script and cleanup timeouts |
| `ui` | Presentation, translations, policy link, and diagnostics |
| `audit` | Optional database decisions and notice snapshots |

Only categories used by enabled services appear: `necessary`, `analytics`, `marketing`, `performance`, and `other`. Necessary stays allowed. Presets register their own services; custom service registration does not itself load scripts. See [custom scripts](custom-scripts.md) for a complete example.

All presets default to disabled, and custom services default to empty. With no optional purpose, a preferences launcher is expected instead of an initial banner. IDs alone do not enable presets; `enabled` must be the boolean `true`. Invalid definitions are validated even when disabled.

The registry applies across the application, not only the current route. Describe actual processing, set `ui.policy_url` to an existing policy page, and use distinct stable custom service/block IDs. Enabling/changing services or normalized integration settings changes the consent fingerprint; changing `policy_version` also invalidates decisions. Presentation changes preserve choices and expiry.

## Publishing and Updates

Publish only the resources the task needs:

| Tag | Use |
| --- | --- |
| `consent-config` | Application configuration |
| `consent-views` | Customized components |
| `consent-translations` | Edited wording or custom languages |
| `consent-assets` | External JS/CSS assets instead of embedded defaults |
| `consent-audit-migrations` | Optional audit tables; see [audit](audit.md) |

Inspect existing published files before replacing them. Merge package updates into custom views/translations/configuration. Refresh and cache-bust published assets together; old JavaScript can reject new preset configuration or lack audit support. Keep locale-aware HTML cache keys and invalidate stale cached notices when processing purposes change.

After local configuration changes:

```bash
php artisan config:clear
```

During deployment, rebuild configuration with `php artisan config:cache` after environment values are set, refresh view/page caches as appropriate, and restart persistent workers. Audit enablement/path changes also require rebuilding route caches. Follow the application's deployment process.

## Verification

Verify provider discovery, runtime configuration, component ordering, and the enabled purposes in preferences. Test with a fresh browser context and a restored decision. Use [verification](verification.md) for network and failure checks.

## Common Pitfalls

- Enabling every sample preset while using illustrative IDs.
- Overwriting the entire published configuration to add one entry.
- Adding a manual service with a reserved enabled preset ID.
- Loading a second tracker through a tag manager or another package.
- Treating HTML cache as visitor-specific consent storage.
