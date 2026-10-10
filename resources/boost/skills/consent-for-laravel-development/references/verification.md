# Verification and Diagnostics

## When to Read This Reference

Read when verifying a change or diagnosing absent/duplicate events, loading failures, CSP, storage, audit receipts, or interface regressions.

## Configuration Checks

Confirm the installed package version, enabled service/preset, actual public ID/instance URL, required category, current policy/service fingerprint, asset version, and shared component order. Inspect the application's actual configuration cache and published customizations. Use the relevant integration reference for valid options; do not add a duplicate SDK to work around a blocked preset.

## Usage

Observe package errors and reload requirements using the application's diagnostics:

```js
document.addEventListener('consent:error', event => {
    console.error('Consent integration error', event.detail);
});
document.addEventListener('consent:reload-required', event => {
    console.info('Consent reload required', event.detail);
});
```

Register early when investigating initialization errors. From an external console/test, `Consent.state()`, `Consent.allowed(category)`, and `await Consent.whenIdle()` inspect/await package work. Do not await idle inside a gated module. SDK background requests may continue independently of idle, so wait for the relevant request/payload in browser tests.

## Verification

Run the applicable scenarios in a disposable application/test browser:

| Scenario | Expected result |
| --- | --- |
| Fresh pending decision | Optional custom scripts and strictly gated SDKs make no requests |
| Explicit refusal | Optional events are discarded and no later replay occurs |
| Analytics-only choice | Analytics integrations run; marketing-only presets/conversions stay blocked |
| Marketing-only choice | Marketing integrations run; analytics trackers and Clarity stay blocked |
| Restored valid decision | Permitted presets initialize once; default initial views occur per document |
| Stale policy/services or expired decision | Optional categories become denied |
| Active withdrawal | Denial signals, cancellation, cookie cleanup, and required reload occur |
| Failed cookie persistence | No unsaved new grant activates |
| Blocked SDK or ordinary load failure | Helper cannot dispatch; independent permitted work can continue |
| Loader timeout | Activation halts; bounded reload recovery prevents repeated automatic loops |
| Enabled audit with delayed receipt | A new grant waits for durable acknowledgement |
| Failed audit or late acceptance receipt after refusal | No new grant is revived; local denial remains |

Google Advanced intentionally allows enabled Google tags/cookieless pings in pending/refused states; keep that exception separate from strictly gated integrations. Clarity advertising also depends on its explicit configuration. Do not claim a universal zero-request result for Advanced.

For measurements, inspect the actual destination, name, ID/label, money/currency/product fields, number of events, and application success timing. For SPA changes, verify the initial route and subsequent routes without duplicating SDK/account automatic tracking. Use provider reporting/diagnostics when the real account is available; distinguish those checks from intercepted SDK tests or mocks.

For custom scripts, verify library-before-init order, module imports/top-level await, deduplication, nonce inheritance, and cancellation. For audit, inspect all four explicit actions, original translated notice snapshots, receipt failures, protected history identity cookies, and pruning. Rendering/reading/measuring must not append decisions.

For interface changes, check the relevant variants/themes/positions/languages, longer custom wording, keyboard opening/Tab/Shift+Tab/Escape/focus return, custom palette contrast, 320-pixel reflow, and 200% text resizing in a browser. Use accessibility automation as an additional check, not evidence of native modality or visual layout by itself.

## Common Pitfalls

| Symptom | Check |
| --- | --- |
| Only a preferences icon appears | No optional purpose configured, or an existing decision |
| Entire runtime unavailable | Configuration/namespace collision, missing head, CSP, or old published runtime |
| Helper returns false | Category denied, active reload/revocation, or failed initialization |
| Helper rejects | Disabled preset, malformed arguments, or vendor exception |
| New grant fails with audit | Migration/key/route, signed notice, same-origin request, database, and receipt |
| Duplicate measurements | Tag manager/other snippets, repeated callbacks, initial plus manual views, account automation |
| Cookie survives withdrawal | Actual domain/path, undeclared plugin cookie, HttpOnly/third-party scope, or protected name |
| Updated configuration has no effect | Config cache, persistent worker, stale published assets, or cached HTML |

Keep tests proportional to the changed behavior. Use the host application's existing PHP/browser test commands; package-maintainer Composer/npm commands are not automatically application requirements. Report the locally executed versions/checks separately from configured CI coverage.
