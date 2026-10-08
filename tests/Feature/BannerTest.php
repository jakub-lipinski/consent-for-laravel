<?php

use ConsentForLaravel\ConsentForLaravel\BannerSettings;
use ConsentForLaravel\ConsentForLaravel\BannerView;
use ConsentForLaravel\ConsentForLaravel\ConsentCodec;
use ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider;
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use ConsentForLaravel\ConsentForLaravel\ServiceRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\ServiceProvider;
use Illuminate\View\ViewException;

function bannerServices(): array
{
    return [
        'statistics' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.'],
        'ads' => ['category' => 'marketing', 'name' => 'Campaigns', 'description' => 'Measure conversions.'],
        'disabled' => ['category' => 'other', 'name' => 'Unused', 'description' => 'Not enabled.', 'enabled' => false],
    ];
}

it('renders a single cache-safe interface with only registered categories and service purposes', function (string $variant) {
    config(['consent.services' => bannerServices(), 'consent.ui.variant' => $variant]);
    $html = Blade::render('<x-consent::banner /><x-consent::banner />');
    expect(substr_count($html, 'data-consent-ui data-'))->toBe(1)
        ->and($html)->toContain('data-consent-variant="'.$variant.'"', 'id="consent-category-necessary"', 'id="consent-category-analytics"', 'id="consent-category-marketing"', 'Measure visits.', 'Measure conversions.')
        ->not->toContain('id="consent-category-performance"', 'id="consent-category-other"', 'Unused', '"choices":');
    $dom = new DOMDocument;
    @$dom->loadHTML($html);
    $xpath = new DOMXPath($dom);
    expect($xpath->query('//input[@id="consent-category-necessary" and @checked and @disabled]')->length)->toBe(1)
        ->and($xpath->query('//input[not(@id="consent-category-necessary") and @checked]')->length)->toBe(0)
        ->and($xpath->query('//dialog[@aria-labelledby="consent-preferences-title"]')->length)->toBe(1)
        ->and($xpath->query('//details[@class="consent-service-details" and not(@open)]')->length)->toBe(2)
        ->and($xpath->query('//details/summary/svg[@aria-hidden="true" and @focusable="false"]')->length)->toBe(2)
        ->and($xpath->query('//details/ul/li/strong')->length)->toBe(2);
})->with(['standard', 'compact']);

it('preserves the standard default and supports variant overrides for the whole interface', function () {
    expect((new BannerSettings([]))->variant)->toBe('standard');
    expect(Blade::render('<x-consent::banner />'))->toContain('data-consent-variant="standard"');

    config(['consent.ui.variant' => 'compact']);
    expect(Blade::render('<x-consent::banner />'))->toContain('data-consent-variant="compact"');
    expect(Blade::render('<x-consent::banner variant="standard" />'))->toContain('data-consent-variant="standard"');
});

it('preserves saved grants and refusals when the interface variant changes', function (bool $allowed) {
    config(['consent.services' => bannerServices()]);
    $decision = app(ConsentManager::class)->choose(['analytics' => $allowed]);
    $cookie = app(ConsentCodec::class)->encode($decision);
    $request = Request::create('https://example.test/', cookies: ['consent_preferences' => $cookie]);

    config(['consent.ui.variant' => 'compact']);
    $restored = app(ConsentManager::class)->read($request);

    expect($restored->hasDecision())->toBeTrue()
        ->and($restored->allows('analytics'))->toBe($allowed)
        ->and($restored->decidedAt)->toBe($decision->decidedAt)
        ->and($restored->expiresAt)->toBe($decision->expiresAt);
})->with([true, false]);

it('rejects an invalid variant supplied through the component', function () {
    expect(fn () => Blade::render('<x-consent::banner variant="unknown" />'))
        ->toThrow(ViewException::class, 'Consent variant must be standard or compact.');
});

it('supports the three positions without generating visitor-specific output', function (string $position, string $variant) {
    config(['consent.ui.position' => $position, 'consent.ui.variant' => $variant]);
    $html = Blade::render('<x-consent::banner />');
    expect($html)->toContain('data-consent-position="'.$position.'"');
})->with(['bottom-left', 'bottom-right', 'bottom-center'])->with(['standard', 'compact']);

it('uses Polish or English with deterministic app-locale fallback and component overrides', function () {
    app()->setLocale('pl_PL');
    expect(Blade::render('<x-consent::banner />'))->toContain('lang="pl"', 'Akceptuj wszystkie', 'Odrzuć opcjonalne');
    app()->setLocale('de');
    expect(Blade::render('<x-consent::banner />'))->toContain('lang="en"', 'Accept all');
    config(['consent.ui.locale' => 'pl']);
    expect(Blade::render('<x-consent::banner locale="en" position="bottom-right" />'))->toContain('lang="en"', 'data-consent-position="bottom-right"')
        ->and(app()->getLocale())->toBe('de');
});

