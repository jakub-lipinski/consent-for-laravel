<?php

namespace ConsentForLaravel\ConsentForLaravel;

use InvalidArgumentException;

final readonly class ServiceRegistry
{
    /** @var array<string, Service> */
    private array $services;

    public function __construct(mixed $definitions)
    {
        if (! is_array($definitions)) {
            throw new InvalidArgumentException('consent.services must be an array.');
        }

        $services = [];

        foreach ($definitions as $id => $definition) {
            if (! is_string($id) || ! preg_match('/\A[a-zA-Z][a-zA-Z0-9._-]{0,127}\z/', $id)) {
                throw new InvalidArgumentException('Consent service IDs must start with a letter and contain only letters, digits, dots, underscores, or hyphens.');
            }

            if (! is_array($definition) || array_diff(array_keys($definition), ['category', 'name', 'description', 'enabled', 'cookies']) !== []) {
                throw new InvalidArgumentException("Invalid definition for consent service [{$id}].");
            }

            $category = is_string($definition['category'] ?? null) ? Category::tryFrom($definition['category']) : null;
            $name = $definition['name'] ?? null;
            $description = $definition['description'] ?? null;
            $enabled = array_key_exists('enabled', $definition) ? $definition['enabled'] : true;

            if (
                $category === null
                || ! is_string($name)
                || trim($name) === ''
                || preg_match('//u', $name) !== 1
                || ! is_string($description)
                || trim($description) === ''
                || preg_match('//u', $description) !== 1
                || ! is_bool($enabled)
            ) {
                throw new InvalidArgumentException("Consent service [{$id}] requires a valid category, non-empty name and description, and a boolean enabled value.");
            }

            $cookies = array_key_exists('cookies', $definition) ? $definition['cookies'] : [];

            if (! is_array($cookies) || ! array_is_list($cookies)) {
                throw new InvalidArgumentException("Consent service [{$id}] cookies must be a list of cookie rules.");
            }

            $cookies = array_map(fn (mixed $cookie): CookieRule => new CookieRule($cookie), $cookies);

            if ($enabled) {
                $services[$id] = new Service($id, $category, trim($name), trim($description), $cookies);
            }
        }

        ksort($services, SORT_STRING);
        $this->services = $services;
    }

    /** @return array<string, Service> */
    public function all(): array
    {
        return $this->services;
    }

    public function get(string $id): Service
    {
        return $this->services[$id] ?? throw new InvalidArgumentException("Unknown consent service [{$id}].");
    }

    /** @return list<Category> */
    public function categories(): array
    {
        return array_values(array_filter(Category::cases(), fn (Category $category): bool => $this->uses($category)));
    }

    public function uses(Category|string $category): bool
    {
        $category = is_string($category) ? Category::from($category) : $category;

        return $category === Category::Necessary || $this->forCategory($category) !== [];
    }

    /** @return array<string, Service> */
    public function forCategory(Category|string $category): array
    {
        $category = is_string($category) ? Category::from($category) : $category;

        return array_filter($this->services, fn (Service $service): bool => $service->category === $category);
    }

    public function version(): string
    {
        return hash('sha256', json_encode(array_map(fn (Service $service): array => $service->toArray(), $this->services), JSON_THROW_ON_ERROR));
    }
}
