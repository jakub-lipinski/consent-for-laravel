<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\Support\Facades\Date;
use JsonException;

final readonly class ConsentCodec
{
    public function __construct(private ConsentSettings $settings, private ServiceRegistry $services) {}

    public function encode(ConsentState $state): string
    {
        return json_encode($state, JSON_THROW_ON_ERROR);
    }

    public function decode(mixed $value): ?ConsentState
    {
        if (! is_string($value) || strlen($value) > 3072) {
            return null;
        }

        try {
            $data = json_decode($value, true, 8, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return null;
        }

        if (
            ! is_array($data)
            || count($data) !== 6
            || ($data['schemaVersion'] ?? null) !== ConsentState::SCHEMA_VERSION
            || ($data['policyVersion'] ?? null) !== $this->settings->policyVersion
            || ($data['servicesVersion'] ?? null) !== $this->services->version()
        ) {
            return null;
        }

        $decidedAt = $data['decidedAt'] ?? null;
        $expiresAt = $data['expiresAt'] ?? null;
        $choices = $data['choices'] ?? null;
        $now = Date::now()->getTimestamp();

        if (
            ! is_int($decidedAt)
            || ! is_int($expiresAt)
            || $decidedAt < 1
            || $decidedAt > $now
            || $expiresAt <= $now
            || $expiresAt - $decidedAt > $this->settings->retentionDays * 86400
            || ! is_array($choices)
            || count($choices) !== count(Category::cases())
        ) {
            return null;
        }

        $normalized = Category::deniedChoices();

        foreach (Category::cases() as $category) {
            $choice = $choices[$category->value] ?? null;

            if (
                ! is_bool($choice)
                || ($category === Category::Necessary && ! $choice)
                || (! $this->services->uses($category) && $choice)
            ) {
                return null;
            }

            $normalized[$category->value] = $choice;
        }

        return new ConsentState($this->settings->policyVersion, $this->services->version(), $normalized, $decidedAt, $expiresAt);
    }
}
