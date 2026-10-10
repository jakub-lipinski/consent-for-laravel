# Browser API

## When to Read This Reference

Read when building custom consent controls, checking choices, synchronizing tabs/server changes, or implementing provider cleanup.

## Configuration

Render the head before consumers of `window.Consent`. Only optional categories used by enabled registered services can be granted. Use explicit visitor actions for consent decisions.

## Usage

| Method | Contract |
| --- | --- |
| `state()` | Frozen current snapshot; checks external cookie changes |
| `allowed(category)` | Current permission with reload/revocation guards |
| `choose(choices)` | Replace the complete selection; persist and await cleanup |
| `acceptAll()` | Grant used categories |
| `rejectOptional()` | Store an explicit refusal |
| `forget()` | Remove the decision and return to pending |
| `openPreferences()` | Open the mounted interface; boolean result |
| `refresh()` | Synchronize externally changed preferences and await cleanup |
| `onChange(callback)` | Observe `(current, previous, source)`; returns unsubscribe |
| `onRevoke(category, callback, options?)` | Register cleanup; returns unsubscribe |
| `whenIdle()` | Await DOM readiness and current package queues |

Decision methods return promises independently of newly allowed script loading. Necessary cannot be denied, unknown categories are invalid, and unused optional categories cannot be granted. Choices are booleans and replace the selection; omitted optional categories become denied.

```js
// Submit the full draft selection collected by the application's controls.
await Consent.choose({ analytics: true, marketing: false });
```

Adapt the selection to all optional categories the application's controls manage. Do not accept consent on page load or treat opening preferences as a decision. Rejection records a decision; forgetting returns to pending. Reads/refreshes do not extend expiry or create audit rows.

### Preset Helper Results

Helpers check permission at invocation and before dispatch. Permitted calls may await initialization. Denied calls return `false` and are discarded; do not retain measurements for later acceptance. `true` means local dispatch, not network delivery, reporting, or automatic duplicate prevention. Invalid inputs/disabled presets reject; handle promise errors in the application's normal error flow.

```js
try {
    const dispatched = await Consent.tiktok.track('Purchase', {
        value: order.total,
        currency: order.currency,
    }, { eventID: order.id });
    // A false result needs no replay after a later grant.
} catch (error) {
    reportMeasurementError(error); // Application-owned error handler.
}
```

Use this only when TikTok is configured and after the application confirms the order. Provider-specific signatures are in the integration references.

### Change Listeners and Withdrawal

```js
const unsubscribe = Consent.onChange((current, previous, source) => {
    updateConsentStatus(current); // Application-owned presentation.
});
```

Vendor consent signals update before change listeners. Another tab/server change, expiry, focus, pageshow, and visibility changes are synchronized; the runtime also polls and checks before activation.

Custom providers default to reloading after active withdrawal. A complete cooperative disable API can use:

```js
Consent.onRevoke('analytics', async () => {
    await window.siteStatistics.stop();
}, { reload: false });
```

Register before provider activation and use `reload: false` only when cleanup stops every active provider in that category, including timers/listeners/network work. All relevant hooks must opt out. Errors, timeouts, in-flight loading, and active built-in presets still require reload. Regrant does not re-execute old custom blocks; a cooperative provider must resume through its own API after it exists.

## Verification

Use `await Consent.whenIdle()` from application tests or an external console to await current package work. It does not await arbitrary async work spawned by vendors/listeners. Test selection replacement, cancellation of pending events, external changes, and withdrawal with failed storage/audit. See [verification](verification.md).

## Common Pitfalls

- Awaiting `whenIdle()` inside a gated module.
- Ignoring rejected decision promises or claiming successful vendor delivery from `true`.
- Calling provider globals directly or replaying denied events.
- Using browser preferences as an authorization check.
- Treating cleanup errors as permission to restore an older grant.
