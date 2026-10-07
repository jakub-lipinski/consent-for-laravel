<?php

namespace ConsentForLaravel\ConsentForLaravel;

use InvalidArgumentException;

final readonly class ConsentSettings
{
    public string $policyVersion;

    public int $retentionDays;

    public string $cookieName;

    public string $cookiePath;

    public ?string $cookieDomain;

    public ?bool $cookieSecure;

    /** @var 'lax'|'strict' */
    public string $cookieSameSite;

    public function __construct(mixed $configuration, ?string $sessionCookieName = null)
    {
        if (! is_array($configuration)) {
            throw new InvalidArgumentException('consent configuration must be an array.');
        }

        $configuration += ['policy_version' => '1', 'retention_days' => 180, 'cookie' => []];
        $version = $configuration['policy_version'];
        $days = $configuration['retention_days'];
        $cookie = $configuration['cookie'];

        if (! is_string($version) || trim($version) === '' || strlen($version) > 128 || preg_match('//u', $version) !== 1) {
            throw new InvalidArgumentException('consent.policy_version must be a non-empty UTF-8 string of at most 128 bytes.');
        }

        if (! is_int($days) || $days < 1 || $days > 365) {
            throw new InvalidArgumentException('consent.retention_days must be an integer between 1 and 365.');
        }

        if (! is_array($cookie) || array_diff(array_keys($cookie), ['name', 'path', 'domain', 'secure', 'same_site']) !== []) {
            throw new InvalidArgumentException('consent.cookie must be an array containing only name, path, domain, secure, and same_site.');
        }

        $cookie += ['name' => 'consent_preferences', 'path' => '/', 'domain' => null, 'secure' => null, 'same_site' => 'lax'];
        $name = $cookie['name'];
        $path = $cookie['path'];
        $domain = $cookie['domain'];
        $secure = $cookie['secure'];
        $sameSite = $cookie['same_site'];

        if (! is_string($name) || ! preg_match('/\A[a-zA-Z][a-zA-Z0-9_.-]{0,63}\z/', $name) || in_array($name, ['XSRF-TOKEN', 'laravel_session', $sessionCookieName], true)) {
            throw new InvalidArgumentException('consent.cookie.name must be a valid, separate cookie name, not a session or CSRF cookie.');
        }

        if (! is_string($path) || ! str_starts_with($path, '/') || preg_match('/[;\x00-\x20\x7f]/', $path)) {
            throw new InvalidArgumentException('consent.cookie.path must be an absolute cookie path without whitespace or control characters.');
        }

        if ($domain !== null && (! is_string($domain) || strlen($domain) > 254 || ! preg_match('/\A\.?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\z/', $domain))) {
            throw new InvalidArgumentException('consent.cookie.domain must be null or a valid cookie domain.');
        }

        if ($secure !== null && ! is_bool($secure)) {
            throw new InvalidArgumentException('consent.cookie.secure must be null or a boolean.');
        }

        if (! in_array($sameSite, ['lax', 'strict'], true)) {
            throw new InvalidArgumentException('consent.cookie.same_site must be lax or strict.');
        }

        $this->policyVersion = $version;
        $this->retentionDays = $days;
        $this->cookieName = $name;
        $this->cookiePath = $path;
        $this->cookieDomain = $domain;
        $this->cookieSecure = $secure;
        $this->cookieSameSite = $sameSite;
    }
}
