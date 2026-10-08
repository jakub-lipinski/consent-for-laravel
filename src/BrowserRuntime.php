<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\Contracts\Config\Repository;
use RuntimeException;

final readonly class BrowserRuntime
{
    public function __construct(private ConsentSettings $settings, private ServiceRegistry $services, private Repository $configuration) {}

    /** @return array<string, mixed> */
    public function configuration(): array
    {
        return [
            'schemaVersion' => ConsentState::SCHEMA_VERSION,
            'policyVersion' => $this->settings->policyVersion,
            'servicesVersion' => $this->services->version(),
            'categories' => array_map(fn (Category $category): string => $category->value, $this->services->categories()),
            'retentionDays' => $this->settings->retentionDays,
            'cookie' => [
                'name' => $this->settings->cookieName,
                'path' => $this->settings->cookiePath,
                'domain' => $this->settings->cookieDomain,
                'secure' => $this->settings->cookieSecure,
                'sameSite' => $this->settings->cookieSameSite,
            ],
            'services' => array_values(array_map(fn (Service $service): array => $service->toArray(), $this->services->all())),
            'protectedCookies' => array_values(array_unique(array_filter([
                $this->settings->cookieName, 'XSRF-TOKEN', 'laravel_session', $this->configuration->get('session.cookie'),
            ], is_string(...)))),
            'scriptTimeoutMs' => $this->settings->scriptTimeoutMs,
            'cleanupTimeoutMs' => $this->settings->cleanupTimeoutMs,
            'google' => (new GoogleSettings($this->configuration->get('consent.google', []), $this->configuration->get('consent.presets', [])))->toArray(),
            'trackers' => (new TrackerSettings($this->configuration->get('consent.presets', [])))->toArray(),
        ];
    }

    public function json(): string
    {
        return json_encode($this->configuration(), JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_THROW_ON_ERROR);
    }

    public function source(): string
    {
        return file_get_contents(__DIR__.'/../resources/js/consent.js') ?: throw new RuntimeException('Consent browser runtime is missing.');
    }
}
