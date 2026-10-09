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

    public const DARK_COLORS = [
        'background' => '#111b17',
        'text' => '#edf4ef',
        'muted' => '#b5c6bc',
        'accent' => '#8dd8b4',
        'accent_text' => '#10251b',
        'border' => '#31473b',
        'control' => '#8da99a',
        'focus' => '#a5e4c4',
    ];

    public string $theme;

    public string $variant;

    public string $position;

    public ?string $locale;

    public ?string $policyUrl;

    /** @var array<string, string> */
    public array $colors;

    /** @var array<string, string> */
    public array $darkColors;

    public bool $validateContrast;

    /** @var list<string> */
    public array $colorWarnings;

    public function __construct(mixed $configuration)
    {
        if (! is_array($configuration) || array_diff(array_keys($configuration), ['variant', 'position', 'theme', 'locale', 'policy_url', 'colors', 'dark_colors', 'validate_contrast']) !== []) {
            throw new InvalidArgumentException('consent.ui must contain only variant, position, theme, locale, policy_url, colors, dark_colors, and validate_contrast.');
        }

        $configuration += ['variant' => 'standard', 'position' => 'bottom-left', 'theme' => 'light', 'locale' => null, 'policy_url' => null, 'colors' => [], 'dark_colors' => [], 'validate_contrast' => false];
        if (! in_array($configuration['theme'], ['light', 'dark', 'auto'], true)) {
            throw new InvalidArgumentException('Consent theme must be light, dark, or auto.');
        }
        $this->theme = $configuration['theme'];
        $this->variant = self::variant($configuration['variant']);
        $this->position = self::position($configuration['position']);
        $this->locale = $configuration['locale'] === null ? null : self::locale($configuration['locale']);
        $this->policyUrl = self::policyUrl($configuration['policy_url']);
        $warnings = [];
        $this->validateContrast = $configuration['validate_contrast'] === true;
        if (! is_bool($configuration['validate_contrast'])) {
            $warnings[] = 'consent.ui.validate_contrast must be boolean; contrast diagnostics are disabled.';
        }
        $this->colors = $this->resolveColors($configuration['colors'], self::COLORS, 'colors', 'light', $warnings);
        $this->darkColors = $this->resolveColors($configuration['dark_colors'], self::DARK_COLORS, 'dark_colors', 'dark', $warnings);
        $this->colorWarnings = $warnings;
    }

    /**
     * @param  array<string, string>  $defaults
     * @param  list<string>  $warnings
     * @return array<string, string>
     */
    private function resolveColors(mixed $colors, array $defaults, string $option, string $theme, array &$warnings): array
    {
        if (! is_array($colors)) {
            $warnings[] = "consent.ui.{$option} must be an array; using the default {$theme} colors.";
            $colors = [];
        }
        if (array_diff(array_keys($colors), array_keys($defaults)) !== []) {
            $warnings[] = "consent.ui.{$option} contains unknown color keys; ignoring them.";
        }
        $resolved = $defaults;
        foreach ($defaults as $key => $default) {
            if (! array_key_exists($key, $colors)) {
                continue;
            }
            $color = $colors[$key];
            if (! is_string($color) || ! preg_match('/\A#[a-fA-F0-9]{6}\z/', $color)) {
                $warnings[] = "Consent {$theme} color [{$key}] must be a six-digit hex color; using its default.";

                continue;
            }
            $resolved[$key] = strtolower($color);
        }
        if ($this->validateContrast) {
            foreach (['text' => 4.5, 'muted' => 4.5, 'accent' => 4.5, 'control' => 3.0, 'focus' => 3.0] as $key => $minimum) {
                if (self::contrast($resolved[$key], $resolved['background']) < $minimum) {
                    $warnings[] = "Consent {$theme} color [{$key}] has insufficient contrast against background (minimum {$minimum}:1).";
                }
            }
            if (self::contrast($resolved['accent_text'], $resolved['accent']) < 4.5) {
                $warnings[] = "Consent {$theme} accent_text requires at least 4.5:1 contrast against accent.";
            }
        }

        return $resolved;
    }

    public static function locale(mixed $locale): string
    {
        if (! is_string($locale) || strlen($locale) > 85 || ! preg_match('/\A[a-zA-Z]{2,8}(?:[-_][a-zA-Z0-9]{1,8})*\z/', $locale)) {
            throw new InvalidArgumentException('Consent UI locale must be a language tag such as en, fr-CA, or pt_BR.');
        }

        $parts = explode('-', str_replace('_', '-', $locale));
        $parts[0] = strtolower($parts[0]);
        $extension = false;
        foreach ($parts as $index => $part) {
            if ($index === 0) {
                continue;
            }
            $extension = $extension || strlen($part) === 1;
            $parts[$index] = ! $extension && ctype_alpha($part) && strlen($part) === 4 ? ucfirst(strtolower($part))
                : (! $extension && ctype_alpha($part) && strlen($part) === 2 ? strtoupper($part) : strtolower($part));
        }

        return implode('-', $parts);
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

    public function variables(bool $dark = false): string
    {
        $colors = $dark ? $this->darkColors : $this->colors;
        $prefix = $dark ? '--consent-dark-' : '--consent-';

        return implode('', array_map(fn (string $key, string $color): string => $prefix.str_replace('_', '-', $key).':'.$color.';', array_keys($colors), array_values($colors)));
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
