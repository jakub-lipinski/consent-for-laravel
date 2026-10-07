<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\Translation\Translator;
use InvalidArgumentException;
use RuntimeException;

final readonly class BannerView
{
    public function __construct(public BannerSettings $settings, public ServiceRegistry $services, private Translator $translator) {}

    public function locale(?string $override = null): string
    {
        $selected = $override ?? $this->settings->locale;
        if ($selected !== null && ! in_array($selected, ['en', 'pl'], true)) {
            throw new InvalidArgumentException('Consent UI locale must be en or pl.');
        }

        return $selected ?? (strtolower(explode('-', str_replace('_', '-', $this->translator->getLocale()))[0]) === 'pl' ? 'pl' : 'en');
    }

    public function text(string $key, string $locale): string
    {
        $text = $this->translator->get('consent::messages.'.$key, [], $locale);

        return is_string($text) ? $text : throw new InvalidArgumentException("Consent translation [{$key}] must be a string.");
    }

    public function serviceText(Service $service, string $field, string $locale): string
    {
        $key = 'consent::services.'.$service->id.'.'.$field;
        $translated = $this->translator->get($key, [], $locale, false);

        return is_string($translated) && $translated !== $key && trim($translated) !== '' ? $translated : match ($field) {
            'name' => $service->name,
            'description' => $service->description,
            default => throw new InvalidArgumentException('Consent service translations support name and description.'),
        };
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
