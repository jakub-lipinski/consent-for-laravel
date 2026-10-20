# Decision Audit

## When to Read This Reference

Read when the task calls for database consent history, retention/pruning, customized audit notices, or receipt failures.

## Configuration

Audit is disabled by default. Inspect the existing `consent.audit` settings and select the connection/table names before publishing the optional migration:

```bash
php artisan vendor:publish --tag=consent-audit-migrations
php artisan migrate
```

After tables exist, set the existing `consent.audit.enabled` to `true`. Rebuild configuration/route caches and restart persistent workers. Enabled audit needs a valid `APP_KEY`; preserve any intended previous signing keys and refresh cached HTML after key/purpose changes. Keep installed table/connection names and identity-cookie scope stable.

| Setting | Use |
| --- | --- |
| `enabled` | Turn decision history on/off |
| `connection` | Null uses the application's default database |
| `decisions_table`, `notices_table` | Table names selected before migration |
| `path` | Same-origin JSON POST endpoint, default `/consent/decisions` |
| `retention_days` | Database retention; null disables pruning |
| `timeout_ms` | Bounded receipt delivery deadline |

## Usage

The built-in runtime records `acceptAll()`, `rejectOptional()`, `choose()`, and `forget()` as `accept_all`, `reject_optional`, `save_preferences`, and `withdraw`. Page rendering, reads, dialog opening, expiry, and external cookie edits do not create decisions.

`consent_decisions` stores full choices, action, event UUID, browser history ID, notice ID, server receipt time, and preference expiry. `consent_notices` stores the original signed snapshot with rendered banner/dialog, translations, canonical purposes, presentation, and asset fingerprints. Old cached pages submit their original wording; do not rebuild historical notices from current translations or modify signed notice JSON.

New optional grants wait for a matching durable database receipt. Refusal/withdrawal deny locally immediately, including during delivery failure.

Before applying a successful receipt, the runtime re-reads shared preferences. A changed saved decision from another tab or a server response supersedes the pending choice, including when refresh already observed it. The superseded choice resolves with the current state; its committed audit row remains history, not proof of current permission. Promise rejection reports a delivery failure and does not reverse local denial. Browser preference writes and audit delivery are distinct operations.

When active withdrawal reloads a mixed change, the runtime carries the original event UUID, signed notice, and choices through a short-lived same-tab handoff. The next document retries the same event and enables new grants only after a matching receipt while the saved refusal and configuration still match. Session storage has an object-valued history-state fallback. A newer choice, failed receipt, or expired handoff discards recovery; unavailable handoff storage leaves the new grant denied. This is not an offline queue, and ordinary decisions without a required reload need no handoff.

Deploy the current `consent.js` when upgrading audited applications. Refresh/cache-bust published runtimes and invalidate cached HTML containing an inline runtime; a Composer update alone does not replace published JavaScript.

An audit failure does not necessarily revoke earlier valid permissions. For example, adding marketing to an existing analytics grant can fail while analytics remains allowed. Keep custom save errors neutral and retryable; do not claim that every optional cookie is blocked or that cookie storage caused an audit failure.

The endpoint is registered by the package when audit is enabled at boot. It has an exact same-origin/signed-JSON contract without web/session middleware; no application CSRF exemption or CORS configuration is needed. Keep session/CSRF encryption, allow `connect-src 'self'`, and preserve the head/banner's original `data-consent-notice` block when customizing/publishing views and assets.

### Retention

Choose retention for the application's evidence needs; it is independent of preference validity. Schedule explicit pruning in the consuming app's `routes/console.php`:

```php
use Illuminate\Support\Facades\Schedule;

Schedule::command('consent:audit-prune')->daily()->withoutOverlapping();
```

The command removes expired decisions and old unreferenced notices. It never runs during consent reads. Keep application access control, backups, and evidence exports within the host's existing design. Stored HTML is evidence data, not trusted HTML to execute in an admin page.

### Custom Server Flows

PHP `ConsentManager::persist()`/`forget()` are cookie helpers. For an explicitly requested custom server audit flow, inspect the installed package's `docs/audit-log.md`, `AuditNotice::seal()`, and `AuditRecorder::record()` signatures. Supply the server-prepared original signed UI notice, event UUID, action, full choices, and optional validated history UUID. Do not add a second recorder for built-in browser decisions or manually assemble unsigned snapshots.

## Verification

Check all four actions, stored translated snapshots, one history identity across actions, idempotent retries, and no writes from rendering/reads/measurements. Delay a successful receipt: optional SDKs must remain unloaded until it arrives. Simulate database/endpoint failure and a late receipt after refusal; denial must remain effective. With two tabs sharing cookies, hold an acceptance receipt in the first, then refuse, save a partial selection, or forget in the second. For the forget scenario, begin with a saved decision so there is a preference cookie to remove. Release the receipt both before polling and after an explicit refresh. Assert the saved cookie, returned state, and denied SDK requests; the old acceptance must not restore removed permission. Verify protected audit identity cookies survive tracker cleanup and pruning preserves referenced notices.

## Common Pitfalls

- Enabling audit before migrations or serving obsolete published assets/views.
- Adding session tokens to cached notices or unnecessary CSRF exemptions.
- Assuming a logged submission proves subsequent browser-cookie persistence.
- Claiming cross-device identity, live permission, or legal certification from history rows.
- Expecting offline guaranteed delivery or a persistent event replay queue.
