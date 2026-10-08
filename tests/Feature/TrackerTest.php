<?php

use ConsentForLaravel\ConsentForLaravel\BrowserRuntime;
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use ConsentForLaravel\ConsentForLaravel\GoogleSettings;
use ConsentForLaravel\ConsentForLaravel\ServiceRegistry;
use ConsentForLaravel\ConsentForLaravel\TrackerSettings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Blade;

it('keeps trackers disabled and preserves Google-only fingerprints', function () {
    expect(app(TrackerSettings::class)->toArray())->toBe([]);
    config(['consent.presets.ga4' => ['enabled' => true, 'measurement_id' => 'G-ABCD1234']]);
    $google = app(GoogleSettings::class);
    expect(app(ServiceRegistry::class)->version())->toBe((new ServiceRegistry([], $google->services(), $google->toArray()))->version());
});

it('registers trackers and scoped cleanup without manual services', function () {
    config([
        'consent.presets.meta_pixel' => ['enabled' => true, 'pixel_id' => '123456789012345', 'send_page_view' => false, 'cookie_domain' => '.example.test'],
        'consent.presets.clarity' => ['enabled' => true, 'project_id' => 'abc123def4'],
    ]);
    $registry = app(ServiceRegistry::class);
    expect(app(BrowserRuntime::class)->configuration()['trackers'])->toBe([
        'meta' => ['id' => '123456789012345', 'sendPageView' => false],
        'clarity' => ['id' => 'abc123def4', 'advertising' => false],
    ])->and($registry->uses('analytics'))->toBeTrue()
        ->and($registry->uses('marketing'))->toBeTrue()
        ->and($registry->get('meta-pixel')->cookies[1]->toArray())->toBe(['name' => '_fbc', 'prefix' => null, 'path' => '/', 'domain' => '.example.test'])
        ->and($registry->get('microsoft-clarity')->cookies[0]->toArray()['name'])->toBe('_clck')
        ->and(Blade::render('<x-consent::head /><x-consent::banner locale="pl" />'))->toContain('Meta Pixel', 'map cieplnych', 'Pomiar skuteczności reklam')
        ->not->toContain('"choices":');
});

it('shows Clarity advertising only when explicitly configured', function () {
    config(['consent.presets.clarity' => ['enabled' => true, 'project_id' => 'abc123def4']]);
    expect(app(ServiceRegistry::class)->uses('marketing'))->toBeFalse();
    config(['consent.presets.clarity.advertising' => true]);
    expect(app(ServiceRegistry::class)->uses('marketing'))->toBeTrue()
        ->and(Blade::render('<x-consent::banner locale="pl" />'))->toContain('Funkcje reklamowe Microsoft Clarity');
});

it('invalidates decisions when tracker identifiers or behavior change', function (string $key, mixed $value) {
    config([
        'consent.presets.meta_pixel' => ['enabled' => true, 'pixel_id' => '123456789012345'],
        'consent.presets.clarity' => ['enabled' => true, 'project_id' => 'abc123def4'],
    ]);
    $state = app(ConsentManager::class)->acceptAll();
    config([$key => $value]);
    expect(app(ConsentManager::class)->read(Request::create('/', cookies: ['consent_preferences' => json_encode($state->toArray(), JSON_THROW_ON_ERROR)]))->allows('analytics'))->toBeFalse();
})->with([
    ['consent.presets.meta_pixel.pixel_id', '987654321'],
    ['consent.presets.meta_pixel.send_page_view', false],
    ['consent.presets.clarity.project_id', 'other123'],
    ['consent.presets.clarity.advertising', true],
]);

it('rejects malformed tracker definitions including disabled presets', function (mixed $presets) {
    expect(fn () => new TrackerSettings($presets))->toThrow(InvalidArgumentException::class);
})->with([
    [null], [false], [['gtm' => []]], [['meta_pixel' => null]], [['clarity' => false]],
    [['meta_pixel' => ['enabled' => true]]], [['meta_pixel' => ['enabled' => null]]],
    [['meta_pixel' => ['enabled' => 'true']]], [['meta_pixel' => ['pixel_id' => 123]]],
    [['meta_pixel' => ['pixel_id' => '0']]], [['meta_pixel' => ['pixel_id' => '123</script>']]],
    [['meta_pixel' => ['send_page_view' => null]]], [['meta_pixel' => ['advertising' => true]]],
    [['clarity' => ['enabled' => true]]], [['clarity' => ['project_id' => '../tag']]],
    [['clarity' => ['advertising' => 1]]], [['clarity' => ['cookie_path' => 'relative']]],
    [['clarity' => ['cookie_domain' => 'https://example.test']]], [['clarity' => ['description' => '']]],
]);

it('rejects manual services colliding with any enabled tracker purpose', function (string $id) {
    config([
        'consent.presets.meta_pixel' => ['enabled' => true, 'pixel_id' => '123456789'],
        'consent.presets.clarity' => ['enabled' => true, 'project_id' => 'abc123', 'advertising' => true],
        "consent.services.$id" => ['category' => 'analytics', 'name' => 'Duplicate', 'description' => 'A duplicate purpose.'],
    ]);
    expect(fn () => app(ServiceRegistry::class))->toThrow(InvalidArgumentException::class, 'reuse');
})->with(['meta-pixel', 'microsoft-clarity', 'microsoft-clarity-ads']);

it('preserves custom tracker purpose descriptions in every locale', function () {
    config(['consent.presets.clarity' => ['enabled' => true, 'project_id' => 'abc123', 'description' => 'Our precise recording purpose.']]);
    expect(Blade::render('<x-consent::banner locale="pl" />'))->toContain('Our precise recording purpose.')
        ->not->toContain('map cieplnych');
});

it('lets owners describe Clarity advertising separately and validates disabled descriptions', function () {
    config(['consent.presets.clarity' => ['enabled' => true, 'project_id' => 'abc123', 'advertising' => true, 'advertising_description' => 'Our specific advertising purpose.']]);
    expect(Blade::render('<x-consent::banner locale="pl" />'))->toContain('Our specific advertising purpose.');
    expect(fn () => new TrackerSettings(['clarity' => ['advertising_description' => '']]))->toThrow(InvalidArgumentException::class);
});
