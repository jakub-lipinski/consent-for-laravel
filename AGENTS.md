# Consent for Laravel

## Scope

This repository is a Composer library, `webcrafts-studio/consent-for-laravel`, not a Laravel application. Its current state is the initial package skeleton. Banner UI, consent persistence, script gating, Google Consent Mode v2, and tracker presets are planned but not implemented.

## Conventions

- Production code targets PHP 8.3+ and Laravel 12–13.
- Use the `ConsentForLaravel\ConsentForLaravel` PSR-4 namespace.
- Use Spatie Laravel Package Tools and provider auto-discovery.
- Configuration, views, and translations use `consent`; publishing tags are `consent-config`, `consent-views`, and `consent-translations`.
- Keep configuration serializable and compatible with Laravel configuration caching.
- Do not add unused example facades, commands, migrations, or infrastructure.
- Do not hard-code a package version or commit `composer.lock` or `vendor`.
- Use verified repository URLs; the Git remote is under `jakub-lipinski`, while the Composer publisher follows Lens's `webcrafts-studio` convention.
- Keep README capabilities accurate. An unimplemented feature or package skeleton must not be described as legally compliant.
- Verify current Google and EU primary sources before implementing consent policy.

## Validation

Run `composer format` after PHP edits and `composer check` before committing. Use focused Pest / Testbench tests for new behavior. Compatibility claims must distinguish configured CI coverage from locally executed checks.
