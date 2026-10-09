<?php

namespace ConsentForLaravel\ConsentForLaravel;

use InvalidArgumentException;

final readonly class AuditSettings
{
    public bool $enabled;

    public string $cookieName;

    public ?string $connection;

    public string $decisionsTable;

    public string $noticesTable;

    public string $path;

    public ?int $retentionDays;

    public int $timeoutMs;

    public function __construct(mixed $configuration, string $preferenceCookieName = 'consent_preferences', ?string $sessionCookieName = null)
    {
        $defaults = ['enabled' => false, 'connection' => null, 'decisions_table' => 'consent_decisions', 'notices_table' => 'consent_notices', 'path' => '/consent/decisions', 'retention_days' => 180, 'timeout_ms' => 5000];
        if (! is_array($configuration) || array_diff(array_keys($configuration), array_keys($defaults)) !== []) {
            throw new InvalidArgumentException('consent.audit must contain only enabled, connection, decisions_table, notices_table, path, retention_days, and timeout_ms.');
        }
        $configuration += $defaults;
        if (! is_bool($configuration['enabled'])) {
            throw new InvalidArgumentException('consent.audit.enabled must be boolean.');
        }
        if ($configuration['connection'] !== null && (! is_string($configuration['connection']) || trim($configuration['connection']) === '')) {
            throw new InvalidArgumentException('consent.audit.connection must be null or a connection name.');
        }
        foreach (['decisions_table', 'notices_table'] as $key) {
            if (! is_string($configuration[$key]) || ! preg_match('/\A[a-zA-Z][a-zA-Z0-9_]{0,39}\z/', $configuration[$key])) {
                throw new InvalidArgumentException('Consent audit table names must be distinct SQL identifiers of at most 40 characters.');
            }
        }
        if ($configuration['decisions_table'] === $configuration['notices_table']) {
            throw new InvalidArgumentException('Consent audit table names must be distinct.');
        }
        if (! is_string($configuration['path']) || ! preg_match('~\A/(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_-]+\z~', $configuration['path'])) {
            throw new InvalidArgumentException('consent.audit.path must be an absolute route path without parameters or a trailing slash.');
        }
        if ($configuration['retention_days'] !== null && (! is_int($configuration['retention_days']) || $configuration['retention_days'] < 1 || $configuration['retention_days'] > 36500)) {
            throw new InvalidArgumentException('consent.audit.retention_days must be null or an integer between 1 and 36500.');
        }
        if (! is_int($configuration['timeout_ms']) || $configuration['timeout_ms'] < 100 || $configuration['timeout_ms'] > 30000) {
            throw new InvalidArgumentException('consent.audit.timeout_ms must be an integer between 100 and 30000.');
        }
        $this->enabled = $configuration['enabled'];
        $this->cookieName = $preferenceCookieName.'_audit';
        if ($this->enabled && $this->cookieName === $sessionCookieName) {
            throw new InvalidArgumentException('Consent audit identity cookie must not overwrite the session cookie.');
        }
        $this->connection = $configuration['connection'];
        $this->decisionsTable = $configuration['decisions_table'];
        $this->noticesTable = $configuration['notices_table'];
        $this->path = $configuration['path'];
        $this->retentionDays = $configuration['retention_days'];
        $this->timeoutMs = $configuration['timeout_ms'];
    }
}
