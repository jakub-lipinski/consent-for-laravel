# Matomo

## When to Read This Reference

Read when configuring Matomo Cloud/self-hosted tracking, goals, search, links, SPA views, or e-commerce.

## Configuration

Edit the existing entry inside `consent.presets`:

```php
'matomo' => [
    'enabled' => true,
    'url' => env('CONSENT_MATOMO_URL'),
    'site_id' => env('CONSENT_MATOMO_SITE_ID'),
    'send_page_view' => true,
    'enable_link_tracking' => true,
    'cookie_path' => '/',
    'cookie_domain' => null,
],
```

```dotenv
CONSENT_MATOMO_URL=https://stats.example.com/analytics/
CONSENT_MATOMO_SITE_ID=3
```

Use the actual instance base URL, including any subdirectory, without `matomo.js`, `matomo.php`, credentials, query, or fragment. Cloud uses the account's instance URL. Site ID is a positive integer/decimal string up to 2147483647, without leading zeroes. The preset registers `matomo` in analytics and owns one `_paq`/Matomo tracker. Remove old Matomo/Piwik snippets and tags.

## Automatic Measurements

No SDK or measurement occurs without analytics, including in Google Advanced. With permission, the preset configures the instance/site, sends an initial page view, and enables outlink/download tracking. Each full document gets its own initial view. The two boolean options independently disable automatic page and link measurements while keeping manual helpers available.

## Additional Measurements

### Events, Goals, Search, and Links

```js
await Consent.matomo.event('Account', 'Login');
await Consent.matomo.event('Product', 'Rating', 'Boots', 5);
await Consent.matomo.goal(7, 49.90);
await Consent.matomo.search('winter boots', 'Products', 12);
await Consent.matomo.link('/downloads/catalog.pdf', 'download');
```

| Helper | Arguments |
| --- | --- |
| `event` | `category, action, name?, value?` |
| `goal` | Numeric `id, revenue?`; create the goal in Matomo first |
| `search` | `keyword, category?, resultsCount?` |
| `link` | HTTP(S) `url, type = 'link'`; type can be `download` |

Event category is Matomo's grouping, not a consent category. Every helper needs analytics. Values/revenue are finite and non-negative; result counts are non-negative safe integers. Required strings are non-blank, free of control characters, and up to 1024 JavaScript characters. Optional arguments may be omitted/undefined. Relative link URLs resolve against the document base URL.

### SPA Page Views

For router-owned views, disable the initial page view and call after a committed route:

```js
await Consent.matomo.pageView({ url: '/checkout', title: 'Checkout', referrer: '/cart' });
```

`pageView({ url?, title?, referrer? } = {})` defaults URL/title at invocation. Referrer defaults to the last dispatched page view's URL, or the document referrer initially; use `''` to omit it. The package supplies no router listener. Avoid duplicating automatic first views and manual link measurements.

### E-commerce

Enable e-commerce and set currency in the Matomo website settings. Helpers use that site currency:

```js
await Consent.matomo.ecommerceCart({
    total: 199.80,
    items: [{ sku: 'boots-42', name: 'Boots', price: 99.90, quantity: 2 }],
});

// After confirmed application success:
await Consent.matomo.ecommerceOrder({
    id: 'order-1042',
    total: 199.80,
    items: [{ sku: 'boots-42', name: 'Boots', category: ['Shoes', 'Winter'], price: 99.90, quantity: 2 }],
});
```

Cart requires `total, items`; order requires `id, total, items` and accepts optional `subtotal, tax, shipping, discount`. Money fields are finite/non-negative and supplied by the application. Items contain zero to 200 unique string SKUs; name/category/price/quantity are optional, quantity defaults to 1 and must be a positive safe integer. Category can be a string or up to five strings. Unknown fields are rejected; there is no per-call currency field. The tracker cart is cleared between operations. Common promise semantics are in [browser API](../browser-api.md).

## Consent and Withdrawal

The tracker uses `requireConsent` and document-scoped permission, not cookie-only consent. `cookie_path`/`cookie_domain` configure both native cookies and cleanup. Active withdrawal forgets consent, disables links/heartbeat, deletes declared cookies, and requires reload. Cleanup uses site-specific `_pk_*.<site>.` prefixes and native consent markers; extra plugin cookies/scopes require owner cleanup.

## Verification

Verify instance/site ID in collector requests, automatic and manual views, automatic links versus manual duplicates, pre-created goals, search fields, commerce totals/items, no cart leakage, and analytics withdrawal. Reporting depends on the actual instance settings.

## Common Pitfalls

- Supplying the script URL instead of the instance base URL.
- Confusing event categories with consent categories.
- Sending a currency field unsupported by these commerce helpers.
- Treating a goal call as goal creation or adding a second `_paq` installation.
