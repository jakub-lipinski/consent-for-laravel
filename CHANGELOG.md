# Changelog

## v1.0.0-beta.2 - Consent-aware script lifecycle

The second development beta activates declared scripts only after consent and handles preference changes on a running page.

### Added

- `@consent('category', 'optional-stable-id')` and `@endconsent` for inert, cache-safe script blocks.
- `<x-consent::head />`, CSP nonce support, and optional published browser assets.
- A framework-free browser API sharing the PHP cookie contract, including choose, accept, reject, forget, change notifications, and revocation hooks.
- Ordered classic/module execution, duplicate block/source prevention, permission rechecks, and SPA fragment discovery.
- Default reload for running or in-flight code on withdrawal, cooperative cleanup, bounded timeouts, and script/storage diagnostics.
- First-party cookie cleanup rules with protection for preference, session, CSRF, and remember cookies.
- Fail-closed storage handling, temporary same-tab denial recovery, and synchronization of expiry, server updates, and other tabs.
- Node/jsdom tests, a real PHP/browser serialization test, a manual browser fixture, and JavaScript checks in CI.

### Changed

- Added the direct Illuminate View dependency and implemented loader configuration.
- Extended service fingerprints with non-empty cleanup rules while preserving beta.1 fingerprints when rules are absent or empty.
- Updated usage documentation with the Blade and browser APIs, lifecycle guarantees, and limitations.

### Upgrade Notes

- Add the head component and wrap optional scripts; the package does not intercept undeclared scripts or requests.
- Review the new configuration, rebuild configuration/view caches, and refresh published assets or overridden views.
- Banner UI, English/Polish strings, WCAG verification, GCM v2, and tracker presets remain scheduled for later betas.
- See the [complete release notes](docs/releases/v1.0.0-beta.2.md) for examples and withdrawal behavior.

## v1.0.0-beta.1 - Versioned consent foundation

The first development beta implements a service registry and versioned, expiring consent decisions in a first-party cookie.

### Added

- Validated enabled services and five consent categories, exposing only used optional categories.
- Immutable consent state and a public PHP API to read, choose, accept, reject, persist, and forget preferences.
- Equal persistence for acceptance and refusal, defaulting to 180 days.
- Schema and policy versions, deterministic service fingerprints, and automatic invalidation of outdated decisions.
- Strict validation of configuration and stored cookies, plus private, non-cacheable persistence responses.
- Laravel cookie middleware integration and integration tests for HTTP round trips, expiry, malformed values, and configuration.
- Composer package foundation, resource namespaces, formatting, static analysis, and Laravel 12-13 compatibility CI.

### Changed

- Populated the skeleton configuration with implemented settings.
- Documented the PHP API and remaining beta milestones.

### Upgrade Notes

- Republish configuration if using the initial skeleton and rebuild the application's configuration cache.
- This beta does not yet include banner UI, script blocking, GCM v2, or tracker presets.
- See the [complete release notes](docs/releases/v1.0.0-beta.1.md) for usage and release scope.
