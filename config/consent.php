<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Consent Policy
    |--------------------------------------------------------------------------
    |
    | Increment the policy version when your purposes or consent policy change.
    | Acceptance and refusal are remembered for the same number of days,
    | measured from the visitor's decision.
    |
    */

    'policy_version' => '1',

    'retention_days' => 180,

    /*
    |--------------------------------------------------------------------------
    | Preference Cookie
    |--------------------------------------------------------------------------
    |
    | Configure the cookie used to remember the visitor's preferences.
    | A null domain creates a host-only cookie. A null secure value follows
    | the request's HTTPS status; configure trusted proxies when needed.
    |
    */

    'cookie' => [
        'name' => 'consent_preferences',
        'path' => '/',
        'domain' => null,
        'secure' => null,
        'same_site' => 'lax',
    ],

    /*
    |--------------------------------------------------------------------------
    | Browser Timeouts
    |--------------------------------------------------------------------------
    |
    | Maximum time, in milliseconds, for loading external scripts and running
    | cooperative cleanup when consent is withdrawn.
    |
    */

    'loader' => [
        'script_timeout_ms' => 15000,
        'cleanup_timeout_ms' => 3000,
    ],

    /*
    |--------------------------------------------------------------------------
    | Consent Interface
    |--------------------------------------------------------------------------
    |
    | Appearance settings apply to the banner, preferences dialog, and launcher.
    | A null locale follows the application locale, with parent-language and
    | English fallbacks. Custom translation locales are also supported.
    |
    | Bundled languages: en, pl, de, fr, it, es, pt (European Portuguese).
    |
    */

    'ui' => [
        // Supported: standard, compact.
        'variant' => 'standard',

        // Supported: bottom-left, bottom-right, bottom-center.
        'position' => 'bottom-left',

        // Supported: light, dark, auto (browser/system preference).
        'theme' => 'light',

        'locale' => null,

        // Optional policy link: '/privacy' or a full HTTP(S) URL.
        'policy_url' => null,

        // Check both palettes. Identical theme warnings are logged once per
        // 72 hours using the default cache store. Cache or logging failures
        // never interrupt rendering.
        'validate_contrast' => false,

        // Override light colors using six-digit HEX values.
        // Missing or invalid values fall back to the light palette defaults.
        // Invalid values produce a warning.
        //
        // Keys: background, text, muted, accent, accent_text,
        //       border, control, focus.
        'colors' => [
            // 'accent' => '#245c49',
            // 'accent_text' => '#ffffff',
        ],

        // Override dark colors using the same keys and format.
        // Missing or invalid values fall back to the dark palette defaults.
        'dark_colors' => [
            // 'accent' => '#8dd8b4',
            // 'accent_text' => '#10251b',
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Google Consent Mode
    |--------------------------------------------------------------------------
    |
    | A null enabled value activates the bridge when a Google preset is enabled.
    | Set true for your own gated gtag scripts. Set false only when no Google
    | presets are enabled.
    |
    | Basic mode waits for permission. Advanced mode explicitly allows Google
    | tags and cookieless pings before permission.
    |
    */

    'google' => [
        'enabled' => null,
        'mode' => 'basic',
    ],

    /*
    |--------------------------------------------------------------------------
    | Built-in Integrations
    |--------------------------------------------------------------------------
    |
    | Enable the integrations you use and provide their identifiers.
    | Presets register services and manage script loading and withdrawal.
    | All integrations are disabled by default.
    |
    */

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

        'meta_pixel' => [
            'enabled' => false,
            'pixel_id' => env('CONSENT_META_PIXEL_ID'),
            'send_page_view' => true,
        ],

        'clarity' => [
            'enabled' => false,
            'project_id' => env('CONSENT_CLARITY_ID'),

            // Advertising also requires marketing permission.
            'advertising' => false,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Custom Services
    |--------------------------------------------------------------------------
    |
    | Describe each service's purpose here, then gate its scripts with @consent.
    | Registration alone does not load scripts. Each service requires a stable
    | ID, category, name, and description. The enabled flag defaults to true.
    |
    | Categories: necessary, analytics, marketing, performance, other.
    | Choose the category according to the service's actual purpose.
    |
    */

    'services' => [
        // 'site-analytics' => [
        //     'category' => 'analytics',
        //     'name' => 'Site analytics',
        //     'description' => 'Measure visits and navigation.',
        //     'enabled' => true,
        //     'cookies' => [
        //         ['name' => '_example', 'path' => '/', 'domain' => null],
        //     ],
        // ],
        //
        // Cookie cleanup rules accept either an exact name or a prefix.
        // Replace 'name' with 'prefix' to match a family of visible cookies.
    ],

];
