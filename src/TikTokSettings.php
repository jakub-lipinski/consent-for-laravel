<?php

namespace ConsentForLaravel\ConsentForLaravel;

use InvalidArgumentException;

final readonly class TikTokSettings
{
    /** @var array<string, array<string, mixed>> */
    private array $services;

    /** @var array<string, mixed>|null */
    private ?array $tracker;

    public function __construct(mixed $definition = [])
    {
        if (! is_array($definition) || array_diff(array_keys($definition), [
            'enabled', 'pixel_id', 'send_page_view', 'name', 'description', 'cookie_path', 'cookie_domain',
        ]) !== []) {
            throw new InvalidArgumentException('Invalid TikTok Pixel preset configuration.');
        }
        $enabled = array_key_exists('enabled', $definition) ? $definition['enabled'] : false;
        $pageView = array_key_exists('send_page_view', $definition) ? $definition['send_page_view'] : true;
        $id = $definition['pixel_id'] ?? null;
        if (! is_bool($enabled) || ! is_bool($pageView)
            || ($id !== null && (! is_string($id) || ! preg_match('/\A[A-Z0-9]{20}\z/', $id)))
            || ($enabled && $id === null)) {
            throw new InvalidArgumentException('TikTok Pixel requires a 20-character uppercase alphanumeric pixel_id and boolean options.');
        }
        $scope = ['path' => array_key_exists('cookie_path', $definition) ? $definition['cookie_path'] : '/', 'domain' => $definition['cookie_domain'] ?? null];
        $service = [
            'category' => 'marketing',
            'name' => array_key_exists('name', $definition) ? $definition['name'] : TrackerSettings::SERVICE_DEFAULTS['tiktok-pixel']['name'],
            'description' => array_key_exists('description', $definition) ? $definition['description'] : TrackerSettings::SERVICE_DEFAULTS['tiktok-pixel']['description'],
            'enabled' => $enabled,
            'cookies' => [
                ...array_map(fn (string $name): array => ['name' => $name] + $scope, ['_ttp', 'ttclid', 'ttcsid']),
                ['prefix' => 'ttcsid_'] + $scope,
                ['name' => '_tt_enable_cookie'] + $scope,
            ],
        ];
        new ServiceRegistry(['tiktok-pixel' => $service]);
        $this->services = $enabled ? ['tiktok-pixel' => $service] : [];
        $this->tracker = $enabled ? ['id' => $id, 'sendPageView' => $pageView] : null;
    }

    /** @return array<string, array<string, mixed>> */
    public function services(): array
    {
        return $this->services;
    }

    /** @return array<string, mixed>|null */
    public function toArray(): ?array
    {
        return $this->tracker;
    }
}
