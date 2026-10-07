<?php

namespace ConsentForLaravel\ConsentForLaravel;

use InvalidArgumentException;

final readonly class CookieRule
{
    public ?string $name;

    public ?string $prefix;

    public string $path;

    public ?string $domain;

    public function __construct(mixed $definition)
    {
        if (! is_array($definition) || array_diff(array_keys($definition), ['name', 'prefix', 'path', 'domain']) !== [] || array_key_exists('name', $definition) === array_key_exists('prefix', $definition)) {
            throw new InvalidArgumentException('A consent cookie rule requires exactly one name or prefix, and optional path and domain.');
        }

        $match = $definition['name'] ?? $definition['prefix'] ?? null;

        if (! is_string($match) || ! preg_match('/\A[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}\z/', $match)) {
            throw new InvalidArgumentException('Consent cookie names and prefixes must be non-empty cookie identifiers, without wildcards.');
        }

        // Reuse the preference cookie's scope validation, without its reserved-name restriction.
        $scope = new ConsentSettings(['cookie' => [
            'path' => array_key_exists('path', $definition) ? $definition['path'] : '/',
            'domain' => $definition['domain'] ?? null,
        ]]);

        $this->name = array_key_exists('name', $definition) ? $match : null;
        $this->prefix = array_key_exists('prefix', $definition) ? $match : null;
        $this->path = $scope->cookiePath;
        $this->domain = $scope->cookieDomain;
    }

    /** @return array{name: string|null, prefix: string|null, path: string, domain: string|null} */
    public function toArray(): array
    {
        return ['name' => $this->name, 'prefix' => $this->prefix, 'path' => $this->path, 'domain' => $this->domain];
    }
}
