# Consent for Laravel

## Scope

This repository is a Composer library, `jakub-lipinski/consent-for-laravel`, not a Laravel application. Version 1.1 includes the PHP consent foundation, inert Blade script blocks, a framework-free browser runtime, ordered loading, consent withdrawal, Standard/Compact variants of the three-position banner and native preferences dialog, validated colors, and English/Polish UI. Google Consent Mode v2, Basic/explicit Advanced gtag.js modes, and GA4/Google Ads presets are included. Meta Pixel and Microsoft Clarity presets are included with strict browser gating and mandatory reload after active withdrawal. Clarity advertising is opt-in and separately gated by marketing permission.

## Conventions

- Production code targets PHP 8.3+ and Laravel 12-13.
- Use the `ConsentForLaravel\ConsentForLaravel` PSR-4 namespace.
- Use Spatie Laravel Package Tools and provider auto-discovery.
- Configuration, views, and translations use `consent`; publishing tags are `consent-config`, `consent-views`, `consent-translations`, and `consent-assets`.
- Keep configuration serializable and compatible with Laravel configuration caching.
- Keep consent reads stateless and free of persistence side effects. Optional categories are denied without a current, valid decision.
- Keep Blade templates inert, independent of visitor preferences, and compatible with HTML caching. Gate scripts in the browser and recheck permission before each activation.
- Keep UI variants presentation-only, with the same consent actions, purposes, service details, and keyboard behavior. Missing variant configuration defaults to standard.
- Preserve script ordering and deduplication. Removing a script cannot stop running code; default to reload on active revocation unless the owner supplies complete cooperative cleanup.
- The browser-readable preference cookie is not an authorization mechanism or a database audit trail. Keep session and CSRF cookies encrypted.
- Do not add unused example facades, commands, migrations, or infrastructure.
- Keep documentation/presentation websites, dashboards, and standalone browser demo pages outside this repository. Native browser verification uses a disposable host application outside the package checkout.
- Do not hard-code a package version or commit `composer.lock` or `vendor`.
- Use verified repository URLs and the `jakub-lipinski` Composer publisher.
- Keep README capabilities accurate. An unimplemented feature or package skeleton must not be described as legally compliant.
- Verify current Google and EU primary sources before implementing consent policy.

## Validation

Run `npm ci --ignore-scripts` for development dependencies, `composer format` after PHP edits, and `composer check` before committing. Use focused Pest / Testbench and Node/jsdom tests. Verify modules, CSP, UI geometry, contrast, keyboard modality, reflow, and text resizing in a disposable host application outside this repository; axe/jsdom checks alone do not establish these behaviors. Compatibility claims must distinguish configured CI coverage from locally executed checks.
