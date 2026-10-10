# PHP API

## When to Read This Reference

Read when server-side code needs current preferences or an application-owned decision endpoint. Use the built-in browser/UI flow for ordinary consent collection.

## Configuration

Resolve `ConsentManager` from Laravel's container. The namespace is `ConsentForLaravel\ConsentForLaravel`; there is no package facade or consent middleware to invent. Register optional purposes before granting their categories. Keep the preference cookie browser-readable through the package's existing encryption exception; keep session/CSRF cookies encrypted.

## Usage

### Read Preferences

```php
use ConsentForLaravel\ConsentForLaravel\ConsentManager;

$manager = app(ConsentManager::class);
$state = $manager->read(request());
$analyticsAllowed = $state->allows('analytics');
$needsDecision = $manager->needsConsent(request());
```

`read()` is stateless and has no cookie/database side effects. Missing, stale, malformed, or expired cookies yield denied optional categories. `needsConsent()` also considers whether any optional purposes exist. `ConsentState::hasDecision()`, `allows()`, and `toArray()` expose the decision without extending its lifetime. Necessary remains allowed.

Do not use this read to choose whether tracking tags appear in cached Blade HTML. Use inert `@consent` blocks and browser gates instead. The cookie is user-editable and cannot authorize application access.

### Create and Persist a Decision

For a real explicit choice handled by an application-owned endpoint:

```php
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use Illuminate\Http\Request;

// Inside an application-owned controller action with the required middleware:
$manager = app(ConsentManager::class);
$state = $manager->choose($validatedChoices);

return $manager->persist($state, response()->json(['saved' => true]), $request);
```

`$validatedChoices` is the visitor's complete boolean selection; `$request` is the action's `Request`. Keep the application's request validation and endpoint protection. `choose()`, `acceptAll()`, and `rejectOptional()` create a state; they do not persist it by themselves. `persist(state, response, request)` writes a valid current decision cookie and marks the response private/no-store. `forget(response, request)` expires the cookie and marks the response likewise.

These PHP methods do not run browser SDK cleanup or write audit rows. An already-open document notices cookie changes through the browser runtime. If audit evidence is required for custom server endpoints, explicitly integrate the signed-notice recording contract described in [audit](audit.md); do not infer evidence from a cookie write.

## Verification

Use the application's HTTP tests to check actual cookie persistence, restored choices, refusal/expiry, changed policy/purposes, and private response caching. Verify browser synchronization and active withdrawal when server endpoints alter a decision. Reads must not create audit rows.

## Common Pitfalls

- Constructing package services manually instead of using container bindings.
- Treating `choose()` as persistence or database recording.
- Granting unknown/unused categories or passing strings such as `'true'`.
- Using preferences for authentication, authorization, or identity.
- Recording a consent action merely because a page or preference cookie was read.
