# Meta Pixel

## When to Read This Reference

Read when configuring Meta Pixel, sending standard/custom events, or managing application-owned SPA views.

## Configuration

Edit the existing entry inside `consent.presets`:

```php
'meta_pixel' => [
    'enabled' => true,
    'pixel_id' => env('CONSENT_META_PIXEL_ID'),
    'send_page_view' => true,
],
```

```dotenv
CONSENT_META_PIXEL_ID=123456789012345
```

Use the real Pixel ID as a string; the package accepts 1–20 digits starting with 1–9. Remove other Meta snippets, noscript pixels, and duplicate tag-manager installs. The preset registers `meta-pixel` in marketing and owns `fbq`/`_fbq` for one Pixel.

## Automatic Measurements

No SDK request occurs without a current marketing grant, including in Google Advanced. With permission, the preset initializes once and sends an initial PageView unless `send_page_view` is false. Purchases, registrations, and other business outcomes require application events. Review account-level automatic events and matching separately.

## Additional Measurements

```js
// After the application confirms a successful order:
await Consent.meta.track('Purchase', {
    value: order.total,
    currency: order.currency,
}, { eventID: order.id });

await Consent.meta.trackCustom('NewsletterSignup', { source: 'footer' });
```

Signatures: `track(name, parameters = {}, options = {})` and `trackCustom(name, parameters = {}, options = {})`. They use distinct Meta commands. Options accept only a non-blank `eventID` string up to 128 characters. It can participate in a separately implemented browser/server deduplication strategy; it does not add Conversions API or prevent every repeated browser call.

Parameters must be a JSON-serializable object and are captured at invocation. Names start with a letter and use up to 128 letters/digits/underscores/dots/hyphens; Meta's own schemas still apply. Common promise/consent semantics are in [browser API](../browser-api.md).

For application-managed SPA navigation, set `send_page_view` to false and call once after committing a route:

```js
await Consent.meta.track('PageView');
```

## Consent and Withdrawal

Marketing withdrawal signals revoked consent before change listeners, expires declared `_fbp`/`_fbc` cookies, and requires reload after active/in-flight loading. Match cleanup scopes through `cookie_path`/`cookie_domain`. Direct `fbq` calls bypass the guarded helper; remove duplicate installations rather than relying on this preset to control them.

## Verification

Verify pending/refusal/analytics-only states make no Meta request. After marketing acceptance, verify one initialization/PageView and correctly timed events with the intended ID. Check SPA duplicates, blocked SDK behavior, and withdrawal.

## Common Pitfalls

- Sending custom names through the wrong Meta command.
- Measuring the order before application success or on every success-page render.
- Assuming `eventID` implements a server integration.
- Reinitializing the Pixel when the banner or SPA route changes.
