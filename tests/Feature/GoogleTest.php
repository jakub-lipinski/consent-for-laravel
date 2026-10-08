<?php

use ConsentForLaravel\ConsentForLaravel\BrowserRuntime;
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use ConsentForLaravel\ConsentForLaravel\GoogleSettings;
use ConsentForLaravel\ConsentForLaravel\ServiceRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Blade;

it('keeps Google completely disabled by default and preserves existing service versions', function () {
    expect(app(GoogleSettings::class)->enabled)->toBeFalse()
        ->and(app(BrowserRuntime::class)->configuration()['google'])->toBeNull()
        ->and(app(ServiceRegistry::class)->version())->toBe((new ServiceRegistry([]))->version());
});

it('registers enabled presets without duplicate manual services and emits cache-safe settings', function () {
    config([
        'consent.presets.ga4' => ['enabled' => true, 'measurement_id' => 'G-ABCD1234', 'send_page_view' => false],
        'consent.presets.google_ads' => ['enabled' => true, 'conversion_id' => 'AW-123456789', 'cookie_domain' => '.example.test'],
    ]);
    $runtime = app(BrowserRuntime::class)->configuration();
    $registry = app(ServiceRegistry::class);
    expect($runtime['google'])->toBe(['mode' => 'basic', 'targets' => [
        ['id' => 'G-ABCD1234', 'category' => 'analytics', 'sendPageView' => false],
        ['id' => 'AW-123456789', 'category' => 'marketing', 'sendPageView' => false],
    ]])->and($registry->uses('analytics'))->toBeTrue()
        ->and($registry->uses('marketing'))->toBeTrue()
        ->and($registry->get('google-ga4')->cookies[0]->toArray()['name'])->toBe('_ga')
        ->and($registry->get('google-ads')->cookies[0]->toArray()['domain'])->toBe('.example.test')
        ->and(Blade::render('<x-consent::head /><x-consent::banner />'))->toContain('Google Analytics 4', 'Google Ads')
        ->not->toContain('"choices":');
});

it('invalidates a previous decision when a Google ID, mode, or initialization setting changes', function (string $key, mixed $value) {
    config(['consent.presets.ga4' => ['enabled' => true, 'measurement_id' => 'G-ABCD1234']]);
    $decision = app(ConsentManager::class)->acceptAll();
    $cookie = json_encode($decision->toArray(), JSON_THROW_ON_ERROR);
    config([$key => $value]);
    expect(app(ConsentManager::class)->read(Request::create('/', cookies: ['consent_preferences' => $cookie]))->allows('analytics'))->toBeFalse();
})->with([
    ['consent.presets.ga4.measurement_id', 'G-OTHER123'],
    ['consent.presets.ga4.send_page_view', false],
    ['consent.google.mode', 'advanced'],
]);

it('rejects invalid Google and preset settings even before publication', function (mixed $google, mixed $presets) {
    expect(fn () => new GoogleSettings($google, $presets))->toThrow(InvalidArgumentException::class);
})->with([
    [false, []], [['mode' => 'unknown'], []], [['mode' => null], []], [['enabled' => 'true'], []], [['unexpected' => true], []],
    [[], ['ga4' => false]], [[], ['ga4' => null]], [[], ['gtm' => []]], [[], ['ga4' => ['enabled' => true]]],
    [[], ['ga4' => ['enabled' => 1]]], [[], ['ga4' => ['enabled' => null]]], [[], ['ga4' => ['measurement_id' => 'G-X"</script>']]],
    [[], ['ga4' => ['measurement_id' => 'AW-123']]], [[], ['ga4' => ['send_page_view' => 'false']]],
    [[], ['ga4' => ['cookie_path' => 'relative']]], [[], ['ga4' => ['cookie_domain' => 'https://example.test']]],
    [[], ['ga4' => ['name' => '']]], [[], ['google_ads' => ['conversion_id' => 'AW-0']]],
    [[], ['google_ads' => ['conversion_id' => '123']]], [[], ['google_ads' => ['send_page_view' => true]]],
    [['enabled' => false], ['ga4' => ['enabled' => true, 'measurement_id' => 'G-ABCD1234']]],
]);

it('rejects a manual service colliding with an enabled preset', function () {
    config([
        'consent.presets.ga4' => ['enabled' => true, 'measurement_id' => 'G-ABCD1234'],
        'consent.services.google-ga4' => ['category' => 'analytics', 'name' => 'Duplicated', 'description' => 'Measure usage.'],
    ]);
    expect(fn () => app(ServiceRegistry::class))->toThrow(InvalidArgumentException::class, 'reuse');
});

it('supports the consent bridge without a built-in tracker', function () {
    config(['consent.google.enabled' => true]);
    expect(app(BrowserRuntime::class)->configuration()['google'])->toBe(['mode' => 'basic', 'targets' => []]);
});

it('discloses Advanced measurement in both interfaces and translates default purposes without hiding custom ones', function () {
    config(['consent.google.mode' => 'advanced', 'consent.presets.ga4' => ['enabled' => true, 'measurement_id' => 'G-ABCD1234']]);
    $version = app(ServiceRegistry::class)->version();
    $html = Blade::render('<x-consent::banner locale="pl" />');
    expect(substr_count($html, 'Tagi Google wysyłają'))->toBe(2)
        ->and($html)->toContain('Pomiar wizyt i korzystania ze strony.');
    config(['consent.presets.ga4.description' => 'Our specific processing purpose.']);
    expect(Blade::render('<x-consent::banner locale="pl" />'))->toContain('Our specific processing purpose.')
        ->not->toContain('Pomiar wizyt i korzystania ze strony.')
        ->and(app(ServiceRegistry::class)->version())->not->toBe($version);
});
