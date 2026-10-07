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

    // This registry describes services. It does not load scripts or trackers.
    // Each service requires category, name, description, and an optional boolean enabled.
    // Optional cookies: [['name' => '_example', 'path' => '/', 'domain' => null]].
    // Use prefix instead of name to match visible cookies with a known prefix.
    'services' => [],
];
