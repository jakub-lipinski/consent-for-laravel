# Changelog

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
