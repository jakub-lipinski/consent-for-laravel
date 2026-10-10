<?php

use ConsentForLaravel\ConsentForLaravel\BrowserRuntime;
use ConsentForLaravel\ConsentForLaravel\Category;
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use ConsentForLaravel\ConsentForLaravel\MatomoSettings;
use ConsentForLaravel\ConsentForLaravel\ServiceRegistry;
use ConsentForLaravel\ConsentForLaravel\TrackerSettings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Blade;

it('keeps Matomo disabled and preserves existing consent fingerprints', function () {
    config(['consent.presets.matomo' => []]);
    $before = app(ServiceRegistry::class)->version();
    config(['consent.presets.matomo' => ['enabled' => false, 'url' => 'https://stats.example.test/', 'site_id' => '3']]);
    expect(app(ServiceRegistry::class)->version())->toBe($before)
        ->and(app(TrackerSettings::class)->toArray())->toBe([])
        ->and((new MatomoSettings)->services())->toBe([]);
});

it('registers a cache-safe Matomo preset with site-specific cookies and no Google bridge', function () {
    config(['consent.presets.matomo' => ['enabled' => true, 'url' => 'https://Stats.example.test:443/analytics', 'site_id' => 3, 'cookie_domain' => '.example.test']]);
    $configuration = app(BrowserRuntime::class)->configuration();
    $registry = app(ServiceRegistry::class);
    expect($configuration['trackers']['matomo'])->toBe([
        'url' => 'https://stats.example.test/analytics/', 'siteId' => '3', 'sendPageView' => true,
        'enableLinkTracking' => true, 'cookiePath' => '/', 'cookieDomain' => '.example.test',
    ])->and($configuration['google'])->toBeNull()
        ->and($registry->categories())->toContain(Category::Analytics)
        ->and($registry->uses('marketing'))->toBeFalse()
        ->and($registry->get('matomo')->cookies[0]->toArray())->toBe(['name' => null, 'prefix' => '_pk_id.3.', 'path' => '/', 'domain' => '.example.test'])
        ->and($registry->get('matomo')->cookies[8]->name)->toBe('mtm_consent_removed')
        ->and(json_decode(app(BrowserRuntime::class)->json(), true, 512, JSON_THROW_ON_ERROR))->toBe($configuration);
});

it('keeps existing combined tracker decisions valid with Matomo disabled', function () {
    config(['consent.presets' => [
        'ga4' => ['enabled' => true, 'measurement_id' => 'G-ABCD1234'],
        'google_ads' => ['enabled' => true, 'conversion_id' => 'AW-123456789'],
        'meta_pixel' => ['enabled' => true, 'pixel_id' => '123456789'],
        'clarity' => ['enabled' => true, 'project_id' => 'abc123', 'advertising' => true],
    ]]);
    $state = app(ConsentManager::class)->acceptAll();
    config(['consent.presets.matomo' => ['enabled' => false, 'url' => 'https://stats.example.test/', 'site_id' => 3]]);
    $request = Request::create('/', cookies: ['consent_preferences' => json_encode($state->toArray(), JSON_THROW_ON_ERROR)]);
    expect(app(ConsentManager::class)->read($request)->allows('analytics'))->toBeTrue()
        ->and(app(ConsentManager::class)->read($request)->allows('marketing'))->toBeTrue();
});

it('normalizes equivalent Matomo URLs and numeric IDs without changing decisions', function () {
    config(['consent.presets.matomo' => ['enabled' => true, 'url' => 'https://stats.example.test/analytics', 'site_id' => 3]]);
    $version = app(ServiceRegistry::class)->version();
    config(['consent.presets.matomo.url' => 'https://STATS.example.test:443/analytics/', 'consent.presets.matomo.site_id' => '3']);
    expect(app(ServiceRegistry::class)->version())->toBe($version);
});

it('supports Cloud hosts and HTTP local instances with subdirectories and ports', function (string $url, string $expected) {
    expect((new MatomoSettings(['enabled' => true, 'url' => $url, 'site_id' => '1']))->toArray()['url'])->toBe($expected);
})->with([
    ['https://example.matomo.cloud', 'https://example.matomo.cloud/'],
    ['http://localhost:8139/analytics/', 'http://localhost:8139/analytics/'],
    ['http://127.0.0.1:80/stats', 'http://127.0.0.1/stats/'],
    ['http://[::1]:8139/', 'http://[::1]:8139/'],
]);

