# Changelog

## Unreleased

- Organize the published config into Laravel-style sections with supported options and commented color/service examples, preserving all configuration defaults.
- Add configuration-only `ui.theme` modes: light (backward-compatible default), dark, and auto via CSS browser/system preference. Both variants share themed banners, dialogs, fallbacks, and launchers, with scoped native control/scrollbar colors and independent `ui.dark_colors` overrides.
- Validate both palettes, identify light/dark diagnostic issues, and include both resolved palettes in 72-hour warning suppression without changing saved consent or browser script gates.

- Limit identical theme diagnostic logging attempts to once every 72 hours using the application's default cache. Changed palettes or detected issues can be reported immediately; cache/logger failures preserve rendering and do not bypass suppression.
- Add German, French, Italian, Spanish, and European Portuguese interface translations, including accessible labels, status messages, category purposes, and preset descriptions.
- Support application-provided translation locales without a language allowlist. Component/config/app locale selection, regional and script parents, and deterministic English fallback work with hyphen or underscore translation directories.
- Resolve missing/blank UI and service translations per key without changing canonical service purposes, consent fingerprints, saved choices, or decision lifetimes. Document custom dictionaries and locale-aware HTML caching.

## v1.1.3 - Non-blocking theme diagnostics

- Color contrast no longer interrupts host-page rendering. `ui.validate_contrast` defaults to `false`; when enabled, it logs warnings and preserves the chosen colors.
- Invalid color formats fall back to their defaults, unknown keys are ignored, and malformed color arrays use the default palette. Unsafe values never enter CSS. Diagnostic logging failures do not break the page.
- Existing published configuration works without adding the new key. Theme diagnostics do not change consent decisions, lifetimes, service fingerprints, or tracker gates.
- See [release notes](docs/releases/v1.1.3.md).

## v1.1.2 - Reliable focus and consent withdrawal

- Clicking or focusing a large page container no longer hides the pending banner and its launcher. Overlays still yield to fully covered host-page controls.
- Pending Google, Meta, and Clarity events no longer delay saving a refusal or withdrawal. Consent is rechecked before dispatch, independently of SDK loading.
- Gated modules may await preset event helpers without waiting on their own completion. Presets and custom scripts retain ordered, deduplicated loading.
- The same script timeout triggers at most one automatic reload per tab until that script succeeds; repeated timeouts or unavailable retry storage request manual recovery.
- Update/cache-bust both browser scripts when serving published assets. Configuration, translations, cookie schema, fingerprints, and saved decisions remain compatible.
- See [release notes](docs/releases/v1.1.2.md).

## v1.1.1 - Service disclosures in both variants

- Standard and Compact both use initially collapsed, independently expandable service lists in every populated category. Category purposes remain visible.
- A decorative chevron beside each disclosure label points down when closed and up when open. Native keyboard interaction and expanded-state semantics are preserved.
- Opening or closing service details does not change category choices, save preferences, or activate optional scripts.
- Merge the updated banner view and deploy/cache-bust the matching CSS when customizing published resources. No configuration, translation, cookie-schema, or runtime API changes are required.
- See [release notes](docs/releases/v1.1.1.md).

## v1.1.0 - Standard and Compact interfaces

### Added

- `consent.ui.variant` with validated `standard` and `compact` values, and a `variant` Blade component override.
- A matching Compact banner and preferences dialog with less spacing, simpler corners, outlined choice buttons, responsive actions, and native service-list disclosures. Category purposes remain visible and complete service details stay available.
- Coverage for defaults, overrides, invalid values, configuration caching, saved-decision compatibility, SPA remounting, and both variants/languages in semantic accessibility checks.

### Fixed

- Policy links and action buttons keep the interface's alignment when the host page supplies generic anchor padding or button margins.

### Upgrade Notes

- Standard preserves the original interface and remains the default for existing published configurations. UI variant changes do not invalidate or extend saved choices.
- Merge `ui.variant` into published configuration, update customized banner views, and republish/cache-bust assets when served separately. Rebuild configuration/view caches and restart persistent workers.
- See [complete release notes](docs/releases/v1.1.0.md) and the [interface guide](docs/interface.md).

## v1.0.0 - Cookie consent for Laravel

- Composer package: `jakub-lipinski/consent-for-laravel`.

### Added

- First stable release of the PHP, Blade, browser, and configuration APIs for PHP 8.3+ and Laravel 12-13.
- Complete purpose-based preferences, three-position English/Polish interface, ordered cache-safe script gating, and consent withdrawal.
- Google Consent Mode v2, GA4, Google Ads, Meta Pixel, and Microsoft Clarity presets with guarded events and provider-specific consent signals.
- Standard Composer installation instructions and documentation covering implemented capabilities.

### Fixed

- Google events requested without consent are discarded even behind a queued acceptance; event parameters are captured at invocation.
- Google command failures no longer interrupt withdrawal cleanup or required reload.
- Preference cookie names cannot collide with Laravel remember-me cookies through the `remember_` prefix.

