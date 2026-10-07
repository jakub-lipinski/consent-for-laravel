# Consent for Laravel

A Laravel package for service-based cookie preferences and versioned consent persistence, built toward customizable banners and straightforward analytics integrations.

**Current release: `v1.0.0-beta.2`.** This beta adds `@consent`, a browser runtime, ordered script loading, and consent withdrawal to the PHP foundation. The banner, translations, Google Consent Mode v2, and tracker presets remain planned. It does not yet provide a complete consent collection interface or claim EU legal compliance or WCAG conformance.

## Requirements

- PHP 8.3+.
- Laravel 12-13.
- Laravel service provider auto-discovery.
- No database, migrations, frontend framework, or Node build step.

## Installation

The package is under development. To use this checkout in a Laravel application, add a local path repository to the application's `composer.json`:

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

Then run:

```bash
composer require webcrafts-studio/consent-for-laravel:@dev
php artisan vendor:publish --tag=consent-config
```

No manual provider registration is required. Configure the package in `config/consent.php`, then rebuild your application's configuration cache if it is enabled:

```bash
php artisan config:cache
```

The package does not register routes. Use the browser API with your own interface, or the PHP API from your application's controllers or services.

## Register services

The service registry describes which purposes are used across your website. Registration does not load a script, create a tracker cookie, or invoke a vendor API.

```php
'services' => [
    'site-analytics' => [
        'category' => 'analytics',
        'name' => 'Site analytics',
        'description' => 'Measure visits and navigation to improve the website.',
    ],
    'campaign-measurement' => [
        'category' => 'marketing',
        'name' => 'Campaign measurement',
        'description' => 'Measure conversions from advertising campaigns.',
        'enabled' => true,
    ],
],
```

Every definition requires a stable ID, a valid category, a non-empty UTF-8 name, and a meaningful description of its purpose. IDs start with a letter and contain only letters, digits, dots, underscores, or hyphens, up to 128 characters. `enabled` defaults to `true` and accepts a boolean. Disabled definitions are validated but excluded from the active registry. Unrecognized service options are rejected.

The five categories are:

| Key | Purpose |
|---|---|
| `necessary` | Essential website operation and remembering preferences; always allowed |
| `analytics` | Audience and usage measurement |
| `marketing` | Advertising and campaign measurement |
| `performance` | Performance measurement and diagnostics |
| `other` | Additional purposes explained in the service description |

Assign categories according to the actual processing purpose. Necessary is not a shortcut for making an optional tracker run without consent. The package does not inspect or classify existing cookies.

```php
use ConsentForLaravel\ConsentForLaravel\ServiceRegistry;

$services = app(ServiceRegistry::class);

$services->all();                    // Enabled services, keyed by ID
$services->get('site-analytics');    // Immutable service metadata
$services->forCategory('analytics');
$services->categories();             // Necessary plus the used optional categories
$services->version();                // Deterministic fingerprint of active definitions
```

`categories()` returns `Category` enum cases in the order necessary, analytics, marketing, performance, other. With the example above, it returns only necessary, analytics, and marketing. Looking up an unknown or disabled service throws `InvalidArgumentException`.

## Read and record preferences

```php
use ConsentForLaravel\ConsentForLaravel\ConsentManager;

$consent = app(ConsentManager::class);
$state = $consent->read($request);

$state->hasDecision();
$state->allows('analytics');
$state->choices;
$consent->needsConsent($request);
```

No cookie, an invalid cookie, or an outdated decision returns a pending state: necessary is allowed and every optional category is denied. `needsConsent()` is false when there are no optional services. Reading never writes a cookie or extends its lifetime.

Record a decision only after an explicit user action:

```php
$decision = $consent->acceptAll();
$decision = $consent->rejectOptional();
$decision = $consent->choose(['analytics' => true, 'marketing' => false]);
```

These methods return an immutable `ConsentState`. They do not persist it until you attach it to a response:

```php
return $consent->persist($decision, response()->noContent(), $request);
```

`acceptAll()` grants only categories used by enabled services. `choose()` replaces the whole selection: omitted optional categories become denied. Values must be actual booleans. Unknown categories, rejection of necessary cookies, and grants for unused categories throw `InvalidArgumentException`.

A minimal application endpoint for explicit refusal in `routes/web.php`:

```php
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::post('/privacy/reject-optional', function (Request $request, ConsentManager $consent) {
    return $consent->persist(
        $consent->rejectOptional(),
        response()->noContent(),
        $request,
    );
});
```

