<?php

namespace ConsentForLaravel\ConsentForLaravel;

use InvalidArgumentException;

final readonly class GoogleSettings
{
    public const SERVICE_DEFAULTS = [
        'google-ga4' => ['name' => 'Google Analytics 4', 'description' => 'Measure website visits and usage.'],
        'google-ads' => ['name' => 'Google Ads', 'description' => 'Measure advertising conversions and manage advertising consent signals.'],
    ];

    public bool $enabled;

    public string $mode;

    /** @var list<array{id: string, category: string, sendPageView: bool}> */
    public array $targets;

    /** @var array<string, array<string, mixed>> */
    private array $services;

    public function __construct(mixed $google = [], mixed $presets = [])
    {
        if (! is_array($google) || array_diff(array_keys($google), ['enabled', 'mode']) !== []
            || ! is_array($presets) || array_diff(array_keys($presets), TrackerSettings::PRESET_KEYS) !== []) {
            throw new InvalidArgumentException('Invalid consent.google or consent.presets configuration.');
        }

        $enabled = $google['enabled'] ?? null;
        $mode = array_key_exists('mode', $google) ? $google['mode'] : 'basic';
        if (($enabled !== null && ! is_bool($enabled)) || ! in_array($mode, ['basic', 'advanced'], true)) {
            throw new InvalidArgumentException('Google enabled must be null or boolean, and mode must be basic or advanced.');
        }

        $targets = [];
        $services = [];
        foreach (['ga4', 'google_ads'] as $preset) {
            $definition = array_key_exists($preset, $presets) ? $presets[$preset] : [];
            $idKey = $preset === 'ga4' ? 'measurement_id' : 'conversion_id';
            $allowed = ['enabled', $idKey, 'name', 'description', 'cookie_path', 'cookie_domain'];
            if ($preset === 'ga4') {
                $allowed[] = 'send_page_view';
            }
            if (! is_array($definition) || array_diff(array_keys($definition), $allowed) !== []) {
                throw new InvalidArgumentException("Invalid Google preset [{$preset}].");
            }
            $active = array_key_exists('enabled', $definition) ? $definition['enabled'] : false;
            $id = $definition[$idKey] ?? null;
            $pageView = array_key_exists('send_page_view', $definition) ? $definition['send_page_view'] : true;
            $pattern = $preset === 'ga4' ? '/\AG-[A-Z0-9]{4,32}\z/' : '/\AAW-[1-9][0-9]{0,19}\z/';
            if (! is_bool($active) || ! is_bool($pageView)
                || ($id !== null && (! is_string($id) || ! preg_match($pattern, $id)))
                || ($active && $id === null)) {
                throw new InvalidArgumentException("Google preset [{$preset}] requires a valid {$idKey} and boolean options.");
            }
            $category = $preset === 'ga4' ? 'analytics' : 'marketing';
            $cookies = array_map(fn (array $rule): array => $rule + [
                'path' => $definition['cookie_path'] ?? '/',
                'domain' => $definition['cookie_domain'] ?? null,
            ], $preset === 'ga4' ? [['name' => '_ga'], ['prefix' => '_ga_']] : [['prefix' => '_gcl_']]);
            $serviceId = $preset === 'ga4' ? 'google-ga4' : 'google-ads';
            $service = [
                'category' => $category,
                'name' => array_key_exists('name', $definition) ? $definition['name'] : self::SERVICE_DEFAULTS[$serviceId]['name'],
                'description' => array_key_exists('description', $definition) ? $definition['description'] : self::SERVICE_DEFAULTS[$serviceId]['description'],
                'enabled' => $active,
                'cookies' => $cookies,
            ];
            // Validate disabled definitions too, using the same registry contract as custom services.
            new ServiceRegistry([$serviceId => $service]);
            if ($active) {
                $services[$serviceId] = $service;
                $targets[] = ['id' => $id, 'category' => $category, 'sendPageView' => $preset === 'ga4' && $pageView];
            }
        }

        if ($enabled === false && $targets !== []) {
            throw new InvalidArgumentException('Enabled Google presets cannot be combined with consent.google.enabled=false.');
        }
        $this->enabled = $enabled ?? $targets !== [];
        $this->mode = $mode;
        $this->targets = $targets;
        $this->services = $services;
    }

    /** @return array<string, array<string, mixed>> */
    public function services(): array
    {
        return $this->services;
    }

    /** @return array{mode: string, targets: list<array{id: string, category: string, sendPageView: bool}>}|null */
    public function toArray(): ?array
    {
        return $this->enabled ? ['mode' => $this->mode, 'targets' => $this->targets] : null;
    }
}
