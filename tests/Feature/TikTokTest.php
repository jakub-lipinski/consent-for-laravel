<?php

use ConsentForLaravel\ConsentForLaravel\AuditController;
use ConsentForLaravel\ConsentForLaravel\AuditNotice;
use ConsentForLaravel\ConsentForLaravel\BrowserRuntime;
use ConsentForLaravel\ConsentForLaravel\Category;
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use ConsentForLaravel\ConsentForLaravel\ServiceRegistry;
use ConsentForLaravel\ConsentForLaravel\TikTokSettings;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

it('keeps TikTok disabled without invalidating existing combined tracker decisions', function () {
    config(['consent.presets' => [
        'ga4' => ['enabled' => true, 'measurement_id' => 'G-ABCD1234'],
        'meta_pixel' => ['enabled' => true, 'pixel_id' => '123456789'],
        'clarity' => ['enabled' => true, 'project_id' => 'abc123'],
        'matomo' => ['enabled' => true, 'url' => 'https://stats.example.test/', 'site_id' => 3],
    ]]);
    $state = app(ConsentManager::class)->acceptAll();
    config(['consent.presets.tiktok_pixel' => ['enabled' => false, 'pixel_id' => 'C1234567890ABCDEFGHI']]);
    $request = Request::create('/', cookies: ['consent_preferences' => json_encode($state->toArray(), JSON_THROW_ON_ERROR)]);
    expect(app(ConsentManager::class)->read($request)->allows('analytics'))->toBeTrue()
        ->and(app(ConsentManager::class)->read($request)->allows('marketing'))->toBeTrue()
        ->and((new TikTokSettings)->toArray())->toBeNull();
});

it('registers TikTok only in marketing with scoped first-party cookies and no Google bridge', function () {
    config(['consent.presets.tiktok_pixel' => ['enabled' => true, 'pixel_id' => 'C1234567890ABCDEFGHI', 'cookie_path' => '/shop', 'cookie_domain' => '.example.test']]);
    $runtime = app(BrowserRuntime::class)->configuration();
    expect($runtime['trackers']['tiktok'])->toBe(['id' => 'C1234567890ABCDEFGHI', 'sendPageView' => true])
        ->and($runtime['google'])->toBeNull()
        ->and($runtime['categories'])->toBe(['necessary', 'marketing'])
        ->and(app(ServiceRegistry::class)->get('tiktok-pixel')->cookies[0]->toArray())->toBe(['name' => '_ttp', 'prefix' => null, 'path' => '/shop', 'domain' => '.example.test'])
        ->and(app(ServiceRegistry::class)->get('tiktok-pixel')->cookies[3]->prefix)->toBe('ttcsid_')
        ->and(json_decode(app(BrowserRuntime::class)->json(), true, 512, JSON_THROW_ON_ERROR))->toBe($runtime);
});

it('invalidates consent after TikTok destinations, behavior, purposes, or cleanup scopes change', function (string $key, mixed $value) {
    config(['consent.presets.tiktok_pixel' => ['enabled' => true, 'pixel_id' => 'C1234567890ABCDEFGHI']]);
    $state = app(ConsentManager::class)->acceptAll();
    config(['consent.presets.tiktok_pixel.'.$key => $value]);
    $request = Request::create('/', cookies: ['consent_preferences' => json_encode($state->toArray(), JSON_THROW_ON_ERROR)]);
    expect(app(ConsentManager::class)->read($request)->allows('marketing'))->toBeFalse();
})->with([
    ['pixel_id', 'C9876543210ABCDEFGHI'], ['send_page_view', false], ['enabled', false],
    ['cookie_path', '/shop'], ['cookie_domain', '.example.test'], ['name', 'Our TikTok campaigns'], ['description', 'Measure campaign orders.'],
]);

it('renders cache-safe TikTok settings and respects custom purposes', function () {
    config(['consent.presets.tiktok_pixel' => ['enabled' => true, 'pixel_id' => 'C1234567890ABCDEFGHI', 'description' => 'Our campaign measurement purpose.']]);
    $before = Blade::render('<x-consent::head /><x-consent::banner locale="pl" />');
    request()->cookies->set('consent_preferences', json_encode(app(ConsentManager::class)->acceptAll()->toArray(), JSON_THROW_ON_ERROR));
    expect(Blade::render('<x-consent::head /><x-consent::banner locale="pl" />'))->toBe($before)
        ->toContain('"tiktok":', 'Our campaign measurement purpose.')
        ->not->toContain('<script src="https://analytics.tiktok.com', 'Pomiar skuteczności reklam, interakcji');
});

