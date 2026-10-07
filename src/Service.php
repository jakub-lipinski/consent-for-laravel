<?php

namespace ConsentForLaravel\ConsentForLaravel;

final readonly class Service
{
    /** @param list<CookieRule> $cookies */
    public function __construct(
        public string $id,
        public Category $category,
        public string $name,
        public string $description,
        public array $cookies = [],
    ) {}

    /** @return array{id: string, category: string, name: string, description: string, cookies?: list<array{name: string|null, prefix: string|null, path: string, domain: string|null}>} */
    public function toArray(): array
    {
        $definition = [
            'id' => $this->id,
            'category' => $this->category->value,
            'name' => $this->name,
            'description' => $this->description,
        ];

        // Preserve beta.1 fingerprints when no cleanup rules have been added.
        if ($this->cookies !== []) {
            $definition['cookies'] = array_map(fn (CookieRule $cookie): array => $cookie->toArray(), $this->cookies);
        }

        return $definition;
    }
}
