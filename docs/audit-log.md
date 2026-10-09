# Decision audit log

The optional audit log stores explicit decisions in the host application's database. Each decision references a signed copy of the banner and preferences dialog prepared for that page. The preference cookie continues to control current browser choices; it is not the audit history.

## Enable

Merge the `audit` section from the package config into an existing published config. Select the database connection and table names before running the migration:

```php
'audit' => [
    'enabled' => false,
    'connection' => null,
    'decisions_table' => 'consent_decisions',
    'notices_table' => 'consent_notices',
    'path' => '/consent/decisions',
    'retention_days' => 180,
    'timeout_ms' => 5000,
],
```

```bash
php artisan vendor:publish --tag=consent-audit-migrations
php artisan migrate
```

Then set `audit.enabled` to `true` and rebuild the application's configuration and route caches. Restart long-running workers and clear page/view caches as appropriate. Keep the selected connection, table names, and identity-cookie name stable after installation. The migration is optional and does not run automatically. Disabled auditing requires neither tables nor an application signing key.

Use the updated `<x-consent::head />` and `<x-consent::banner />` components. Refresh and cache-bust published `consent.js`; the inline runtime uses the installed source. Existing published views must include the new notice capture and `data-consent-notice` JSON block from the bundled banner view. Keep its nonce handling when merging customizations. Missing or duplicate notice blocks block new grants when auditing is enabled.

## Stored data

### `consent_decisions`

| Column | Meaning |
| --- | --- |
| `id` | Browser-generated event UUID. Retrying the same event does not append another record. |
| `consent_id` | Server-generated random browser history identifier. |
| `notice_id` | Foreign key to the original notice. |
| `action` | `accept_all`, `reject_optional`, `save_preferences`, or `withdraw`. |
| `choices` | Full category state requested by the visitor, including denied categories. |
| `recorded_at` | Server receipt time in UTC, preserved on retries. |
| `expires_at` | Preference lifetime measured from server receipt using the notice's retention setting; null for `withdraw`. |

The package's categories are `necessary`, `analytics`, `marketing`, `performance`, and `other`. Necessary remains true. Unused optional categories cannot be granted. `save_preferences` records the complete selection even when it matches the previous one. `reject_optional` is an explicit decision; `withdraw` is the runtime's `forget()` action. Dismissing the banner, opening the dialog, loading a page, refreshing preferences, expiry, and cookie edits do not create audit events.

`recorded_at` records delivery, not an independently verified click time. An audit event records the submitted choice; a later browser-cookie write can still fail. The server's `expires_at` describes the submitted preference lifetime, not the audit retention deadline, and can differ slightly from the browser's clock. Do not use this table as an authorization mechanism or as a live consent registry across devices.

### `consent_notices`

| Column | Meaning |
| --- | --- |
| `id` | Notice identifier referenced by decisions. |
| `fingerprint` | Unique SHA-256 fingerprint of the complete snapshot payload. |
| `policy_version` | Configured policy version when the page was prepared. |
| `services_version` | Canonical service fingerprint when the page was prepared. |
| `locale` | Effective interface language. |
| `snapshot` | Rendered UI HTML, requested/effective locales, categories, canonical services, preference lifetime, resolved presentation, and bundled asset fingerprints. |
| `created_at` | UTC time when the first referencing decision stored this notice. |

Snapshots are inserted, never updated by the package. Many decisions can reference one notice. Changed wording, service translations, fallback output, component props, presentation, or asset fingerprints produces a different snapshot. There is no background watcher: the new notice is inserted when the next explicit decision arrives.

The HTML is captured from the bundled Blade view after translation and escaping, including both the banner and dialog. This covers partial/custom dictionaries, regional service translations, direct edits inside the capture block of a published view, and component overrides. No duplicate list of message keys needs maintenance. The snapshot describes the server-prepared interface; it cannot observe later DOM changes made by other browser scripts or prove which disclosures a visitor opened.

The policy link URL and label are included. External policy page contents, external stylesheet/script contents, and host-page content are not downloaded or archived. Archive the associated policy documents and externally served assets through the application's own deployment process. Treat stored HTML as evidence data; do not render it as trusted executable HTML in an admin application.

## Cache and signatures

Rendering and preference reads never query or write the audit tables, create an identity, or embed session/CSRF tokens. The page carries its original snapshot and an HMAC signature made with `APP_KEY`. The server verifies that signature before storage. A cached old page can therefore submit its original wording after translations or configuration change.

