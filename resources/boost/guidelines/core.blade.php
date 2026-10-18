@verbatim
## Consent for Laravel

This application uses `jakub-lipinski/consent-for-laravel` for consent preferences, guarded scripts, tracking presets, and optional decision auditing.

- Activate `consent-for-laravel-development` when configuring this package, changing its interface, integrating trackers, measuring events, or working with consent decisions.
- Inspect `config/consent.php`, the shared Blade layout, and existing tracker installations before making changes. Preserve the application's selected integrations and customizations.
- Built-in presets register their own services and SDKs. Custom providers need a service definition and `@consent` script blocks.
- Keep script markup inert and independent of request cookies so cached HTML works for every visitor. Use guarded `Consent` helpers for measurements.
- Optional categories are denied without a current valid decision. Keep Google Basic unless the task calls for explicit Advanced behavior; other presets remain strictly gated.
- Preserve withdrawal and protected session/CSRF cookies. An active built-in preset requires reload after withdrawal.
- Livewire uses the existing Blade/browser API. Preserve stable script IDs and one UI/notice container; set the app locale before rendering. Read the skill's Livewire reference for navigation, component language changes, persist and CSP.
- The preference cookie is not authorization or database evidence. Enable database auditing only when the application needs it; the package does not certify legal compliance.
@endverbatim