it('localizes service display without changing the consent fingerprint', function () {
    config(['consent.services' => bannerServices()]);
    $version = app(ServiceRegistry::class)->version();
    app('translator')->addLines(['services.statistics.name' => 'Statystyki', 'services.statistics.description' => 'Pomiar odwiedzin.'], 'pl', 'consent');
    $html = Blade::render('<x-consent::banner locale="pl" />');
    expect($html)->toContain('Statystyki', 'Pomiar odwiedzin.')
        ->and(app(ServiceRegistry::class)->version())->toBe($version);
});

it('escapes service text, policy links, and translated UI content', function () {
    config(['consent.services' => ['xss' => ['category' => 'other', 'name' => '<script>alert(1)</script>', 'description' => '<img src=x onerror=alert(1)>']], 'consent.ui.policy_url' => '/cookies?x="&y=1']);
    $html = Blade::render('<x-consent::banner />');
    expect($html)->toContain('&lt;script&gt;', '&lt;img', '/cookies?x=&quot;&amp;y=1')
        ->not->toContain('<script>alert(1)</script>', '<img src=x');
});

it('renders CSP nonces and can reference published styles and UI scripts', function () {
    $inline = Blade::render('<x-consent::banner nonce="example-nonce" />');
    $published = Blade::render('<x-consent::banner nonce="example-nonce" style-src="/vendor/consent/consent.css" script-src="/vendor/consent/banner.js" />');
    expect($inline)->toContain('<style  nonce="example-nonce"', '<script  nonce="example-nonce"')
        ->and($published)->toContain('href="/vendor/consent/consent.css"', 'src="/vendor/consent/banner.js"')
        ->not->toContain('function mount(root)', '--consent-background: #ffffff');
    $sources = array_map('realpath', array_keys(ServiceProvider::pathsToPublish(ConsentForLaravelServiceProvider::class, 'consent-assets')));
    expect($sources)->toContain(dirname(__DIR__, 2).'/resources/css/consent.css', dirname(__DIR__, 2).'/resources/js/banner.js');
});

it('keeps both translation dictionaries complete and all default theme contrast pairs accessible', function () {
    $en = require dirname(__DIR__, 2).'/resources/lang/en/messages.php';
    $pl = require dirname(__DIR__, 2).'/resources/lang/pl/messages.php';
    expect(array_keys($en))->toBe(array_keys($pl))
        ->and(array_keys($en['categories']))->toBe(array_keys($pl['categories']));
    foreach ($en['categories'] as $key => $value) {
        expect(array_keys($value))->toBe(array_keys($pl['categories'][$key]));
    }
    $settings = new BannerSettings([]);
    foreach (['text', 'muted', 'accent'] as $key) {
        expect(BannerSettings::contrast($settings->colors[$key], $settings->colors['background']))->toBeGreaterThanOrEqual(4.5);
    }
    foreach (['control', 'focus'] as $key) {
        expect(BannerSettings::contrast($settings->colors[$key], $settings->colors['background']))->toBeGreaterThanOrEqual(3);
    }
    expect(BannerSettings::contrast('#000000', '#ffffff'))->toBe(21.0);
});

it('validates UI configuration and rejects unsafe or inaccessible themes', function (mixed $ui) {
    expect(fn () => new BannerSettings($ui))->toThrow(InvalidArgumentException::class);
})->with([
    [null], [false], [['unexpected' => true]], [['position' => 'center']], [['position' => null]],
    [['variant' => null]], [['variant' => '']], [['variant' => 'Compact']], [['variant' => 'full']],
    [['variant' => true]], [['variant' => 1]], [['variant' => []]],
    [['locale' => 'de']], [['locale' => []]], [['policy_url' => 'javascript:alert(1)']], [['policy_url' => '//example.test']],
    [['policy_url' => 'https://user:password@example.test']], [['policy_url' => '/\\example.test']], [['policy_url' => ' /cookies']],
    [['colors' => null]], [['colors' => ['unknown' => '#000000']]], [['colors' => ['accent' => 'red']]],
    [['colors' => ['accent' => '#000;}</style>']]], [['colors' => ['text' => '#ffffff']]], [['colors' => ['muted' => '#aaaaaa']]],
    [['colors' => ['accent_text' => '#245c49']]], [['colors' => ['control' => '#eeeeee']]], [['colors' => ['focus' => '#eeeeee']]],
]);

it('supports custom accessible colors and validates component overrides', function () {
    config(['consent.ui.colors' => ['accent' => '#263C76', 'focus' => '#263C76'], 'consent.ui.policy_url' => 'https://example.test/privacy']);
    expect(Blade::render('<x-consent::banner />'))->toContain('--consent-accent:#263c76;', 'https://example.test/privacy')
        ->and(fn () => app(BannerView::class)->locale('de'))->toThrow(InvalidArgumentException::class)
        ->and(fn () => BannerSettings::position('unknown'))->toThrow(InvalidArgumentException::class);
});

it('renders necessary information without adding inactive optional categories', function () {
    $html = Blade::render('<x-consent::banner />');
    expect($html)->toContain('id="consent-category-necessary"')->not->toContain('id="consent-category-analytics"');
});