Do not include visitor-specific or sensitive content inside the captured UI. HTML caching must still vary by the selected locale and relevant component/configuration values. A valid signature does not make stale consent policy suitable for current processing: owners must invalidate stale HTML and request fresh consent when purposes change.

Key rotation can retain old signatures through Laravel's `app.previous_keys`. Removing an old key invalidates notices signed with it. After changing signing keys, refresh cached HTML deliberately. Signatures authenticate package-generated notice content, not visitor identity, legal validity, or database administrator edits.

## Requests and browser identity

When enabled at application boot, the provider registers the configured JSON POST path as `consent.audit.store`. The endpoint accepts only an exact same-origin `Origin` header, compatible Fetch Metadata, JSON content, signed notices, and valid full category choices. It has no web/session middleware, does not opt into CORS, and requires no CSRF exemption. Keep Laravel's session and CSRF cookies encrypted. Configure trusted proxies correctly and allow `connect-src 'self'` in CSP. Rebuild route caches after enabling or changing the route.

A request is limited to 60 KiB, below the browser's individual keepalive request limit. Concurrent keepalive requests can still exhaust the browser's shared quota. Oversized custom notices fail during rendering rather than silently dropping evidence. A reverse proxy or application firewall can apply stricter limits and request throttling.

The endpoint issues a host-only, HttpOnly, integrity-protected `{preference cookie name}_audit` cookie scoped to the audit endpoint. Its lifetime follows the currently configured preference retention. No IP address, user-agent, email, or user account ID is stored in these two tables. The identifier is pseudonymous, not anonymous. Browser deletion, blocked cookies, different devices, simultaneous initial requests in different tabs, or changed endpoint/cookie names can split a history. There is no fingerprint-based reconnection.

## Failures and withdrawal

New optional grants wait for a matching receipt after the database transaction commits. A failed signature, unavailable database, missing migration, timeout, invalid receipt, or blocked endpoint prevents those grants. Existing valid choices are not retroactively logged or invalidated merely by enabling auditing; increment the policy version and invalidate stale HTML if the deployment requires a new explicit decision.

Refusal and withdrawal apply locally immediately. A mixed change removes previous grants immediately and waits for a receipt before activating newly granted categories. A later refusal or withdrawal supersedes a pending grant, so its delayed receipt cannot re-enable scripts. Active revocation retains the existing cleanup/reload behavior.

Delivery starts with `fetch` keepalive before revocation can reload the page. Transient network/server failures get one bounded retry with the same event UUID and body; client errors do not retry. UUID uniqueness and a transaction prevent duplicate events and partial notice writes. Reusing an event UUID with different contents returns HTTP 409.

Failures emit `consent:error` with code `audit` and reject the API promise. The native interface uses its existing translated failure/retry behavior. Local refusal remains effective even if the promise rejects. Delivery is not guaranteed offline, after tab closure, when keepalive quotas are exhausted, or after a reload prevents a retry. There is no persistent offline queue. Monitor failures in the host application; a manual repeat of the choice creates a new explicit event.

The bundled runtime logs `acceptAll()`, `rejectOptional()`, `choose()`, and `forget()`. PHP `ConsentManager::persist()` and `forget()` remain cookie helpers and do not infer what a custom interface displayed. Custom server endpoints must explicitly use `AuditNotice::seal()` with their server-prepared UI and `AuditRecorder::record()` with the signed notice, event UUID, action, full choices, and optional validated browser history UUID. Do not reconstruct historical notices from the current translations when saving a decision.

## Retention

Audit retention is separate from `consent.retention_days`. Select a period appropriate for your processing and evidence requirements; 180 days is an editable package default, not a prescribed legal duration. A null audit retention disables pruning.

Schedule the command in the consuming application's `routes/console.php`:

```php
use Illuminate\Support\Facades\Schedule;

Schedule::command('consent:audit-prune')->daily()->withoutOverlapping();
```

The command deletes decisions older than the retention cutoff according to server receipt time, then removes old notices with no remaining references. Retained decisions protect their notices through both the pruning query and a restricting foreign key. Pruning is explicit and never happens while reading consent. Owners remain responsible for access control, backups, exports, deletion requests, and retention in other systems.

## Evidence requirements

GDPR Article 7(1) requires controllers relying on consent to demonstrate it. EDPB Guidelines 05/2020, paragraphs 104-108, explain evidence of when/how consent was obtained and what information was presented. This optional history supports that work; it does not certify legal compliance or valid consent. [GDPR](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679), [EDPB Guidelines 05/2020](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf).