it('rejects a manual service colliding with the TikTok preset', function () {
    config(['consent.presets.tiktok_pixel' => ['enabled' => true, 'pixel_id' => 'C1234567890ABCDEFGHI'],
        'consent.services.tiktok-pixel' => ['category' => 'marketing', 'name' => 'Duplicate', 'description' => 'Duplicate purpose.']]);
    expect(fn () => app(ServiceRegistry::class))->toThrow(InvalidArgumentException::class, 'reuse');
});

it('validates TikTok definitions even when disabled', function (mixed $definition) {
    expect(fn () => new TikTokSettings($definition))->toThrow(InvalidArgumentException::class);
})->with([
    [null], [false], [['unknown' => true]], [['enabled' => true]], [['enabled' => null]], [['enabled' => 'true']],
    [['pixel_id' => '']], [['pixel_id' => 'short']], [['pixel_id' => str_repeat('A', 21)]], [['pixel_id' => str_repeat('a', 20)]],
    [['pixel_id' => 123]], [['pixel_id' => 'C1234567890ABCDEFGH<']], [['pixel_id' => []]],
    [['send_page_view' => null]], [['send_page_view' => 1]], [['name' => '']], [['description' => '']],
    [['cookie_path' => null]], [['cookie_path' => '/; Secure']], [['cookie_domain' => 'https://example.test']],
]);

it('includes translated TikTok in signed database audit notices for every language and variant', function (string $locale, string $variant) {
    config(['app.key' => 'base64:'.base64_encode(str_repeat('a', 32)), 'consent.audit.enabled' => true,
        'consent.presets.tiktok_pixel' => ['enabled' => true, 'pixel_id' => 'C1234567890ABCDEFGHI']]);
    $migration = require dirname(__DIR__, 2).'/database/migrations/create_consent_audit_tables.php.stub';
    $migration->up();
    Route::post('/consent/decisions', AuditController::class);
    try {
        $html = Blade::render('<x-consent::banner locale="'.$locale.'" variant="'.$variant.'" />');
        preg_match('~<script[^>]*data-consent-notice[^>]*>(.*?)</script>~s', $html, $matches);
        $notice = json_decode($matches[1], true, 64, JSON_THROW_ON_ERROR);
        $messages = require dirname(__DIR__, 2).'/resources/lang/'.$locale.'/messages.php';
        $snapshot = json_decode($notice['payload'], true, 64, JSON_THROW_ON_ERROR);
        expect(app(AuditNotice::class)->authentic($notice['payload'], $notice['signature'], 'notice'))->toBeTrue()
            ->and($snapshot['html'])->toContain(e($messages['presets']['tiktok-pixel']['description']))
            ->and($snapshot['services'][0]['id'])->toBe('tiktok-pixel')
            ->and(DB::table('consent_decisions')->count())->toBe(0);
        $submission = ['id' => (string) Str::uuid(), 'notice' => $notice, 'action' => 'accept_all',
            'choices' => array_replace(Category::deniedChoices(), ['marketing' => true])];
        $this->call('POST', '/consent/decisions', server: ['HTTP_ORIGIN' => 'http://localhost', 'CONTENT_TYPE' => 'application/json'],
            content: json_encode($submission, JSON_THROW_ON_ERROR))->assertCreated();
        expect(DB::table('consent_notices')->value('snapshot'))->toBe($notice['payload'])
            ->and(json_decode(DB::table('consent_decisions')->value('choices'), true)['marketing'])->toBeTrue()
            ->and(app(BrowserRuntime::class)->configuration()['protectedCookies'])->toContain('consent_preferences_audit');
    } finally {
        $migration->down();
    }
})->with(['en', 'pl', 'de', 'fr', 'it', 'es', 'pt', 'cs', 'nl'])->with(['standard', 'compact']);
