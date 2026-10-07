# Consent for Laravel

A Laravel package being built for customizable cookie consent banners, preference management, and simple integrations with analytics and advertising tools.

**Status: initial package skeleton.** Cookie consent, banners, script blocking, Google Consent Mode v2, GA4, and Meta Pixel are not implemented yet. This version is for development, not production consent collection, and does not claim EU legal compliance.

## Package foundation

- Composer library: `webcrafts-studio/consent-for-laravel`.
- PHP 8.3+ and Laravel 12–13.
- Laravel service provider auto-discovery.
- Publishable `consent.php` configuration and `consent::` resource namespaces.
- Pest and Orchestra Testbench integration tests.
- Laravel Pint formatting, Larastan static analysis, and GitHub Actions.

The foundation is adapted from [Spatie's Laravel package skeleton](https://github.com/spatie/package-skeleton-laravel), using [Laravel Package Tools](https://github.com/spatie/laravel-package-tools). Publisher and namespace conventions follow the local Lens for Laravel package. Unused example commands, facades, models, and migrations have been omitted.

## Local development

```bash
composer install
composer check
```

To try the package in a separate Laravel application before publication, add a local path repository to that application's `composer.json` (adjust the path if needed):

```json
{
    "repositories": [
        {
            "type": "path",
            "url": "../consent-for-laravel",
            "options": { "symlink": true }
        }
    ]
}
```

Then run in the application:

```bash
composer require webcrafts-studio/consent-for-laravel:@dev
php artisan vendor:publish --tag=consent-config
```

The provider is discovered automatically. Configuration is intentionally empty until its features are implemented. The `consent-views` and `consent-translations` tags reserve the package's resource locations; their directories currently contain no user interface or translations.

## Intended scope

The next planning stage will cover necessary, preferences, analytics, and marketing categories; banner placement including left, center, and right; accepting, rejecting, customizing, and reopening preferences; consent-controlled script rendering; Google Consent Mode v2; and ready-to-use GA4 and Meta Pixel integrations.

Only the package foundation exists at this stage. The public consent API and behavior will be decided in the next stage.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks and compatibility testing.

## License

[MIT](LICENSE.md).
