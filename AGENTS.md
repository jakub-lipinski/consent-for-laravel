# Consent for Laravel

## Scope

This repository is a Composer library, `webcrafts-studio/consent-for-laravel`, not a Laravel application. Beta.2 includes the PHP consent foundation, inert Blade script blocks, a framework-free browser runtime, ordered loading, and consent withdrawal. Banner UI, translations, Google Consent Mode v2, and tracker presets remain planned.

## Conventions

- Production code targets PHP 8.3+ and Laravel 12-13.
- Use the `ConsentForLaravel\ConsentForLaravel` PSR-4 namespace.
- Use Spatie Laravel Package Tools and provider auto-discovery.
- Configuration, views, and translations use `consent`; publishing tags are `consent-config`, `consent-views`, `consent-translations`, and `consent-assets`.
- Keep configuration serializable and compatible with Laravel configuration caching.
- Keep consent reads stateless and free of persistence side effects. Optional categories are denied without a current, valid decision.
- Keep Blade templates inert, independent of visitor preferences, and compatible with HTML caching. Gate scripts in the browser and recheck permission before each activation.
- Preserve script ordering and deduplication. Removing a script cannot stop running code; default to reload on active revocation unless the owner supplies complete cooperative cleanup.
- The browser-readable preference cookie is not an authorization mechanism or a database audit trail. Keep session and CSRF cookies encrypted.
- Do not add unused example facades, commands, migrations, or infrastructure.
- Do not hard-code a package version or commit `composer.lock` or `vendor`.
- Use verified repository URLs; the Git remote is under `jakub-lipinski`, while the Composer publisher follows Lens's `webcrafts-studio` convention.
- Keep README capabilities accurate. An unimplemented feature or package skeleton must not be described as legally compliant.
- Verify current Google and EU primary sources before implementing consent policy.

## Validation

Run `npm ci --ignore-scripts` for development dependencies, `composer format` after PHP edits, and `composer check` before committing. Use focused Pest / Testbench and Node/jsdom tests. Verify modules and CSP with the manual browser fixture, since jsdom cannot validate them. Compatibility claims must distinguish configured CI coverage from locally executed checks.
