# Consent for Laravel

A Laravel package for service-based cookie preferences and versioned consent persistence, with accessible customizable banners and browser script gating. Install the stable package from [Packagist](https://packagist.org/packages/jakub-lipinski/consent-for-laravel); [GitHub](https://github.com/jakub-lipinski/consent-for-laravel) hosts its source and releases.

**Current release: `v1.1.2`.** Includes matching Standard and Compact banners/preferences dialogs, Google Consent Mode v2, GA4, Google Ads, Meta Pixel and Microsoft Clarity presets, guarded events, and consent withdrawal. The built-in interface targets applicable WCAG 2.2 A and AA criteria, with automated and native browser verification. The package does not certify the accessibility or EU legal compliance of the host website.

## Requirements

- PHP 8.3+.
- Laravel 12-13.
- Composer 2.
- Laravel service provider auto-discovery.
- No database, migrations, frontend framework, or Node build step.

The package supplies consent components for the consuming application's layout. Documentation and presentation websites belong in a separate repository. Installation adds no standalone website, dashboard, or application routes.

## Installation

Run these commands in the root of the Laravel application where you want to use consent, alongside its `composer.json` and `artisan` files:

```bash
composer require jakub-lipinski/consent-for-laravel
php artisan vendor:publish --tag=consent-config
```

Composer resolves a compatible stable release directly from [Packagist](https://packagist.org/packages/jakub-lipinski/consent-for-laravel). No VCS entry, Git clone, or minimum-stability change is needed. Laravel discovers the provider automatically. Commit the application's `composer.json` and `composer.lock`; deploy with `composer install` to reproduce the locked version. Check your installed release with:

```bash
composer show jakub-lipinski/consent-for-laravel
```

Publishing `consent-config` creates `config/consent.php`. All presets are disabled and custom `services` is empty by default. With both components mounted and no optional purpose enabled, only the preferences launcher appears. Enable the presets you use and supply their IDs, or register and gate your custom scripts.

The default components embed the installed JavaScript and CSS, and include English/Polish translations without publishing them. Publish `consent-assets` only for separate browser files, `consent-views` for markup overrides, or `consent-translations` for wording changes. The package does not register routes. Use the built-in Blade interface, the browser API with your own interface, or the PHP API from your application's controllers or services.

For earlier VCS installs, see [switching to Packagist](#switching-from-vcs). For discovery or publishing problems, see [installation troubleshooting](#installation-troubleshooting).

## Quick start with GA4

After [installation](#installation), edit the existing `ga4` entry under `presets` in `config/consent.php`. The following is an excerpt; keep the other settings and presets:

```php
'presets' => [
    'ga4' => [
        'enabled' => true,
        'measurement_id' => env('CONSENT_GA4_ID'),
        'send_page_view' => true,
    ],
],
```

Set your actual measurement ID in the consuming application's `.env` or production environment:

```dotenv
CONSENT_GA4_ID=G-XXXXXXXXXX
```

All presets start disabled. Setting an ID alone does not enable a preset: `enabled` must be the boolean `true`. Add the components to the shared Blade layout used by your pages:

```blade
<head>
    <x-consent::head />
</head>
<body>
    {{-- Your application content --}}
    <x-consent::banner />
</body>
```

Place the head before any vendor code or code using `window.Consent`. The enabled preset registers the analytics purpose, and the browser runtime initializes GA4 after a valid grant, with no Google requests before permission in the default Basic mode. A preset needs no manual service definition or `@consent` wrapper. Remove duplicate GA4 snippets and installations.

Set `ui.policy_url` to your existing cookie policy URL, or create a page in your app and use its path, for example `/cookies`. The package does not create a policy route. Choose `ui.variant` (`standard` or `compact`), position, colors, and language as described under [the banner](#add-the-banner).

After editing configuration or `.env`, clear any cached configuration locally:

```bash
php artisan config:clear
```

During production deployment, rebuild with `php artisan config:cache` after environment values are set and restart long-running workers. Reload the browser page to receive the updated settings.

Verify a fresh private session before consent, refusal followed by reload, acceptance, and active withdrawal. In Basic mode GA4 should make no tag or measurement request before analytics permission or after refusal. A saved grant starts it; withdrawing after initialization reloads by default. Check the actual Network panel, policy link, keyboard interaction, and your own staging property.

### Google presets

Google Ads uses `presets.google_ads.enabled` and `conversion_id`, supplied by `CONSENT_GOOGLE_ADS_ID`. Optional Advanced mode explicitly permits cookieless pings before permission.

```javascript
await Consent.google.event('AW-123456789/YOUR_CONVERSION_LABEL', 'conversion', {
    transaction_id: 'order-123', value: 49.90, currency: 'PLN',
});
```

Use your registered destination and actual conversion label. The helper refuses events without permission and does not replay them later. Read the [complete Google integration guide](docs/google.md) for modes, mappings, setup, SPA page views, CSP, cookie scopes, and withdrawal limits.

## Meta Pixel and Microsoft Clarity

Edit the existing entries below, keeping any other presets you use, and supply their IDs through `CONSENT_META_PIXEL_ID` / `CONSENT_CLARITY_ID` in your application's environment. An ID alone does not enable either preset:

```php
'presets' => [
    'meta_pixel' => ['enabled' => true, 'pixel_id' => env('CONSENT_META_PIXEL_ID')],
    'clarity' => ['enabled' => true, 'project_id' => env('CONSENT_CLARITY_ID'), 'advertising' => false],
],
```

Use the existing head/banner components. Meta loads only with marketing permission; Clarity loads only with analytics permission. Clarity ad storage requires explicitly enabled advertising plus analytics and marketing permission. The presets register their purposes and cleanup rules automatically. Remove duplicate vendor snippets and enable Require cookie consent in your Clarity project.

```javascript
await Consent.meta.track('Purchase', { value: 49.90, currency: 'PLN' }, { eventID: 'order-123' });
await Consent.meta.trackCustom('NewsletterSignup');
await Consent.clarity.event('checkout-completed');
```

Helpers check permission at invocation and dispatch and never replay denied calls. Active withdrawal signals denial before reload and removes declared visible first-party cookies. See the [complete tracker guide](docs/tracker-presets.md) for setup, SPA events, masking, advertising, CSP, scopes, and upgrade notes.

## Add the banner

For custom scripts, [register their optional services](#register-services), then use the head/banner layout with gated script blocks as shown below. Built-in presets use the same components and manage their own SDK loading; they need no extra block:

```blade
<head>
    <x-consent::head />
</head>
<body>
    {{-- Your page content --}}
    <x-consent::banner />

    @consent('analytics', 'site-analytics')
        <script src="https://your-provider.example/analytics.js"></script>
    @endconsent
</body>
```

The provider URL is a placeholder. Each component renders once per response. No JavaScript framework, stylesheet import, npm installation, or application endpoint is required. The head component must precede code using `window.Consent`.

A visitor without a current decision sees the banner. Accept and reject have equal prominence; manage preferences opens a native modal showing necessary plus only the globally used optional categories. Optional switches start off. Changing a switch is a draft until Save preferences is activated. Closing either interface makes no decision and grants no optional permission.

After a saved choice, a small cookie icon reopens preferences. A saved refusal stays remembered. With no optional services, only the icon is shown, allowing visitors to read the necessary category. Withdrawing an active category uses the runtime's cleanup and default reload behavior.

### Variant, position, language, policy, and colors

```php
'ui' => [
    'variant' => 'standard',    // standard or compact; banner and preferences dialog
    'position' => 'bottom-left', // bottom-left, bottom-right, bottom-center
    'locale' => null,           // Follow the app locale; or explicitly en / pl
    'policy_url' => '/cookies',
    'colors' => [
        'accent' => '#245c49',
        'focus' => '#245c49',
    ],
],
```

`standard` preserves the original spacious card and preferences dialog. `compact` uses smaller cards/dialogs, less spacing, simpler corners, outlined choice buttons, and side-by-side acceptance/refusal on wider screens. In both variants, category purposes stay visible; complete service lists are initially collapsed in native, keyboard-accessible disclosures. Each has a visible arrow that changes direction when opened or closed. Both keep the same wording, actions, and consent behavior. Acceptance and refusal remain equally prominent. Compact changes presentation only and does not shorten purpose disclosures.

Both variants support all three positions and validated colors. Left and right use a card; center uses a wide horizontal layout on larger screens. Actions stack on small screens, and long content scrolls vertically. The launcher follows the chosen position. Omitted `variant` settings in existing published configurations default to `standard`.

The application locale selects Polish for `pl`, including `pl_PL` / `pl-PL`, and English otherwise. An explicit UI locale must be `en` or `pl`. Per-component overrides are available:

```blade
<x-consent::banner variant="compact" locale="pl" position="bottom-right" policy-url="/cookies" />
```

`policy_url` accepts an absolute website path or an HTTP(S) URL without credentials; null omits the link. Provide your site's actual cookie policy. Colors accept six-digit hex values. The available defaults are:

| Color key | Default | Role |
|---|---|---|
| `background` | `#ffffff` | Card, dialog, and icon background |
| `text` | `#182722` | Headings and ordinary text |
| `muted` | `#52625b` | Descriptions and secondary text |
| `accent` | `#245c49` | Choice buttons, links, and selected switches |
| `accent_text` | `#ffffff` | Text and switch thumb on the accent |
| `border` | `#e1e7e3` | Decorative dividers and card edges |
| `control` | `#67776e` | Outlined controls and unchecked switches |
| `focus` | `#245c49` | Keyboard focus outline |

The renderer rejects invalid colors and combinations below 4.5:1 for text, muted text, links, and button text, or below 3:1 for controls and focus against the UI background. Custom CSS and published view changes require their own accessibility checks. Changing variant, position, colors, or UI language does not invalidate or extend a decision.

### Translations and custom openers

```bash
php artisan vendor:publish --tag=consent-translations
php artisan vendor:publish --tag=consent-views
```

Edit `lang/vendor/consent/en/messages.php` or `pl/messages.php` for interface wording. Keep category purposes accurate. Service names and purposes fall back to their canonical registry metadata. To translate them without changing the consent fingerprint, add `lang/vendor/consent/pl/services.php`:

```php
return [
    'site-analytics' => [
        'name' => 'Statystyki strony',
        'description' => 'Pomiar odwiedzin i sposobu korzystania ze strony.',
    ],
];
```

Translations use Laravel's dot lookup; IDs containing dots need corresponding nested translation arrays. A material change of purpose still requires updating canonical service metadata or `policy_version`. If a shared HTML cache serves multiple languages, vary it by the application's locale.

Add a preferences entry to a footer or privacy page:

```blade
<button type="button" data-consent-open>Cookie preferences</button>
```

`window.Consent.openPreferences()` also opens the mounted interface and returns true when handled, or false when unavailable. Opening, closing, and draft changes never write a decision. The interface displays a retryable error if cookies cannot be saved and keeps optional processing blocked.

The banner does not steal focus on arrival. The modal supports Tab, Shift+Tab, Space, Escape, and focus return. An overlay yields when it would cover a focused host-page control. Without JavaScript, the runtime, or native dialog support, a readable fallback remains with the policy link when configured. Without JavaScript or the core runtime, optional scripts stay inert. See the [interface and accessibility guide](docs/interface.md) for verification, browser support, and integration responsibilities.

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

The components embed their scripts/styles by default and support a CSP nonce:

```blade
<x-consent::head :nonce="$cspNonce" />
<x-consent::banner :nonce="$cspNonce" />
```

Your application generates a fresh nonce and the matching HTTP CSP header. Activated scripts inherit that nonce unless they declare their own. To serve a separate file:

```bash
php artisan vendor:publish --tag=consent-assets
```

```blade
<x-consent::head :src="asset('vendor/consent/consent.js')" :nonce="$cspNonce" />
<x-consent::banner
    :style-src="asset('vendor/consent/consent.css')"
    :script-src="asset('vendor/consent/banner.js')"
    :nonce="$cspNonce"
/>
```

Republish assets with `--force` after upgrades and use your deployment's asset cache busting. Configuration is emitted before the runtime. Custom colors still emit a small inline theme style, so a matching style nonce remains necessary under a strict CSP. No npm installation or build step is needed in the consuming application.

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

`servicesVersion` is calculated from enabled service IDs, categories, names, descriptions, and non-empty cookie cleanup rules. Adding, enabling, disabling, removing, renaming, or changing the purpose/category/rules of an active service invalidates existing decisions. Reordering services, trimming outer whitespace, and editing disabled service metadata do not. Existing fingerprints are preserved when cookie rules are absent or empty.

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

The provider excludes only the configured preference cookie from Laravel's encryption middleware. It is intentionally readable by the runtime and uses `HttpOnly=false`. Session and CSRF cookie names and names starting with `remember_` are rejected as configuration collisions. [Laravel's cookie encryption behavior](https://laravel.com/framework/docs/13.x/responses#cookies-and-encryption).

The cookie stores preferences and version/timestamp metadata, without identity, IP address, or a visitor identifier. It is unsigned and user-editable: use it only for consent preferences, never authentication, authorization, or evidence of who made a decision. Malformed, incomplete, future-dated, overlong, expired, or incompatible values fail closed. The package has no database audit trail.

Responses passed to `persist()` or `forget()` receive `Cache-Control: private, no-store`. Do not share-cache personalized server-rendered consent output. Rebuild configuration and restart long-running workers after configuration changes. If the cookie name, path, or domain changes, old cookies must be cleaned up using their old scope; the new scope cannot delete them.

## Updating an existing installation

Review [release notes](https://github.com/jakub-lipinski/consent-for-laravel/releases) and [Packagist versions](https://packagist.org/packages/jakub-lipinski/consent-for-laravel), then update within your application's allowed constraint:

```bash
composer update jakub-lipinski/consent-for-laravel
```

Commit the resulting lock file and deploy with `composer install`. Merge new options into `config/consent.php`, keeping your IDs, descriptions, cookie scopes, policy version, and UI choices. Compare customized published views and translations with the new package; do not force-publish over application customizations. Republish and cache-bust separate assets when used, refresh config/view caches, and restart persistent workers. Inline components use the installed sources directly.

### Switching from VCS

If you followed the previous guide and added `repositories.consent`, remove that entry before resolving the package from Packagist:

```bash
composer config --unset repositories.consent
composer update jakub-lipinski/consent-for-laravel
```

If you used another key, remove that entry instead. Preserve repositories for intentional forks or local package development, and keep the package in `require`. No minimum-stability change, uninstall, or cookie migration is needed. Published configuration and customizations stay in place. Commit both Composer files.

## Installation troubleshooting

- **Composer cannot find the package:** use the exact name `jakub-lipinski/consent-for-laravel`, check PHP/Laravel requirements, and run `composer diagnose` or `composer show --all jakub-lipinski/consent-for-laravel`. Check network access, private mirrors, and whether Packagist is disabled. If metadata predates publication, run `composer clear-cache` and retry.
- **No publishable resources for `consent-config`:** confirm installation with `composer show`. If Composer scripts were disabled, run `composer dump-autoload` and `php artisan package:discover`. Check `extra.laravel.dont-discover` in the app's `composer.json`; if you intentionally disable discovery, add `ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider::class` to its existing `bootstrap/providers.php` array.
- **An ID is set but the tracker does not start:** enable its preset with boolean `true`, refresh cached configuration, and reload. Pending or denied categories keep optional SDKs inactive. Check duplicate vendor snippets, the correct category, browser console/network errors, and CSP.
- **Only the preferences icon appears:** the default config has no optional service. Enable a preset or register a custom service; a saved acceptance or refusal also shows the launcher rather than the initial notice.

## Development

```bash
composer install
npm ci --ignore-scripts
composer format
composer check
```

Node is used only for package development tests. The package follows [Spatie's Laravel package conventions](https://github.com/spatie/package-skeleton-laravel), using [Laravel Package Tools](https://github.com/spatie/laravel-package-tools). See [CONTRIBUTING.md](CONTRIBUTING.md) for compatibility checks and [the release notes](docs/releases/v1.1.2.md) for this release's scope and upgrade steps.

## License

[MIT](LICENSE.md).
