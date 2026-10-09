# Contributing

## Setup and checks

These commands develop the library itself. To add consent to a Laravel application, use [the Packagist installation](README.md#install) instead. For package development, clone [the source repository](https://github.com/jakub-lipinski/consent-for-laravel) and run the following in its root:

```bash
composer install
npm ci --ignore-scripts
composer format
composer check
```

Individual checks are available as `composer test`, `composer test:js`, `composer analyse`, `composer format:check`, and `composer validate --strict`. `composer check` runs all of them. Development JavaScript tests use Node 22.12+ on the 22.x line, or Node 24+, jsdom, and axe-core. Consuming applications need no Node installation or frontend build.

The Composer lock file is intentionally not tracked: this is a library, and compatibility must be tested against multiple dependency versions. The npm lock file is tracked for reproducible private development tests; the package is not published to npm. Release versions come from Git tags, not a hard-coded Composer version.

## Compatibility

Keep production code compatible with PHP 8.3 and Laravel 12-13. Development tooling can vary with the selected framework and PHP version.

GitHub Actions tests both Laravel majors on PHP 8.3 and 8.4 with lowest and highest dependencies. A workflow definition alone does not establish that every combination has passed.

To test a selected framework locally, temporarily constrain it and its matching Testbench version, for example:

```bash
composer require --dev 'laravel/framework:12.*' 'orchestra/testbench:^10.0' --no-update
composer update --with-all-dependencies
composer test
```

Restore `composer.json` to the intended library constraints after testing. Do not commit temporary framework pins.

## Package conventions

- Use PSR-4 under `ConsentForLaravel\ConsentForLaravel` and Laravel's service provider discovery.
- Keep package resources under the `consent` configuration and translation/view namespaces.
- Add options alongside implemented behavior; keep configuration compatible with `config:cache`.
- Cover new runtime behavior with focused integration tests.
- Document implemented features separately from planned capabilities.
- Verify Google and EU requirements against primary sources when implementing consent behavior. Do not describe the unfinished package as compliant.

The stable version 1 series includes service metadata, consent state, versioned cookie persistence, `@consent`, a framework-free browser loader, the English/Polish interface, and Google/Meta/Clarity integrations. Version 1.1 adds Standard and Compact variants for both the banner and preferences dialog. Variant selection is presentation-only and must preserve purpose descriptions, service details, equal choice prominence, draft behavior, keyboard access, and saved decisions. Unreleased changes add seven bundled languages, custom locale fallback, configuration-only light/dark/auto themes, and cache-backed 72-hour diagnostic suppression. Test both palettes even when inactive, preserve the light default for old configs, and keep theme resolution in CSS without writing visitor preferences. Do not describe these additions as a published stable release. The package registers no application routes or database schema. New server decision endpoints must remain in the host application and use its normal validation and CSRF protection.

JavaScript tests cover consent transitions, strict cookie validation, resource failures, ordering, duplicate blocks/sources, storage failures, cleanup, expiry, SPA fragments, and actual serialization through PHP. Set `CONSENT_TEST_PHP` to select the PHP executable used by the serialization and Blade interface fixtures when needed.

Native browser verification uses a disposable host Laravel application outside this package repository, with the package installed through a local Composer path repository. Keep its layout, mock provider scripts, and local server outside the package checkout. See [runtime checks](docs/browser-runtime.md#verification) and [interface checks](docs/interface.md#verification). The repository contains focused tests and JSON/Blade fragment fixtures, without a standalone website or dashboard.

UI tests use real Blade output and axe structural checks. Contrast and target size are disabled only in jsdom, which has no layout; run the full axe checks and manual keyboard/reflow checks in the disposable host application. jsdom also cannot prove CSP or module execution behavior. Use local mock providers during verification.

Stable releases use semantic version tags. Use prerelease tags for changes still undergoing validation, and mark stable GitHub releases as the latest release. Keep `CHANGELOG.md`, `README.md`, and the corresponding `docs/releases/` note accurate. The Composer version comes from the Git tag, never a hard-coded `version` field. Verify the exported archive in a disposable consumer before publishing. After publication, check that [Packagist](https://packagist.org/packages/jakub-lipinski/consent-for-laravel) exposes the intended stable version and source commit, and verify installation without a custom Composer repository. Consumer instructions should use `composer require jakub-lipinski/consent-for-laravel`; local path repositories are for development verification.