Submit through Laravel's normal CSRF-protected web flow. Your application remains responsible for presenting purposes, collecting an explicit choice, validating submitted data, and deciding how its own code responds. Include the browser runtime below to gate declared scripts and handle changes to a running page.

To withdraw optional consent, persist `rejectOptional()` or a replacement selection. An explicit refusal is remembered so subsequent page visits do not repeatedly ask for consent. To remove the saved decision entirely:

```php
return $consent->forget(response()->noContent(), $request);
```

`forget()` expires the preference cookie using the same name, path, domain, and security attributes. The next request returns to the pending state. It does not delete vendor cookies or withdraw consent through vendor APIs.

## Gate scripts in Blade

Register each optional service in `consent.services`, then include the runtime once in your layout's `<head>`:

```blade
<x-consent::head />
```

Wrap the scripts for a category in the short directive. An optional second argument provides a stable block ID:

```blade
@consent('analytics', 'site-analytics')
    <script src="https://your-provider.example/analytics.js"></script>
    <script>
        window.siteAnalytics.initialize({ site: 'your-site' });
    </script>
@endconsent
```

The URL and API above are placeholders for your actual provider. The category must be used by a registered service. `@consent` always renders an inert HTML template, so a cached page can serve both accepted and undecided visitors. The browser reads current preferences and activates the scripts only when allowed, including immediately after a choice on the same page. With JavaScript disabled, optional scripts remain inert.

Libraries load before their following initialization code. Blocks execute in document order among currently allowed categories, once per document. Identical explicit IDs deduplicate identical blocks; conflicting contents report an error. Repeated external sources also deduplicate by URL, classic/module type, integrity, CORS, and referrer policy. Use stable IDs for partials and SPA fragments. IDs starting with `consent-auto-` are reserved for automatically generated IDs.

Blocks accept script elements, whitespace, and comments. They are not PHP conditions or general HTML wrappers: Blade expressions and includes still execute on the server. Do not put images, iframes, nested consent blocks, or tracking `<noscript>` fallbacks inside them. Other scripts and requests outside declared blocks are the application's responsibility.

### Record a browser choice

Call these methods from your interface's explicit user actions and handle rejected promises:

```js
await window.Consent.choose({ analytics: true, marketing: false });
await window.Consent.acceptAll();
await window.Consent.rejectOptional();

window.Consent.allowed('analytics');
window.Consent.state();
```

Each decision replaces the full selection and must be stored before optional scripts can start. `acceptAll()` grants only used categories. An explicit refusal is remembered; `forget()` removes the decision and returns to pending. Both PHP and browser APIs share the same cookie format, versions, retention, and strict boolean rules.

Withdrawing permission from running code reloads the page by default, using the new preferences. Removing a script element alone cannot stop an initialized tracker. A provider with a complete stop/resume API can opt into cooperative cleanup using `onRevoke()` and `onChange()`. See [the browser runtime guide](docs/browser-runtime.md) for lifecycle behavior, errors, cookie cleanup, CSP, and SPA integration.

### Cookie cleanup

Optionally declare first-party cookies created by each service:

```php
'site-analytics' => [
    'category' => 'analytics',
    'name' => 'Site analytics',
    'description' => 'Measure visits and navigation.',
    'cookies' => [
        ['name' => '_example', 'path' => '/', 'domain' => null],
        ['prefix' => '_example_', 'path' => '/', 'domain' => null],
    ],
],
```

Use exactly one `name` or `prefix` per rule; `path` defaults to `/` and `domain` to `null`. The browser removes matching visible cookies in the declared scope on refusal, expiry, invalidation, or denied startup. Preference, configured session, CSRF, and `remember_` cookies are protected. Third-party and HttpOnly cookies, other scopes, vendor storage, and remote data require their respective provider or server APIs.

### CSP and published assets

The head component embeds the runtime by default and supports a CSP nonce:

```blade
<x-consent::head :nonce="$cspNonce" />
```

Your application generates a fresh nonce and the matching HTTP CSP header. Activated scripts inherit that nonce unless they declare their own. To serve a separate file:

```bash
php artisan vendor:publish --tag=consent-assets
```

```blade
<x-consent::head :src="asset('vendor/consent/consent.js')" :nonce="$cspNonce" />
```

Republish assets with `--force` after upgrades and use your deployment's asset cache busting. Configuration is emitted before the runtime; the component renders once. No npm installation or build step is needed in the consuming application.

