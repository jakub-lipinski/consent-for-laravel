<?php

namespace ConsentForLaravel\ConsentForLaravel;

use InvalidArgumentException;

final readonly class TrackerSettings
{
    public const PRESET_KEYS = ['ga4', 'google_ads', 'meta_pixel', 'clarity'];

    public const SERVICE_DEFAULTS = [
        'meta-pixel' => ['name' => 'Meta Pixel', 'description' => 'Measure advertising results and interactions with this website.'],
        'microsoft-clarity' => ['name' => 'Microsoft Clarity', 'description' => 'Understand website usage through session recordings and heatmaps.'],
        'microsoft-clarity-ads' => ['name' => 'Microsoft Clarity advertising', 'description' => 'Allow advertising-related storage in Microsoft Clarity.'],
    ];

    /** @var array<string, array<string, mixed>> */
    private array $services;

    /** @var array<string, array<string, mixed>> */
    private array $trackers;

    public function __construct(mixed $presets = [])
    {
        if (! is_array($presets) || array_diff(array_keys($presets), self::PRESET_KEYS) !== []) {
            throw new InvalidArgumentException('Invalid consent.presets configuration.');
        }
        $services = [];
        $trackers = [];
        foreach (['meta_pixel', 'clarity'] as $preset) {
            $definition = array_key_exists($preset, $presets) ? $presets[$preset] : [];
            $meta = $preset === 'meta_pixel';
            $idKey = $meta ? 'pixel_id' : 'project_id';
            $optionKey = $meta ? 'send_page_view' : 'advertising';
            $allowed = ['enabled', $idKey, $optionKey, 'name', 'description', 'cookie_path', 'cookie_domain'];
            if (! $meta) {
                $allowed = [...$allowed, 'advertising_name', 'advertising_description'];
            }
            if (! is_array($definition) || array_diff(array_keys($definition), $allowed) !== []) {
                throw new InvalidArgumentException("Invalid tracker preset [{$preset}].");
            }
            $active = array_key_exists('enabled', $definition) ? $definition['enabled'] : false;
            $option = array_key_exists($optionKey, $definition) ? $definition[$optionKey] : $meta;
            $id = $definition[$idKey] ?? null;
            $pattern = $meta ? '/\A[1-9][0-9]{0,19}\z/' : '/\A[a-z0-9]{1,32}\z/';
            if (! is_bool($active) || ! is_bool($option)
                || ($id !== null && (! is_string($id) || ! preg_match($pattern, $id)))
                || ($active && $id === null)) {
                throw new InvalidArgumentException("Tracker preset [{$preset}] requires a valid {$idKey} string and boolean options.");
            }
            $serviceId = $meta ? 'meta-pixel' : 'microsoft-clarity';
            $service = [
                'category' => $meta ? 'marketing' : 'analytics',
                'name' => array_key_exists('name', $definition) ? $definition['name'] : self::SERVICE_DEFAULTS[$serviceId]['name'],
                'description' => array_key_exists('description', $definition) ? $definition['description'] : self::SERVICE_DEFAULTS[$serviceId]['description'],
                'enabled' => $active,
                'cookies' => array_map(fn (string $name): array => [
                    'name' => $name, 'path' => $definition['cookie_path'] ?? '/', 'domain' => $definition['cookie_domain'] ?? null,
                ], $meta ? ['_fbp', '_fbc'] : ['_clck', '_clsk']),
            ];
            new ServiceRegistry([$serviceId => $service]);
            $advertisingService = self::SERVICE_DEFAULTS['microsoft-clarity-ads'] + ['category' => 'marketing', 'enabled' => true, 'cookies' => []];
            if (! $meta) {
                foreach (['name', 'description'] as $field) {
                    if (array_key_exists('advertising_'.$field, $definition)) {
                        $advertisingService[$field] = $definition['advertising_'.$field];
                    }
                }
                new ServiceRegistry(['microsoft-clarity-ads' => $advertisingService]);
            }
            if (! $active) {
                continue;
            }
            $services[$serviceId] = $service;
            $trackers[$meta ? 'meta' : 'clarity'] = ['id' => $id, $meta ? 'sendPageView' : 'advertising' => $option];
            if (! $meta && $option) {
                $services['microsoft-clarity-ads'] = $advertisingService;
            }
        }
        $this->services = $services;
        $this->trackers = $trackers;
    }

    /** @return array<string, array<string, mixed>> */
    public function services(): array
    {
        return $this->services;
    }

    /** @return array<string, array<string, mixed>> */
    public function toArray(): array
    {
        return $this->trackers;
    }
}
