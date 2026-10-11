# Custom Scripts

## When to Read This Reference

Read when integrating a provider without a built-in preset, loading custom modules, or configuring CSP and external assets.

## Configuration

Add this kind of entry inside `consent.services`, with the real provider's purpose and cookie names/scopes:

```php
'site-statistics' => [
    'category' => 'analytics',
    'name' => 'Site statistics',
    'description' => 'Measure website visits.',
    'cookies' => [
        ['name' => '_site_stats', 'path' => '/', 'domain' => null],
    ],
],
```

Cookie rules use exactly one `name` or `prefix`, plus a path and optional domain. Match actual first-party cookie scopes; JavaScript cannot expire HttpOnly or unrelated third-party-domain cookies. Session/CSRF, preference, audit identity, and remember-me cookies remain protected. Registering a service does not load code.

## Usage

Use a stable, globally distinct block ID and the registered category:

```blade
@consent('analytics', 'site-statistics-loader')
    <script src="https://stats.example.com/tracker.js"></script>
    <script>window.siteStatistics.start();</script>
@endconsent
```

The URL/API are illustrative; adapt both to the provider. The directive renders an inert template independent of visitor preferences. Only scripts, comments, and whitespace belong inside it. Keep the head runtime earlier in the layout. Avoid request-cookie `@if` conditions, tracking images/noscript pixels, and executable provider tags elsewhere.

Scripts run in document order after permission, with libraries finishing before initialization. Each block runs once per document; duplicate external sources are shared according to the loader's resource key. `async`/`defer` are removed; integrity, crossorigin, referrerpolicy, and nonce are preserved. JSON/data scripts remain inert; they cannot have `src`.

Keep a discovered template's ID, category, and script content unchanged, including during external loading. A mutation stops its remaining chain with a conflict diagnostic. Use a distinct stable ID for a different logical block, and the same ID/category/content when rendering the same block again.

Waiting blocks start in current DOM order, including fragments inserted or moved during an earlier load. Detached templates cannot activate; detaching an active template prevents its remaining scripts from starting. An unchanged unstarted block can be reattached or replaced by an identical template. Started blocks retain deduplication and revocation history, and removal cannot stop code already running or loading.

### Modules and Events

A gated module may await an enabled preset helper:

```blade
@consent('marketing', 'checkout-measurement')
    <script type="module" src="/assets/checkout-measurement.js"></script>
@endconsent
```

Its imports/top-level await complete before dependent scripts. Use the application's asset bundler to supply a real module URL. Do not await `Consent.whenIdle()` inside the module; it waits for that module's own completion. Event helpers use a separate queue. See [browser API](browser-api.md) for consent changes and cooperative cleanup; built-in presets do not need this wrapper.

### CSP and External Assets

Pass the same request-generated nonce to both components:

```blade
<x-consent::head :nonce="$cspNonce" />
<x-consent::banner :nonce="$cspNonce" />
```

The loader inherits a nonce for activated scripts. External modules also use a nonce-bearing completion import marker after their original load. A nonce authorizes scripts/styles only as allowed by the host's policy; collection connections and images need their own CSP permissions. TikTok's secondary scripts require `strict-dynamic` trust or an allowed script origin.

If external package assets are required, publish `consent-assets` and use:

```blade
<x-consent::head :nonce="$cspNonce" :src="asset('vendor/consent/consent.js')" />
<x-consent::banner
    :nonce="$cspNonce"
    :style-src="asset('vendor/consent/consent.css')"
    :script-src="asset('vendor/consent/banner.js')"
/>
```

Use the application's nonce/asset URLs and cache-busting conventions. Preserve CSP on cached responses; the HTML nonce and response policy must agree. Refresh published assets when updating the package.

## Verification

Verify no provider request while pending/refused, library-before-init ordering, correct module completion, no duplicate execution, nonce/CSP behavior, and active withdrawal. See [verification](verification.md). Ordinary load errors stop their block and allow independent blocks to continue; timeouts halt activation and use bounded reload recovery.

## Common Pitfalls

- Wrapping unsupported HTML instead of scripts.
- Assuming removing a running script stops its code.
- Supplying incomplete cleanup with `reload: false`.
- Expecting a previously activated block to rerun after cooperative regrant.
- Retaining a duplicate provider installation outside the gated block.
