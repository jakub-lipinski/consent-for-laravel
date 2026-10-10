# Google Analytics 4 and Google Ads

## When to Read This Reference

Read when configuring GA4/Ads, choosing Google consent behavior, sending events/conversions, or measuring SPA navigation.

## Configuration

Edit these entries inside `consent.presets`, preserving the other presets:

```php
'ga4' => [
    'enabled' => true,
    'measurement_id' => env('CONSENT_GA4_ID'),
    'send_page_view' => true,
],
'google_ads' => [
    'enabled' => true,
    'conversion_id' => env('CONSENT_GOOGLE_ADS_ID'),
],
```

```dotenv
CONSENT_GA4_ID=G-XXXXXXXXXX
CONSENT_GOOGLE_ADS_ID=AW-123456789
```

Use the application's actual public IDs and enable only requested destinations. Leave `google.enabled` at its default null for automatic bridge activation. `google.mode` defaults to `basic`; `advanced` is an explicit configuration choice. Remove duplicate gtag/GTM installations of these destinations. The preset owns one shared gtag.js library, its globals, and destination registration.

## Automatic Measurements

Basic waits for permission: GA4 requires analytics, Ads requires marketing. Only permitted destinations initialize, including when the other category remains denied. GA4 sends one initial page view per full document by default. Ads initialization does not infer or send a purchase/conversion.

Advanced loads/configures enabled Google presets while optional consent is denied and permits Google's cookieless pings. It does not enable guarded business events, custom blocks, or other vendors without consent. The interface displays an additional disclosure. Do not present Advanced as zero processing before consent.

## Additional Measurements

### GA4 Events

Call after a confirmed application action, using the exact configured destination:

```js
await Consent.google.event('G-XXXXXXXXXX', 'purchase', {
    transaction_id: order.id,
    value: order.total,
    currency: order.currency,
});
```

Signature: `event(destination, name, parameters = {})`. For GA4, the name is a valid event such as `login`, `sign_up`, or `purchase`; the application supplies the appropriate vendor schema. The package accepts names starting with a letter and containing up to 40 letters/digits/underscores. Keep personally identifying data out of ordinary parameters.

### Google Ads Conversions

Use the configured Ads ID plus the real conversion label from Google Ads:

```js
await Consent.google.event(
    'AW-123456789/YOUR_CONVERSION_LABEL',
    'conversion',
    { transaction_id: order.id, value: order.total, currency: order.currency },
);
```

Ads requires `conversion` and an ID/label destination. GA4 uses its exact ID without this label. The helper routes internally and rejects `send_to`/`event_callback` overrides. Stable order IDs support the application's deduplication strategy; prevent duplicate success callbacks. The package does not install enhanced conversions or a server event integration.

### SPA Views

For application-managed page views, set `ga4.send_page_view` to false and call after committing the URL/title:

```js
await Consent.google.event('G-XXXXXXXXXX', 'page_view', {
    page_location: window.location.href,
    page_title: document.title,
});
```

Review GA4 enhanced measurement settings for overlapping automatic history tracking. Keep one runtime per document. `Consent.google.state()` exposes a frozen mapping of current consent signals without proving delivery.

## Consent and Withdrawal

Analytics maps to `analytics_storage`; marketing maps to ad storage/user data/personalization signals. Signals update before application change listeners. Event helpers still require the matching category in both Google modes; see [browser API](../browser-api.md) for dispatch results and no replay.

Active preset withdrawal requires reload. Declare matching cleanup `cookie_path`/`cookie_domain` when vendor cookies use a different scope; these options describe cleanup, not arbitrary Google tracker configuration. The package uses GA4 `_ga`/`_ga_` and Ads `_gcl_` rules.

## Verification

Check analytics-only and marketing-only grants independently. Inspect destination and command/payload for each event, missing-label rejection, duplicate page views, and active withdrawal. Test Advanced pending traffic according to its documented behavior. Browser dispatch checks do not establish account reporting; use the actual property's diagnostics/Tag Assistant when available.

## Common Pitfalls

- Assuming the event name alone chooses GA4 versus Ads.
- Sending Ads events without a conversion label or using a name other than `conversion`.
- Claiming enabling Ads automatically measures successful purchases.
- Adding a second gtag bootstrap or overriding package consent signals.
- Expecting Advanced to grant optional event permission.
