# Livewire

Livewire support is optional. Supported baselines are Livewire 3.8.10+ and 4.4.7+, with Laravel 12-13 and PHP 8.3+. Applications without Livewire keep the same framework-free runtime and need no new frontend dependency, build, database migration or endpoint.

## Setup

Install Livewire normally in the application. Keep one runtime early in the shared head and one banner in the body, on every page participating in `wire:navigate`:

```blade
<head>
    <x-consent::head />
    {{-- Application / Livewire assets --}}
</head>
<body>
    {{ $slot }}
    <x-consent::banner />
</body>
```

The package neither installs Alpine nor starts Livewire. No dedicated consent Livewire component, `entangle`, or decision property is needed. Decisions still use `window.Consent` and its existing cookie/audit protocol.

Older published configurations inherit the new defaults:

```php
'livewire' => [
    'enabled' => true,
    'navigation' => 'auto', // auto | reload
],
```

`auto` coordinates SPA navigation; `reload` converts Livewire navigation into full visits. `enabled=false` disables special navigation/UI coordination. Generic fragment loading and protection against single-file script extraction remain. Navigation support requires the enabled adapter and current views/assets.

## Language changes

With `ui.locale=null` and no explicit banner locale, set the app locale before rendering the page or component:

```php
app()->setLocale($locale);
```

The banner follows that locale. Navigation replaces its text, labels, accessible names, status/error messages, service descriptions and signed audit notice together. An initially rendered banner inside a Livewire component also changes language when that component rerenders: its presentation key changes, replacing the complete UI/notice container. Ordinary morphs with unchanged presentation preserve the dialog draft. An intentional language replacement discards the draft and restores the saved choice.

