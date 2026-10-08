<?php

namespace ConsentForLaravel\ConsentForLaravel;

use InvalidArgumentException;

final readonly class BannerSettings
{
    public const COLORS = [
        'background' => '#ffffff',
        'text' => '#182722',
        'muted' => '#52625b',
        'accent' => '#245c49',
        'accent_text' => '#ffffff',
        'border' => '#e1e7e3',
        'control' => '#67776e',
        'focus' => '#245c49',
    ];

    public string $variant;

    public string $position;

    public ?string $locale;

    public ?string $policyUrl;

    /** @var array<string, string> */
    public array $colors;

    public function __construct(mixed $configuration)
    {
        if (! is_array($configuration) || array_diff(array_keys($configuration), ['variant', 'position', 'locale', 'policy_url', 'colors']) !== []) {
            throw new InvalidArgumentException('consent.ui must contain only variant, position, locale, policy_url, and colors.');
        }

        $configuration += ['variant' => 'standard', 'position' => 'bottom-left', 'locale' => null, 'policy_url' => null, 'colors' => []];
        $this->variant = self::variant($configuration['variant']);
        $this->position = self::position($configuration['position']);
        if ($configuration['locale'] !== null && ! in_array($configuration['locale'], ['en', 'pl'], true)) {
            throw new InvalidArgumentException('consent.ui.locale must be null, en, or pl.');
        }
        $this->locale = $configuration['locale'];
        $this->policyUrl = self::policyUrl($configuration['policy_url']);
        $colors = $configuration['colors'];
        if (! is_array($colors) || array_diff(array_keys($colors), array_keys(self::COLORS)) !== []) {
            throw new InvalidArgumentException('consent.ui.colors contains an unknown color.');
        }
        foreach ($colors as $key => $color) {
            if (! is_string($color) || ! preg_match('/\A#[a-fA-F0-9]{6}\z/', $color)) {
                throw new InvalidArgumentException("Consent color [{$key}] must be a six-digit hex color.");
            }
            $colors[$key] = strtolower($color);
        }
        $this->colors = $colors + self::COLORS;
        foreach (['text' => 4.5, 'muted' => 4.5, 'accent' => 4.5, 'control' => 3.0, 'focus' => 3.0] as $key => $minimum) {
            if (self::contrast($this->colors[$key], $this->colors['background']) < $minimum) {
                throw new InvalidArgumentException("Consent color [{$key}] has insufficient contrast against background (minimum {$minimum}:1).");
            }
        }
        if (self::contrast($this->colors['accent_text'], $this->colors['accent']) < 4.5) {
            throw new InvalidArgumentException('Consent accent_text requires at least 4.5:1 contrast against accent.');
        }
    }

    public static function variant(mixed $variant): string
    {
        if (! in_array($variant, ['standard', 'compact'], true)) {
            throw new InvalidArgumentException('Consent variant must be standard or compact.');
        }

        return $variant;
    }

    public static function position(mixed $position): string
    {
        if (! in_array($position, ['bottom-left', 'bottom-right', 'bottom-center'], true)) {
            throw new InvalidArgumentException('Consent position must be bottom-left, bottom-right, or bottom-center.');
        }

        return $position;
    }

    public static function policyUrl(mixed $url): ?string
    {
        if ($url === null) {
            return null;
        }
        if (! is_string($url) || $url === '' || preg_match('/[\x00-\x20\x7f\\\\]/', $url)
            || (! (str_starts_with($url, '/') && ! str_starts_with($url, '//'))
                && ! (filter_var($url, FILTER_VALIDATE_URL) && in_array(strtolower((string) parse_url($url, PHP_URL_SCHEME)), ['http', 'https'], true)))
            || parse_url($url, PHP_URL_USER) !== null || parse_url($url, PHP_URL_PASS) !== null) {
            throw new InvalidArgumentException('Consent policy_url must be null, an absolute website path, or an HTTP(S) URL without credentials.');
        }

        return $url;
    }

    public function variables(): string
    {
        return implode('', array_map(fn (string $key, string $color): string => '--consent-'.str_replace('_', '-', $key).':'.$color.';', array_keys($this->colors), array_values($this->colors)));
    }

    public static function contrast(string $first, string $second): float
    {
        $luminance = static function (string $color): float {
            $channels = array_map(static function (string $channel): float {
                $value = hexdec($channel) / 255;

                return $value <= 0.04045 ? $value / 12.92 : (($value + 0.055) / 1.055) ** 2.4;
            }, str_split(substr($color, 1), 2));

            return $channels[0] * 0.2126 + $channels[1] * 0.7152 + $channels[2] * 0.0722;
        };
        $one = $luminance($first);
        $two = $luminance($second);

        return (max($one, $two) + 0.05) / (min($one, $two) + 0.05);
    }
}
