<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\Support\Facades\Date;
use JsonSerializable;

final readonly class ConsentState implements JsonSerializable
{
    public const SCHEMA_VERSION = 1;

    /** @param array<string, bool> $choices */
    public function __construct(
        public string $policyVersion,
        public string $servicesVersion,
        public array $choices,
        public ?int $decidedAt = null,
        public ?int $expiresAt = null,
    ) {}

    public function hasDecision(): bool
    {
        $now = Date::now()->getTimestamp();

        return $this->decidedAt !== null && $this->decidedAt <= $now && $this->expiresAt !== null && $this->expiresAt > $now;
    }

    public function allows(Category|string $category): bool
    {
        $category = is_string($category) ? Category::from($category) : $category;

        return $category === Category::Necessary || ($this->hasDecision() && ($this->choices[$category->value] ?? false));
    }

    /** @return array{schemaVersion: int, policyVersion: string, servicesVersion: string, choices: array<string, bool>, decidedAt: int|null, expiresAt: int|null} */
    public function toArray(): array
    {
        return [
            'schemaVersion' => self::SCHEMA_VERSION,
            'policyVersion' => $this->policyVersion,
            'servicesVersion' => $this->servicesVersion,
            'choices' => $this->choices,
            'decidedAt' => $this->decidedAt,
            'expiresAt' => $this->expiresAt,
        ];
    }

    /** @return array{schemaVersion: int, policyVersion: string, servicesVersion: string, choices: array<string, bool>, decidedAt: int|null, expiresAt: int|null} */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}