### Changed

- Exported archives exclude npm development manifests and locks.
- Current documentation uses the stable release, with future integration promises removed.

### Upgrade Notes

- Unchanged service fingerprints and cookie schema 1 remain compatible. Refresh published assets/caches and merge customized resources.
- Keep preference cookie names separate from session, CSRF, and remember-me cookies.
- See [complete release notes](docs/releases/v1.0.0.md) for installation, available APIs, verification, and integration responsibilities.

## v1.0.0-beta.5 - Meta Pixel and Microsoft Clarity

### Added

- ID-based Meta Pixel and Microsoft Clarity presets with strict marketing/analytics loading gates.
- Guarded Meta standard/custom events, optional event IDs, and PageView control for SPA owners.
- Clarity Consent API v2, custom events, and explicitly enabled advertising requiring separate marketing permission.
- English/Polish purposes, canonical overrides, cookie cleanup declarations, strict settings, and integration fingerprints.

### Changed

- Meta/Clarity receive new consent signals before listeners and mandatory active withdrawal reload.
- Existing tracker installs fail closed; ordinary provider failures are isolated, while load timeouts require a fresh document.
- GTM is deferred with no assigned beta. Beta.6 now targets release preparation.

### Upgrade Notes

- Merge new configuration/translations, remove duplicate installs, and refresh published assets/caches.
- Enable Require cookie consent and configure masking for Clarity; verify vendor account behavior separately.
- Cookie schema and inactive beta.4 fingerprints remain compatible. Active tracker changes invalidate decisions.
- See [release notes](docs/releases/v1.0.0-beta.5.md) and the [tracker guide](docs/tracker-presets.md).


## v1.0.0-beta.4 - Google consent and measurement presets

The fourth beta adds Consent Mode v2 and ID-based GA4 / Google Ads setup.

### Added

- Basic and explicit Advanced gtag.js modes, ordered denied defaults/restored updates, and English/Polish Advanced disclosures.
- GA4/Google Ads presets, automatic service registration and cookie cleanup rules, a shared loader, and nonce propagation.
- Guarded `Consent.google.event(destination, name, parameters)` and mapped `Consent.google.state()`.
- SPA page-view control, explicit Ads conversion labels, strict settings, and integration-aware fingerprints.
- Local mock-tag tests for grant/refusal, restoration, routing, loading failures, expiry, storage failure, and withdrawal.

### Changed

- Active Google preset withdrawal always reloads after applying denied signals, even with cooperative custom hooks.
- Duplicate Google bootstraps fail closed; privacy controls disable Google signals/ad personalization features and URL passthrough.
- Documentation/presentation and disposable browser hosts remain outside this Composer library.

### Fixed

- External modules now wait for imports and top-level await after their original SRI-checked load before dependent scripts continue.

### Upgrade Notes

- Merge new Google/preset settings, supply IDs, remove duplicate vendor installs, and update published assets/views/translations.
- Presets remain disabled by default; beta.3 decisions stay compatible when Google is inactive.
- Enabled target, mode, ID, initialization, purpose, or cleanup changes invalidate previous decisions.
- GTM and other presets remain planned. See the [complete release notes](docs/releases/v1.0.0-beta.4.md) and [Google guide](docs/google.md).

## v1.0.0-beta.3 - Accessible cookie preferences

The third development beta provides a complete English/Polish cookie collection interface connected to the existing consent runtime.

### Added

- `<x-consent::banner />` in bottom-left, bottom-right, and wide bottom-center layouts.
- A white theme with light shadow, sentence case headings, spacious controls, and equally prominent acceptance/refusal.
- Native preferences modal, only used categories, service purposes, explicit draft saving, and a small reopening icon.
- English/Polish UI, locale overrides, service-display translations, policy URL, and validated contrast-aware colors.
- Keyboard and focus management, alerts/status, reflow and text-spacing support, and protection against obscuring host-page focus.
- Custom `data-consent-open` buttons, `Consent.openPreferences()`, and a readable unavailable-interface fallback.
- Blade/PHP interface tests, axe-core structural checks, native-browser verification, and an accessibility integration guide.

### Changed

- Added the direct Illuminate Translation dependency and implemented UI configuration.
- Asset publishing now includes the UI script and stylesheet alongside the core runtime.
- Connected storage errors, external decision changes, expiry, and withdrawal to the interface.

### Upgrade Notes

- Add the banner component, merge `consent.ui`, set the actual cookie policy, and rebuild configuration/view caches.
- Refresh published assets/overridden views and supply script/style CSP nonces where required.
- Existing decisions retain the same schema and remain valid with unchanged policy/service metadata.
- The interface targets applicable WCAG 2.2 A/AA criteria; customizations and the host website require their own assessment.
- GCM v2 and tracker presets remain in later milestones. See the [complete release notes](docs/releases/v1.0.0-beta.3.md).

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
- Node/jsdom tests, a real PHP/browser serialization test, native-browser verification, and JavaScript checks in CI.

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