it('invalidates decisions when Matomo destinations, behavior, purposes, or scopes change', function (string $key, mixed $value) {
    config(['consent.presets.matomo' => ['enabled' => true, 'url' => 'https://stats.example.test/', 'site_id' => '1']]);
    $state = app(ConsentManager::class)->acceptAll();
    config(['consent.presets.matomo.'.$key => $value]);
    $request = Request::create('/', cookies: ['consent_preferences' => json_encode($state->toArray(), JSON_THROW_ON_ERROR)]);
    expect(app(ConsentManager::class)->read($request)->allows('analytics'))->toBeFalse();
})->with([
    ['url', 'https://other.example.test/'], ['site_id', '2'], ['send_page_view', false], ['enable_link_tracking', false],
    ['cookie_path', '/shop'], ['cookie_domain', '.example.test'], ['description', 'Our custom analytics purpose.'], ['enabled', false],
]);

it('renders inert Matomo configuration and localized purposes independent of visitor cookies', function () {
    config(['consent.presets.matomo' => ['enabled' => true, 'url' => 'https://stats.example.test/', 'site_id' => '1']]);
    $before = Blade::render('<x-consent::head /><x-consent::banner locale="pl" />');
    request()->cookies->set('consent_preferences', json_encode(app(ConsentManager::class)->acceptAll()->toArray(), JSON_THROW_ON_ERROR));
    expect(Blade::render('<x-consent::head /><x-consent::banner locale="pl" />'))->toBe($before)
        ->toContain('Pomiar wizyt, interakcji i zakupów na stronie.', '"matomo":', '"siteId":"1"')
        ->not->toContain('<script src="https://stats.example.test', '"choices":');
});

it('preserves owner-defined Matomo purposes in translated interfaces', function () {
    config(['consent.presets.matomo' => ['enabled' => true, 'url' => 'https://stats.example.test/', 'site_id' => '1', 'description' => 'Our specific measurement purpose.']]);
    expect(Blade::render('<x-consent::banner locale="pl" />'))->toContain('Our specific measurement purpose.')
        ->not->toContain('Pomiar wizyt, interakcji');
});

it('rejects manual services that collide with enabled Matomo', function () {
    config([
        'consent.presets.matomo' => ['enabled' => true, 'url' => 'https://stats.example.test/', 'site_id' => '1'],
        'consent.services.matomo' => ['category' => 'analytics', 'name' => 'Duplicate', 'description' => 'A duplicate purpose.'],
    ]);
    expect(fn () => app(ServiceRegistry::class))->toThrow(InvalidArgumentException::class, 'reuse');
});

it('validates Matomo options even when disabled', function (mixed $definition) {
    expect(fn () => new MatomoSettings($definition))->toThrow(InvalidArgumentException::class);
})->with([
    [null], [false], [['unknown' => true]], [['enabled' => true]], [['enabled' => 'true']], [['enabled' => null]],
    [['send_page_view' => null]], [['enable_link_tracking' => 1]],
    [['enabled' => true, 'url' => 'https://stats.example.test/']], [['enabled' => true, 'site_id' => '1']],
    [['site_id' => 0]], [['site_id' => '01']], [['site_id' => true]], [['site_id' => 1.5]], [['site_id' => '1e2']],
    [['site_id' => '2147483648']], [['site_id' => []]],
    [['url' => '']], [['url' => '/stats']], [['url' => '//stats.example.test']], [['url' => 'javascript:alert(1)']],
    [['url' => 'ftp://stats.example.test/']], [['url' => 'https://user:secret@stats.example.test/']],
    [['url' => 'https://stats.example.test/?token=secret']], [['url' => 'https://stats.example.test/#fragment']],
    [['url' => 'https://stats.example.test/../other']], [['url' => 'https://stats.example.test/%2e%2e/other']],
    [['url' => 'https://stats.example.test/%invalid']], [['url' => 'https://stats.example.test:0/']],
    [['url' => 'https://stats.example.test/a b/']], [['url' => false]],
    [['cookie_domain' => 'https://example.test']], [['cookie_path' => null]], [['cookie_path' => '/; Secure']],
    [['name' => '']], [['description' => '']],
]);
