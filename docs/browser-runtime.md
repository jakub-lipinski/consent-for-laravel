# Browser runtime

Since `v1.0.0-beta.2`, the package provides script gating and a public browser API. Beta.3 adds the [built-in cookie interface](interface.md). Include `<x-consent::head />` early in the layout, register processing purposes in `consent.services`, and wrap optional script tags in `@consent('category', 'stable-id') ... @endconsent`.

## Execution lifecycle

1. The head component emits configuration and initializes `window.Consent`. Configuration contains service metadata and cookie settings, without a visitor's choices.
2. The runtime validates the preference cookie against the PHP schema, policy, service fingerprint, retention, and timestamps. Missing or invalid decisions deny optional categories.
3. At DOM readiness, the runtime discovers inert templates and clears declared cookies for denied services.
4. Allowed blocks activate in document order. Each external library must finish loading before its next script runs. Inline classic scripts execute in sequence. Modules wait for completion, including imports and top-level await; inline modules receive a completion epilogue.
5. A user choice is serialized and verified in the cookie before newly allowed blocks run. Permission is rechecked before each script. A block runs at most once per document.
6. Withdrawal stops queued scripts, cancels pending chains, invokes cleanup hooks, removes generated script nodes, and clears matching declared cookies. Running code normally requires a reload.

