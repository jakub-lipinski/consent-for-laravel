# Livewire

## When to Read This Reference

Read when using Livewire components, `wire:navigate`, language switching, persisted interfaces, or SPA measurements with this package.

## Setup

Use Livewire 3.8.10+ or 4.4.7+ with the package's existing Laravel/PHP requirements. Livewire is optional and detected from the installed Composer package. Keep `<x-consent::head />` early in the shared head and one `<x-consent::banner />` in the body on every participating page. No consent Livewire component, `entangle`, frontend build or extra endpoint is required.

The following top-level configuration is optional; older published configurations inherit these defaults:

```php
'livewire' => [
    'enabled' => true,
    'navigation' => 'auto',
],
```

`auto` coordinates SPA visits. Use `reload` for full visits instead. Boolean `enabled=false` disables special navigation/UI coordination; generic fragment discovery and single-file inert-script protection remain.

## Script Ownership

Register purposes globally. Use explicit stable IDs and ordinary script tags in class-based, single-file and multi-file views:

```blade
@consent('analytics', 'site-statistics-loader')
    <script src="/js/site-statistics.js"></script>
@endconsent
```

The source is illustrative. Keep each ID's category and code stable. Identical blocks and SDKs execute once per document, including across navigation/history. Removed blocks cannot start their remaining scripts. Preserved unchanged blocks pause during swaps and resume afterward. Per-mount widgets need application-owned lifecycle/cleanup and permission checks before optional work.

Do not nest `@script`/`@assets` with `@consent`; Livewire owns those separate execution transports. The v4 preparation hook protects ordinary gated script tokens before single-file extraction. Blade/PHP expressions inside gated scripts remain available to normal Blade compilation, including `@json` and `@js` values containing script-like text. Separate modules, direct vendor calls and server actions are not automatically gated.

## Languages and Interface State

Leave `ui.locale=null` and set `app()->setLocale($locale)` before page/component rendering. Preserve that locale across Livewire update requests through the application's middleware/session handling. Explicit component and config overrides keep their priority.

Navigation and component language changes replace the presentation-keyed interface and signed notice together, preserving saved choices and expiry. Ordinary same-presentation morphs keep the draft. A real page swap closes the dialog, discards the unsaved draft and leaves focus to the destination.

`@persist` is optional. Keep its complete UI/notice container outside Livewire components in the shared layout. A persisted app/config-locale interface refreshes the full document if the incoming locale differs. Component-explicit locales remain pinned. For other presentation changes, change the persist key or use normal remount. Preserve the bundled full `wire:ignore`, presentation key and `data-consent-container` when customizing views.

## Navigation and Measurements

Changed runtime configuration/assets require bounded full-reload recovery before further activation. Active withdrawal retains the full reload rules; SPA navigation cannot stop running code. Audited grants wait for receipts and retain the notice captured at invocation. A delayed receipt cannot override a newer refusal. Navigation never records a decision.

`consent:navigated` on `document` carries `{ id, url, title, previousUrl }` once per completed compatible page swap. Initial load, prefetch, canceled visits, morphs and hash-only changes emit no event. The adapter sends no measurements. Register a listener once and call only enabled [browser helpers](browser-api.md):

```js
document.addEventListener('consent:navigated', event => {
    const destination = new URL(event.detail.url);
    destination.search = '';
    destination.hash = '';
    Consent.matomo.pageView({ url: destination.href, title: event.detail.title })
        .catch(error => console.error('Matomo page view failed', error));
});
```

This example preserves Matomo's initial page view and adds subsequent views. Adapt URL filtering to the application. Coordinate GA4 manual page views with enhanced history measurement to prevent duplication. Denied calls are discarded, never replayed after acceptance. `whenIdle()` includes already started navigation/cleanup/loader work; do not await it inside a gated module.

## CSP and Upgrades

Supply matching application nonces to the head/banner and Livewire. Use Livewire 4's CSP-safe build when excluding `unsafe-eval`. Auto mode uses full visits for nonce-bearing Livewire 3/unknown-major runtimes. The original document's CSP governs SPA destinations. Omitted script nonces inherit the runtime nonce; an explicitly invalid nonce is never repaired. Livewire DOMParser style processing can need exact static-style hashes in addition to nonces; test actual headers and published CSS.

Merge current head/banner views, including the runtime-context marker and complete UI/notice wrapper. Refresh/cache-bust published `consent.js`, `banner.js` and `consent.css`; clear compiled Livewire/Blade caches, refresh stale page HTML, rebuild relevant configuration/route caches, and restart persistent workers. Refresh selected Boost resources with `php artisan boost:update`. There is no cookie migration or automatic consent reset.

## Verification

Verify pending and saved choices during real navigation and component updates, language changes, Back/Forward, duplicate prevention, delayed audit responses, refusal and active withdrawal. Check native dialog focus, keyboard controls, narrow layouts and enlarged text. Follow [verification](verification.md); jsdom alone does not establish Livewire/CSP/modules/modality behavior.