## Versions and expiry

Decisions contain:

```json
{
    "schemaVersion": 1,
    "policyVersion": "1",
    "servicesVersion": "sha256 fingerprint of enabled services",
    "choices": {
        "necessary": true,
        "analytics": true,
        "marketing": false,
        "performance": false,
        "other": false
    },
    "decidedAt": 1791374400,
    "expiresAt": 1806926400
}
```

The JSON above illustrates the format; the package generates the real fingerprint and timestamps. Times are UTC Unix seconds. Pending states have null timestamps and cannot be persisted as decisions. `ConsentState::toArray()` and JSON serialization expose the same structure.

Three versions have separate roles:

- The Composer release version comes from the Git tag.
- `schemaVersion` identifies the supported cookie format.
- `policy_version` is an application-owned string. Increment it whenever the consent policy or purposes change beyond the registered metadata.

`servicesVersion` is calculated from enabled service IDs, categories, names, descriptions, and non-empty cookie cleanup rules. Adding, enabling, disabling, removing, renaming, or changing the purpose/category/rules of an active service invalidates existing decisions. Reordering services, trimming outer whitespace, and editing disabled service metadata do not. Existing beta.1 fingerprints are preserved when cookie rules are absent or empty.

Acceptance and rejection both expire after `retention_days`, defaulting to 180. The setting accepts an integer from 1 to 365. Reads do not renew it. Expiry is checked at the exact second, even if a stale cookie is still present. Shortening retention invalidates decisions exceeding the new limit; increasing it does not extend an existing decision.

180 days is a configurable product default, not a universal EU legal expiry period. [CNIL recommends remembering acceptance and refusal for six months, subject to the context](https://www.cnil.fr/fr/cnil-direct/question/cookies-si-jai-refuse-ses-cookies-un-site-web-peut-il-me-redemander-de-les).

## Cookie configuration

```php
'policy_version' => '1',
'retention_days' => 180,
'cookie' => [
    'name' => 'consent_preferences',
    'path' => '/',
    'domain' => null,
    'secure' => null,
    'same_site' => 'lax',
],
```

The default is a first-party, host-only cookie, scoped to `/`, with `SameSite=Lax`. `secure: null` follows the request's HTTPS status. Configure Laravel's trusted proxies correctly behind a reverse proxy, or set `secure: true` on HTTPS-only deployments. `same_site` accepts `lax` or `strict`. Partial cookie configuration retains the other defaults.

The provider excludes only the configured preference cookie from Laravel's encryption middleware. It is intentionally readable by the runtime and uses `HttpOnly=false`. Session and CSRF cookie names are rejected as configuration collisions. [Laravel's cookie encryption behavior](https://laravel.com/framework/docs/13.x/responses#cookies-and-encryption).

The cookie stores preferences and version/timestamp metadata, without identity, IP address, or a visitor identifier. It is unsigned and user-editable: use it only for consent preferences, never authentication, authorization, or evidence of who made a decision. Malformed, incomplete, future-dated, overlong, expired, or incompatible values fail closed. The package has no database audit trail.

Responses passed to `persist()` or `forget()` receive `Cache-Control: private, no-store`. Do not share-cache personalized server-rendered consent output. Rebuild configuration and restart long-running workers after configuration changes. If the cookie name, path, or domain changes, old cookies must be cleaned up using their old scope; the new scope cannot delete them.

## Next betas

- `beta.3`: three banner positions, preferences modal, reopening button, colors, English/Polish, and accessibility against applicable WCAG 2.2 A and AA criteria.
- `beta.4`: Google Consent Mode v2, GA4, and Google Ads.
- `beta.5`: GTM bridge, consent template, and container configuration.
- `beta.6`: Meta Pixel and Microsoft Clarity.
- `beta.7`: integrated verification, documentation, and release preparation.

These are planned milestones. More betas can be released for fixes before `v1.0.0`. The publishable head view is available; this beta contains no banner or translation strings.

## Development

```bash
composer install
npm ci --ignore-scripts
composer format
composer check
```

Node is used only for package development tests. The package follows [Spatie's Laravel package conventions](https://github.com/spatie/package-skeleton-laravel), using [Laravel Package Tools](https://github.com/spatie/laravel-package-tools). See [CONTRIBUTING.md](CONTRIBUTING.md) for compatibility checks and [the beta release notes](docs/releases/v1.0.0-beta.2.md) for this release's scope.

## License

[MIT](LICENSE.md).
