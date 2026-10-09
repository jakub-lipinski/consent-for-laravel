<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\Translation\Translator;
use InvalidArgumentException;
use RuntimeException;

final readonly class BannerView
{
    public function __construct(public BannerSettings $settings, public ServiceRegistry $services, private Translator $translator, private GoogleSettings $google) {}

    public function advancedGoogle(): bool
    {
        return $this->google->enabled && $this->google->mode === 'advanced' && $this->google->targets !== [];
    }

    public function locale(?string $override = null): string
    {
        foreach ($this->locales($this->requestedLocale($override)) as $candidate) {
            $messages = $this->translator->get('consent::messages', [], $candidate, false);
            if (is_array($messages) && $messages !== []) {
                return BannerSettings::locale($candidate);
            }
        }

        return 'en';
    }

    public function requestedLocale(?string $override = null): string
    {
        $selected = $override ?? $this->settings->locale;
        try {
            $locale = BannerSettings::locale($selected ?? $this->translator->getLocale());
        } catch (InvalidArgumentException $exception) {
            if ($selected !== null) {
                throw $exception;
            }

            $locale = 'en';
        }

        return $locale;
    }

    public function text(string $key, string $locale): string
    {
        $text = $this->translation('consent::messages.'.$key, $locale);

        return $text ?? throw new InvalidArgumentException("Consent translation [{$key}] is missing.");
    }

    public function serviceText(Service $service, string $field, string $locale): string
    {
        $key = 'consent::services.'.$service->id.'.'.$field;
        $translated = $this->translation($key, $locale);

        $defaults = GoogleSettings::SERVICE_DEFAULTS + TrackerSettings::SERVICE_DEFAULTS;
        if ($translated === null && isset($defaults[$service->id][$field])
            && $service->{$field} === $defaults[$service->id][$field]) {
            return $this->text('presets.'.$service->id.'.'.$field, $locale);
        }

        return $translated ?? match ($field) {
            'name' => $service->name,
            'description' => $service->description,
            default => throw new InvalidArgumentException('Consent service translations support name and description.'),
        };
    }

    /** @return list<string> */
    private function locales(string $locale): array
    {
        $parts = explode('-', BannerSettings::locale($locale));
        $locales = [];
        while ($parts !== []) {
            $candidate = implode('-', $parts);
            $locales[] = $candidate;
            $locales[] = str_replace('-', '_', $candidate);
            array_pop($parts);
            // A language-tag extension cannot end with its singleton prefix.
            if ($parts !== [] && strlen($parts[array_key_last($parts)]) === 1) {
                array_pop($parts);
            }
        }
        $locales[] = 'en';

        return array_values(array_unique($locales));
    }

    private function translation(string $key, string $locale): ?string
    {
        foreach ($this->locales($locale) as $candidate) {
            $text = $this->translator->get($key, [], $candidate, false);
            if (! is_string($text)) {
                throw new InvalidArgumentException("Consent translation [{$key}] must be a string.");
            }
            if ($text !== $key && trim($text) !== '') {
                return $text;
            }
        }

        return null;
    }

    public function styles(): string
    {
        return file_get_contents(__DIR__.'/../resources/css/consent.css') ?: throw new RuntimeException('Consent UI stylesheet is missing.');
    }

    public function script(): string
    {
        return file_get_contents(__DIR__.'/../resources/js/banner.js') ?: throw new RuntimeException('Consent UI runtime is missing.');
    }
}