Applications must preserve their selected locale in Livewire request middleware/session handling. The package renders the supplied application locale; it does not infer one from URLs or create a separate language cookie. Explicit `ui.locale` and `<x-consent::banner locale="pl" />` overrides retain their existing priority. Custom/regional languages use the [same fallbacks](interface.md#languages-and-custom-translations).

Prefer a global banner outside components. Do not first lazy-load the entire banner/bootstrap into a document without the UI runtime. Only one active consent interface is supported. Language changes, renders, visits and preference reads do not save a decision, create audit rows or extend expiry.

## Scripts and components

Register services globally and use ordinary inert script blocks with explicit stable IDs:

```blade
<div>
    @consent('analytics', 'site-statistics-loader')
        <script src="https://your-provider.example/statistics.js"></script>
        <script>window.siteStatistics.start();</script>
    @endconsent
</div>
```

The URL is a placeholder. Presets need no extra wrapper/bootstrap. The package supplies a Livewire key on its templates when Livewire is installed. Each logical ID must retain its category and code. Auto-generated IDs restart with a server render; do not use them, random values, timestamps or transient component IDs for dynamic shared bootstraps.

Identical blocks and SDKs load once per document, including across navigation/history. New blocks run only with permission. A removed block cannot start its remaining scripts; a preserved unchanged block pauses during navigation and resumes at its next script. Running code remains in the withdrawal lifecycle even after its template disappears.

Class-based, single-file and multi-file views support ordinary gated markup. Livewire 4 extracts some single-file scripts before Blade compilation; the package's preparation hook protects gated tokens, including unindented tags. Do not nest `@script`/`@assets` with `@consent`: Livewire owns that separate execution transport. Such nesting is rejected by the preparation hook and unsupported elsewhere. Separate application JavaScript modules, raw vendor calls and PHP/Livewire actions are not automatically gated.

Omit explicit script nonces inside a block to inherit the runtime nonce. Nonce-only differences between identical replacement copies do not conflict. An explicit invalid nonce is never repaired; mutation of the already discovered template remains an error.

The directive has a once-per-document lifecycle. Widgets needing initialization on every component mount must manage DOM references/cleanup through the application's lifecycle and recheck `Consent.allowed(category)` before optional work.

## Navigation, persistence and focus

New activations pause at `livewire:navigating`. The adapter checks the destination's runtime context, synchronizes current cookie/cleanup, then resumes after `livewire:navigated`. Canceled visits before the swap preserve the dialog/draft. A real swap closes the dialog without saving its draft or moving focus back to the departing page. The destination owns focus.

An inert head marker compares configuration and asset revisions. Changed policy/services, cookie scopes, loader settings or package assets require a fresh document before further activation; active tracker configuration is never hot-swapped. Missing/multiple markers also require recovery. An automatic same-tab retry is bounded to one; unavailable retry storage or repeated failure emits `consent:reload-required` with `automatic:false`.

`@persist` is optional. Its layout-level wrapper must preserve the complete UI and matching notice outside Livewire components. A preserved dialog still closes on a real visit. If an app/config-locale interface differs from the incoming page's locale, the adapter performs a full refresh to update both interface and notice. Component-explicit locale overrides remain pinned. For other presentation changes, change the persist key or use normal remount.

Full `wire:ignore` protects the interface contents; its presentation-dependent `wire:key` permits intentional replacement. Custom views must preserve this protection and the UI/notice pairing inside `data-consent-container`. The controller also removes stale subscriptions if controls are replaced.

Current denial/audit recovery markers are retained across Livewire history writes, preserving `state.alpine`. Visits never restart bootstrap audit recovery. An unsaved refusal that cannot safely survive a full visit uses the existing storage-denial/manual-recovery path.

Active withdrawal still sends consent signals, cleans declared cookies, cancels queued work and performs a full reload where required. `Livewire.navigate()` cannot stop already running trackers. Existing [withdrawal rules](browser-runtime.md#withdrawal-and-cooperative-providers) continue to apply.

## SPA measurement

The adapter sends no automatic measurements. It dispatches one document event per completed compatible page swap:

```js
document.addEventListener('consent:navigated', event => {
    const { id, url, title, previousUrl } = event.detail;
    // Explicit application measurement through existing Consent helpers.
});
```

The ID is a document-local counter. URL/title describe the completed destination, including redirects. Initial load, prefetch, canceled visits, morphs and hash-only changes without a swap emit no event. Register the listener once. `whenIdle()` includes an already started navigation/cleanup/loader queue, without awaiting arbitrary application callbacks.

For example, to add subsequent Matomo virtual page views while retaining its initial page view:

```js
document.addEventListener('consent:navigated', event => {
    const destination = new URL(event.detail.url);
    destination.search = ''; // Adapt filtering to the application's data model.
    destination.hash = '';
    Consent.matomo.pageView({ url: destination.href, title: event.detail.title })
        .catch(error => console.error('Matomo page view failed', error));
});
```

Denied events are discarded, never replayed on later acceptance. Use existing [Google](google.md), [Meta](tracker-presets.md), [Matomo](matomo.md) and [TikTok](tiktok.md) helpers. Clarity retains its SDK behavior; Ads conversions are separate from page views. Filter sensitive URL parameters. For GA4, coordinate manual page views with enhanced history measurement: `send_page_view=false` does not disable every automatic history event. See [Google's SPA guidance](https://developers.google.com/analytics/devguides/collection/ga4/single-page-applications).

## CSP and upgrades

The package never loosens CSP. Supply the matching application nonce to both components and Livewire. Livewire 4 needs its [CSP-safe build](https://livewire.laravel.com/docs/4.x/csp) when excluding `unsafe-eval`. Default Livewire 3/Alpine has no such guarantee. Auto mode uses full visits with nonce-bearing runtimes on Livewire 3 or unknown majors.

The original document's CSP governs subsequent SPA pages. The test host exercises strict script nonces, rotating response nonces, inline/published assets and modules. Livewire's DOMParser can report style nonce violations while parsing before adoption. The host additionally authorizes exact static Livewire/consent styles with CSP hashes, without `unsafe-inline`. Published consent CSS avoids its inline-style hash; custom inline palettes need a matching style policy. Verify your actual headers rather than assuming a new response nonce changes the document policy.

Merge current head/banner views and config, republish/cache-bust external JS/CSS, clear compiled Blade and Livewire component caches, rebuild relevant configuration/route caches, and restart persistent workers. Enabling the adapter alone changes neither cookie schema, service fingerprints nor saved-decision lifetimes.

## Verification

Run `composer check` for PHP and Node/jsdom. Actual Livewire integration tests activate in isolated development jobs with that dependency installed; the ordinary baseline remains free of Livewire. CI selects separate PHP/Laravel/Livewire combinations.

Native tests use a disposable Laravel application outside the checkout, with this package installed through a local Composer path repository. The generator replaces files in that disposable host, creates local mocks, and refuses a host inside the package checkout:

```bash
# In the disposable host:
php /path/to/package/tests/Browser/prepare-host.php /path/to/host
php artisan migrate --force
php artisan serve --host=127.0.0.1 --port=8715

# In another terminal in the package checkout:
npm ci --ignore-scripts
npx playwright install chromium firefox webkit
npm run test:browser
```

Use `CONSENT_BROWSER_URL` for another host/port. Host routes, server entry points, mocks and databases stay outside the library. Results/traces use the OS temporary directory. No production vendor accounts receive measurements.

The browser suite covers denied network requests using independent server logs, ordering/deduplication, nine-language navigation and component locale changes, history/persist, full withdrawal reload, single-file extraction, modules/imports/top-level await, invalid nonce, policy changes, delayed/failed audits, history-only denial, canceled visits, keyboard/focus, full axe and 320px reflow with 200% text/spacing in both variants, all positions and themes.

On 18 October 2026, local checks used PHP 8.4.25, Laravel 12.70.0 / 13.37.0, pinned Livewire 3.8.10 / 4.4.7 and Node 22.21.1. The baseline passed 546 Pest tests with two integration-only skips; isolated Livewire 3/4 suites passed 547/548 tests respectively (v3 skips the v4-only compiler case). Node/jsdom passed 273 tests. Native Chromium 156 and WebKit 27.2 passed 36 cases on Livewire 4 and 34 on Livewire 3, with two v4-only skips on v3. The local Firefox binary failed before opening a profile; Firefox is configured in CI and is not counted as a local pass. A visible in-app browser session additionally confirmed language replacement, native dialog modality, heading focus, keyboard wrapping, Escape cancellation and opener focus return. This does not certify arbitrary custom views, screen readers, forced-colors platforms or complete host-site accessibility.
