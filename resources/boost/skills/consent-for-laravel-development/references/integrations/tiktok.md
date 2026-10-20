# TikTok Pixel

## When to Read This Reference

Read when configuring TikTok Pixel, sending standard/custom events, measuring SPA views, or supplying Advanced Matching hashes.

## Configuration

Edit the existing entry inside `consent.presets`:

```php
'tiktok_pixel' => [
    'enabled' => true,
    'pixel_id' => env('CONSENT_TIKTOK_PIXEL_ID'),
    'send_page_view' => true,
    'cookie_path' => '/',
    'cookie_domain' => null,
],
```

```dotenv
CONSENT_TIKTOK_PIXEL_ID=C1234567890ABCDEFGHI
```

Replace the illustrative ID with the actual public Pixel code. The preset accepts a 20-character uppercase alphanumeric string, registers `tiktok-pixel` in marketing, and owns `ttq`/`TiktokAnalyticsObject` for one Pixel. Remove duplicate snippets, tags, and noscript pixels. Never put an Events API access token in browser configuration.

## Automatic Measurements

No SDK is requested without marketing, including in Google Advanced. After permission, the preset loads the bootstrap, waits for its second-stage runtime, and sends one initial `page()` unless `send_page_view` is false. It does not infer successful purchases/registrations. Review account-controlled automatic events, SPA handling, matching, and data sharing for additional or overlapping SDK behavior.

## Additional Measurements

### Standard and Custom Events

```js
// After the application confirms a successful order:
await Consent.tiktok.track('Purchase', {
    value: order.total,
    currency: order.currency,
    contents: [{ content_id: 'boots-42', content_type: 'product', price: 99.90, quantity: 2 }],
}, { eventID: order.id });

await Consent.tiktok.trackCustom('NewsletterSignup', { source: 'footer' });
```

Signatures: `track(name, parameters = {}, options = {})` and `trackCustom(name, parameters = {}, options = {})`. Both use TikTok's `track` command; there is no separate vendor `trackCustom`. Use current standard names such as `Purchase`, `CompleteRegistration`, and `ViewContent`, and application-defined names for custom events.

The package accepts names starting with a letter, using up to 50 letters/digits/underscores. Parameters must be a JSON object with finite numbers; undefined values, functions, symbols, BigInt, and cycles are rejected. Data is copied at invocation. Options accept only non-blank `eventID` up to 128 characters without controls; it maps to `event_id`, while the preset supplies its configured `pixel_code`.

Stable event IDs can participate in a separately implemented Events API deduplication strategy. They do not install that API or eliminate every repeated browser call. See [browser API](../browser-api.md) for helper result/consent semantics.

### SPA Views

With package-generated initial views disabled, call after committing the route URL/title:

```js
await Consent.tiktok.pageView();
```

Signature: `pageView()`. The package installs no router listener. Review TikTok automatic SPA behavior to avoid overlaps.

### Optional Advanced Matching

```js
await Consent.tiktok.identify({
    sha256_email: normalizedEmailSha256,
    sha256_phone_number: normalizedPhoneSha256,
    external_id: stableUserIdSha256,
});
```

Supply one or more of these keys as lowercase 64-character hexadecimal SHA-256 digests. Normalize/hash identifiers in the application according to the provider's matching rules before this call; raw values are rejected. Supply the relevant matching identity before events when the requested integration needs it. Hashes remain identifying data, and the helper does not collect fields, compute hashes, or enable account-level automatic matching by itself.

## Consent and Withdrawal

The local stub starts held/revoked; SDK loading is additionally gated. Current consent is reapplied before measurements. Marketing withdrawal revokes before change listeners, cancels pending events, and requires reload after active/in-flight loading.

With Livewire, a temporary navigation pause preserves SDK readiness and resumes initialization once after a compatible visit with a current marketing grant. Calls made during navigation are discarded. SDK failure, expiry, withdrawal, and bounded waits for an unready SDK remain authoritative.

Cleanup declares `_ttp`, `ttclid`, `ttcsid`, `_tt_enable_cookie`, and `ttcsid_` names at the configured scope. These scope settings describe cleanup, not TikTok's native cookie scope. Other paths/domains, plugins, HttpOnly cookies, and TikTok/Pangle third-party cookies require appropriate owner handling; already dispatched data cannot be recalled.

## Verification

Check pending/refusal/analytics-only states, both SDK stages, one initial view, Purchase fields, event ID mapping, custom events, SPA duplication, and matching hashes. Withdraw while either SDK stage/event is pending and ensure no replay. Locally dispatched commands do not establish processing/reporting by a live Ads account.

## Common Pitfalls

- Copying Meta's distinct `trackCustom` vendor command or assuming identical event schemas.
- Passing another Pixel ID or overriding `pixel_code` through options.
- Passing raw email/phone/user IDs to `identify`.
- Treating the bootstrap load event as full SDK initialization.
