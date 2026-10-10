<?php

namespace ConsentForLaravel\ConsentForLaravel;

use InvalidArgumentException;

final readonly class MatomoSettings
{
    /** @var array<string, array<string, mixed>> */
    private array $services;

    /** @var array<string, mixed>|null */
    private ?array $tracker;

    public function __construct(mixed $definition = [])
    {
        if (! is_array($definition) || array_diff(array_keys($definition), [
            'enabled', 'url', 'site_id', 'send_page_view', 'enable_link_tracking',
            'name', 'description', 'cookie_path', 'cookie_domain',
        ]) !== []) {
            throw new InvalidArgumentException('Invalid Matomo preset configuration.');
        }

        $enabled = array_key_exists('enabled', $definition) ? $definition['enabled'] : false;
        $pageView = array_key_exists('send_page_view', $definition) ? $definition['send_page_view'] : true;
        $linkTracking = array_key_exists('enable_link_tracking', $definition) ? $definition['enable_link_tracking'] : true;
        $url = $this->url($definition['url'] ?? null);
        $siteId = $definition['site_id'] ?? null;
        if (! is_bool($enabled) || ! is_bool($pageView) || ! is_bool($linkTracking)
            || ($siteId !== null && ((! is_string($siteId) && ! is_int($siteId))
                || ! preg_match('/\A[1-9][0-9]{0,9}\z/', (string) $siteId) || (int) $siteId > 2147483647))
            || ($enabled && ($url === null || $siteId === null))) {
            throw new InvalidArgumentException('Matomo requires an HTTP(S) instance URL, a positive site_id up to 2147483647, and boolean options.');
        }

        $scope = ['path' => array_key_exists('cookie_path', $definition) ? $definition['cookie_path'] : '/', 'domain' => $definition['cookie_domain'] ?? null];
        // Validate the scope even when the preset has not yet been enabled.
        $cookie = new CookieRule(['prefix' => '_pk_'] + $scope);
        $service = [
            'category' => 'analytics',
            'name' => array_key_exists('name', $definition) ? $definition['name'] : TrackerSettings::SERVICE_DEFAULTS['matomo']['name'],
            'description' => array_key_exists('description', $definition) ? $definition['description'] : TrackerSettings::SERVICE_DEFAULTS['matomo']['description'],
            'enabled' => $enabled,
            'cookies' => [...array_map(fn (string $prefix): array => ['prefix' => $prefix.'.'.($siteId ?? '1').'.'] + $scope,
                ['_pk_id', '_pk_ses', '_pk_ref', '_pk_cvar', '_pk_hsr']),
                ...array_map(fn (string $name): array => ['name' => $name] + $scope,
                    ['_pk_testcookie', 'mtm_consent', 'mtm_cookie_consent', 'mtm_consent_removed']),
            ],
        ];
        new ServiceRegistry(['matomo' => $service]);

        $this->services = $enabled ? ['matomo' => $service] : [];
        $this->tracker = $enabled ? [
            'url' => $url,
            'siteId' => (string) $siteId,
            'sendPageView' => $pageView,
            'enableLinkTracking' => $linkTracking,
            'cookiePath' => $cookie->path,
            'cookieDomain' => $cookie->domain,
        ] : null;
    }

    private function url(mixed $url): ?string
    {
        if ($url === null) {
            return null;
        }
        $parts = is_string($url) && strlen($url) <= 2048 && filter_var($url, FILTER_VALIDATE_URL) ? parse_url($url) : false;
        if (! is_array($parts) || ! isset($parts['host']) || ! in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true)
            || isset($parts['user']) || isset($parts['pass'])
            || isset($parts['query']) || isset($parts['fragment'])
            || preg_match('/[\\\\\s<>"\x00-\x1f\x7f]/', (string) $url)
            || preg_match('/%(?![0-9a-f]{2})/i', $parts['path'] ?? '')
            || preg_match('~(?:^|/)(?:\.|%2e){1,2}(?:/|$)~i', $parts['path'] ?? '')
            || isset($parts['port']) && $parts['port'] < 1) {
            throw new InvalidArgumentException('Matomo url must be an absolute HTTP(S) base URL without credentials, query, fragment, or dot path segments.');
        }

        $scheme = strtolower($parts['scheme']);
        $port = $parts['port'] ?? null;
        $authority = strtolower($parts['host']);
        if ($port !== null && ! ($scheme === 'https' && $port === 443 || $scheme === 'http' && $port === 80)) {
            $authority .= ':'.$port;
        }

        return $scheme.'://'.$authority.rtrim($parts['path'] ?? '', '/').'/';
    }

    /** @return array<string, array<string, mixed>> */
    public function services(): array
    {
        return $this->services;
    }

    /** @return array<string, mixed>|null */
    public function toArray(): ?array
    {
        return $this->tracker;
    }
}
