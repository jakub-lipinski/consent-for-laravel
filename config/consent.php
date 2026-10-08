<?php

return [
    // Increment when the purposes or consent policy change.
    'policy_version' => '1',

    // Acceptance and refusal have the same lifetime, measured from the decision.
    'retention_days' => 180,

    'cookie' => [
        'name' => 'consent_preferences',
        'path' => '/',
        'domain' => null,
        // null follows the request's HTTPS status. Configure trusted proxies.
        'secure' => null,
        'same_site' => 'lax',
    ],

    'loader' => [
        'script_timeout_ms' => 15000,
        'cleanup_timeout_ms' => 3000,
    ],

    'ui' => [
        'position' => 'bottom-left',
        // null uses the application's locale, with English as the fallback.
        'locale' => null,
        'policy_url' => null,
        // Optional six-digit hex colors. Contrast is validated before rendering.
        'colors' => [],
    ],

    // null enables the bridge automatically when a Google preset is enabled.
    // true enables consent signals for your own gated gtag scripts; false disables it.
    // Advanced explicitly allows Google tags and cookieless pings before permission.
    'google' => ['enabled' => null, 'mode' => 'basic'],

    // Presets register their services, cleanup rules, and browser initialization.
    'presets' => [
        'ga4' => [
            'enabled' => false,
            'measurement_id' => env('CONSENT_GA4_ID'),
            'send_page_view' => true,
        ],
        'google_ads' => [
            'enabled' => false,
            'conversion_id' => env('CONSENT_GOOGLE_ADS_ID'),
        ],
    ],

    // Custom services describe purposes. Gate their scripts with @consent.
    // Each service requires category, name, description, and an optional boolean enabled.
    // Optional cookies: [['name' => '_example', 'path' => '/', 'domain' => null]].
    // Use prefix instead of name to match visible cookies with a known prefix.
    'services' => [],
];
