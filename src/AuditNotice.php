<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\Contracts\Config\Repository;
use InvalidArgumentException;

final readonly class AuditNotice
{
    public const MAX_REQUEST_BYTES = 61440;

    public function __construct(private AuditSettings $audit, private ConsentSettings $settings, private ServiceRegistry $services, private Repository $configuration) {}

    /**
     * @param  array<string, mixed>  $presentation
     * @return array{payload: string, signature: string}|null
     */
    public function seal(string $html, string $locale, string $requestedLocale, array $presentation): ?array
    {
        if (! $this->audit->enabled) {
            return null;
        }
        $payload = json_encode([
            'schema_version' => 1,
            'policy_version' => $this->settings->policyVersion,
            'services_version' => $this->services->version(),
            'categories' => array_map(fn (Category $category): string => $category->value, $this->services->categories()),
            'retention_days' => $this->settings->retentionDays,
            'locale' => $locale,
            'requested_locale' => $requestedLocale,
            'html' => $html,
            'services' => array_values(array_map(fn (Service $service): array => $service->toArray(), $this->services->all())),
            'presentation' => $presentation,
            'assets' => array_map(fn (string $file): string => (string) hash_file('sha256', __DIR__.'/../resources/'.$file), ['js/consent.js', 'js/banner.js', 'css/consent.css']),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        // Leave room for choices, UUID, action, and the JSON envelope escaping.
        if (strlen(json_encode(['payload' => $payload], JSON_THROW_ON_ERROR)) > self::MAX_REQUEST_BYTES - 2048) {
            throw new InvalidArgumentException('Consent audit notice is too large for the 60 KiB request limit.');
        }

        return ['payload' => $payload, 'signature' => $this->sign($payload, 'notice')];
    }

    public function sign(string $value, string $purpose): string
    {
        return hash_hmac('sha256', 'consent-audit:'.$purpose.':'.$value, $this->keys()[0]);
    }

    public function authentic(string $value, string $signature, string $purpose): bool
    {
        foreach ($this->keys() as $key) {
            if (hash_equals(hash_hmac('sha256', 'consent-audit:'.$purpose.':'.$value, $key), $signature)) {
                return true;
            }
        }

        return false;
    }

    /** @return list<string> */
    private function keys(): array
    {
        $current = $this->configuration->get('app.key');
        $previous = $this->configuration->get('app.previous_keys', []);
        if (! is_string($current) || $current === '' || ! is_array($previous)) {
            throw new InvalidArgumentException('Consent audit requires an application key and an array of previous keys.');
        }
        $keys = [];
        foreach ([$current, ...$previous] as $key) {
            if (! is_string($key) || $key === '') {
                throw new InvalidArgumentException('Consent audit signing keys must be non-empty strings.');
            }
            $decoded = str_starts_with($key, 'base64:') ? base64_decode(substr($key, 7), true) : $key;
            if ($decoded === false || strlen($decoded) < 32) {
                throw new InvalidArgumentException('Consent audit signing keys must contain at least 32 bytes.');
            }
            $keys[] = $decoded;
        }

        return $keys;
    }
}