With no JavaScript, templates stay inert. The directive does not inspect request cookies or suppress PHP execution. `<script>` elements inside the template are not fetched by the parser, unlike ordinary script tags or tracking images. This follows the [HTML template model](https://html.spec.whatwg.org/multipage/scripting.html#the-template-element).

Only script elements, comments, and whitespace are supported. HTTP and HTTPS source URLs are accepted. Classic JavaScript types, `module`, `application/json`, and `application/ld+json` are supported. Data scripts are copied as inert data after consent; they cannot have a source URL. Modern browsers skip `nomodule` scripts. Attributes such as integrity, crossorigin, referrerpolicy, and nonce are retained. `async` and `defer` are removed so the loader owns ordering.

A failed resource, synchronous inline error, unsupported script, or CSP rejection stops the rest of its block and emits an error. Other independent blocks can continue. Blocks do not retry automatically. A timeout requests a reload because removing an in-flight script cannot guarantee that it will never execute. Asynchronous work started by a tracker remains the tracker owner's responsibility.

## Public API

All methods are on `window.Consent`. Optional categories must be registered before they can be granted.

| Method | Behavior |
|---|---|
| `state()` | Return a frozen snapshot after checking for cookie changes |
| `allowed(category)` | Check current permission, including revocation/reload guards; necessary stays allowed |
| `choose(choices)` | Promise: replace choices, save and verify the cookie, await revocation cleanup |
| `acceptAll()` | Promise: grant used categories |
| `rejectOptional()` | Promise: remember an explicit refusal |
| `openPreferences()` | Open the mounted UI; return true if handled, false if unavailable |
| `forget()` | Promise: remove the decision and return to pending, with the same revocation lifecycle |
| `refresh()` | Promise: synchronize a server or another tab's decision and await cleanup |
| `onChange(callback)` | Register `(current, previous, source)`; return an unsubscribe function |
| `onRevoke(category, callback, options?)` | Register cleanup receiving the denied state; return an unsubscribe function |
| `whenIdle()` | Promise: await DOM readiness and current decision, cleanup, and loading queues |

Decision promises resolve after persistence and cleanup, independently of loading newly allowed scripts. Use `whenIdle()` when testing or when you need to wait for those scripts. It does not await asynchronous tasks spawned by application callbacks or vendor code.

```js
try {
    await Consent.choose({ analytics: true, marketing: false });
    await Consent.whenIdle();
} catch (error) {
    // Present a storage or validation error in your accessible interface.
}
```

Choices are real booleans and replace the whole optional selection. Unknown categories, grants for unused categories, and rejection of necessary cookies are errors. `state()` has the same six fields as `ConsentState::toArray()`. Pending states have null timestamps.

The runtime checks external changes on focus, pageshow, visibility changes, and a one-second poll. It also rechecks before loading each script. Reads do not extend expiry. Another tab or a PHP endpoint can replace or forget the cookie without a separate synchronization protocol.

## Withdrawal and cooperative providers

The default reload restores the document with the newly saved choices. The runtime does not claim that deleting a script element stops its timers, listeners, or network requests. Applications should keep withdrawal as easy to reach as acceptance, following [EDPB consent guidance, section 5.2](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf).

If a provider exposes a complete disable API, register a cooperative hook before activation:

```js
Consent.onRevoke('analytics', async () => {
    await window.siteAnalytics?.stop();
}, { reload: false });

Consent.onChange((current, previous) => {
    if (current.choices.analytics && !previous.choices.analytics) {
        window.siteAnalytics?.resume();
    }
});
```

This is a provider-specific illustration, not a preset. The cleanup hook owns all active code in its category. Every registered hook for that category must explicitly use `reload: false` to avoid a reload. Hooks default to requiring a reload. In-flight script loading always requires a reload, even with cooperative hooks. Throwing, rejection, or cleanup timeout also falls back to reload.

Cooperative regrant does not re-execute previously activated blocks. Resume an already initialized provider through its own API. A change callback may run before the first library has loaded, so the example uses optional chaining; the initial block performs first initialization. If a vendor cannot reliably stop and resume, keep the default reload.

```php
'loader' => [
    'script_timeout_ms' => 15000,
    'cleanup_timeout_ms' => 3000,
],
```

Both timeouts accept integers from 1 to 120000 milliseconds. They bound package-managed loading and cleanup, not arbitrary work inside a tracker.

## Persistence failures

A failed cookie write rejects the decision promise, emits `consent:error`, and denies optional categories in memory. It does not activate a grant that could not be saved. A failed refusal must also avoid restoring an older grant after reload: the runtime remembers a temporary denial in same-tab session storage, using a key scoped to the preference cookie. If session storage is unavailable, it can preserve the marker in an object-valued `history.state`, retaining the application's other fields. A successful saved choice removes these temporary markers.

If neither fallback can retain the denial, the runtime blocks future package-managed execution, emits a `storage-denial` error and `consent:reload-required` with `automatic: false`, and does not reload into an older grant. The application's interface must report the storage failure and direct the visitor to leave that document to stop already running code. Do not treat a rejected promise as a successful saved refusal. This exceptional path cannot provide a universal tracker shutdown API.

## Events and diagnostics

Events are dispatched on `document`:

| Event | `detail` |
|---|---|
| `consent:open-preferences` | No detail; cancelable request used by `openPreferences()` to reach the mounted UI |
| `consent:ready` | `{ current }` at DOM initialization |
| `consent:change` | `{ current, previous, source }` |
| `consent:error` | `{ code, message, block }`; `block` is nullable |
| `consent:reload-required` | `{ reason }`, or `{ reason, automatic: false }` if denial cannot survive reload |

Change sources are `choice`, `forget`, `refresh`, or `storage-error`. Error codes cover configuration, namespace collision, invalid/conflicting blocks, scripts, storage, cookie cleanup, lifecycle callbacks, and reload. Listen early if you need startup errors:

```js
document.addEventListener('consent:error', event => {
    console.error(event.detail.code, event.detail.message);
});
```

Errors never include the saved cookie or visitor identifiers. If another library already owns `window.Consent`, the runtime reports the collision and leaves gated scripts inert. Including the package runtime twice preserves the existing API and callbacks.

## SPA fragments and deduplication

A MutationObserver discovers new templates after page navigation or fragment insertion. Use an explicit stable ID for each logical block, because generated IDs restart with each server render. An identical ID/category/content combination runs once; a conflicting combination is ignored with a diagnostic. Distinct inline blocks intentionally remain distinct. External resources share a loading promise for the same normalized URL, classic/module kind, integrity, CORS, and referrer policy.

Blocks require dependencies to appear before their initialization. A denied block does not delay an independent allowed category. Avoid placing shared libraries under incompatible consent purposes. The loader does not intercept vendor requests, restart previously failed blocks, implement router lifecycle cleanup, or support arbitrary HTML insertion.

## CSP, caching, and cookie cleanup

`<x-consent::head :nonce="$cspNonce" />` embeds the runtime and assigns the application's nonce to activated scripts that lack their own. A nonce must be generated per response and included in the CSP header. Hash-only inline policies may require an explicit nonce-based setup for dynamically activated scripts. The package does not loosen the application's CSP. The optional `src` attribute references a published runtime asset; do not add asynchronous loading if application scripts depend on immediate API availability.

Head configuration is independent of visitor preferences. Cache template markup with the correct application configuration and CSP strategy; invalidate it after policy or service changes. Do not cache personalized PHP-rendered output across visitors. Published JavaScript must be republished after a package upgrade, and application overrides of the head view must be reviewed.

Cookie rules match visible first-party cookie names exactly or by a literal prefix, using the declared path and domain. Declare each actual scope separately. Preference, session, CSRF, and `remember_` cookies are protected. Necessary services are never cleaned up. Unlisted cookies, HttpOnly cookies, third-party cookies, inaccessible paths, local storage, IndexedDB, and already collected remote data require explicit provider/server mechanisms. Cookie deletion is not a substitute for disabling processing.

## Verification

`composer test:js` runs syntax checks and Node/jsdom tests, including a real PHP/browser serialization round trip. jsdom does not execute modules or enforce CSP; those features require a real browser.

A local Testbench fixture is available for manual browser checks:

```bash
composer install
php -S 127.0.0.1:8873 tests/Browser/router.php
```

Open `http://127.0.0.1:8873/`. Check pending/refused states with zero tracker requests, grant/library/initialization order, duplicate prevention, persisted refusal after reload, cookie deletion, published assets, cooperative cleanup, in-flight withdrawal, and modules with imports/top-level await. The blocked scenario uses an intentionally invalid nonce under a nonce-only CSP and must stop its dependent script. Set `CONSENT_BROWSER_LOG` to a temporary file path if you need an independent request log. The fixture uses only local mock scripts. Test the beta.3 banner with the separate [UI fixture and verification instructions](interface.md#verification).
