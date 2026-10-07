# Contributing

## Setup and checks

```bash
composer install
composer format
composer check
```

Individual checks are available as `composer test`, `composer analyse`, `composer format:check`, and `composer validate --strict`.

The Composer lock file is intentionally not tracked: this is a library, and compatibility must be tested against multiple dependency versions. Release versions come from Git tags, not a hard-coded Composer version.

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

The first beta includes service metadata, consent state, and versioned cookie persistence. It registers no application routes and has no database schema, tracker requests, script loader, or frontend dependencies. New decision endpoints must remain in the host application and use its normal validation and CSRF protection.

Development releases use beta tags until the complete interface and integrations are ready. Keep `CHANGELOG.md`, `README.md`, and the corresponding `docs/releases/` note accurate for each milestone.
