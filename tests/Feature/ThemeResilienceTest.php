<?php

use ConsentForLaravel\ConsentForLaravel\BannerSettings;
use ConsentForLaravel\ConsentForLaravel\ConsentCodec;
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use Illuminate\Cache\FileStore;
use Illuminate\Cache\Repository as CacheRepository;
use Illuminate\Contracts\Cache\Repository as CacheContract;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\Route;
use Psr\Log\LoggerInterface;

function registerThemePage(): void
{
    Route::get('/theme-page', fn () => Blade::render('<!doctype html><html lang="en"><head><x-consent::head nonce="theme-nonce" /></head><body><main tabindex="-1"><h1>Host page survives</h1></main><x-consent::banner nonce="theme-nonce" /></body></html>'));
}

it('renders the entire host page with the reported orange theme and optional contrast diagnostics', function (?bool $diagnostics) {
    $ui = ['colors' => ['accent' => '#d86a32', 'focus' => '#d86a32']];
    if ($diagnostics !== null) {
        $ui['validate_contrast'] = $diagnostics;
    }
    config(['consent.ui' => $ui]);
    $logger = Mockery::mock(LoggerInterface::class);
    if ($diagnostics === true) {
        $logger->shouldReceive('warning')->once()->withArgs(fn (string $message, array $context) => str_contains($message, 'Consent UI') && count($context['issues']) === 2
            && str_contains($context['issues'][0], '[accent]') && str_contains($context['issues'][1], 'accent_text'));
    } else {
        $logger->shouldNotReceive('warning');
    }
    app()->instance(LoggerInterface::class, $logger);
    registerThemePage();

    $this->get('/theme-page')->assertOk()->assertSee('Host page survives')
        ->assertSee('--consent-accent:#d86a32;', false)->assertSee('--consent-focus:#d86a32;', false)
        ->assertSee('data-consent-ui', false)->assertSee('nonce="theme-nonce"', false);
})->with(['existing published configuration' => null, 'disabled' => false, 'enabled' => true]);

it('never writes unsafe color values into CSS and falls back without losing the host page', function (mixed $colors, string $absent) {
    config(['consent.ui.colors' => $colors]);
    $logger = Mockery::mock(LoggerInterface::class);
    $logger->shouldReceive('warning')->once();
    app()->instance(LoggerInterface::class, $logger);
    registerThemePage();

    $this->get('/theme-page')->assertOk()->assertSee('Host page survives')
        ->assertSee('data-consent-ui', false)->assertDontSee($absent, false);
    expect((new BannerSettings(['colors' => $colors]))->colors['accent'])->toBe(BannerSettings::COLORS['accent']);
})->with([
    'CSS injection' => [['accent' => '#000;}</style><script>window.themeInjected=true</script>'], 'window.themeInjected'],
    'named color' => [['accent' => 'not-a-hex-color'], 'not-a-hex-color'],
    'short hex' => [['accent' => '#abc'], '--consent-accent:#abc;'],
    'array color' => [['accent' => []], '--consent-accent:Array;'],
    'null color' => [['accent' => null], '--consent-accent:;'],
    'unknown key' => [['unexpected-color' => '#abcdef'], '--consent-unexpected-color'],
    'malformed palette' => [null, '--consent-accent:;'],
]);

it('keeps valid overrides when another color is malformed', function () {
    $settings = new BannerSettings(['colors' => ['accent' => 'invalid', 'focus' => '#263C76']]);
    expect($settings->colors['accent'])->toBe(BannerSettings::COLORS['accent'])
        ->and($settings->colors['focus'])->toBe('#263c76');
});

it('does not let an unavailable diagnostics logger interrupt the host page', function () {
    config(['consent.ui.validate_contrast' => true, 'consent.ui.colors' => ['accent' => '#d86a32']]);
    $logger = Mockery::mock(LoggerInterface::class);
    $logger->shouldReceive('warning')->once()->andThrow(new RuntimeException('Log file unavailable.'));
    app()->instance(LoggerInterface::class, $logger);
    registerThemePage();

    $this->get('/theme-page')->assertOk()->assertSee('Host page survives')->assertSee('--consent-accent:#d86a32;', false);
    $this->get('/theme-page')->assertOk()->assertSee('Host page survives');
});

it('logs identical diagnostics only once until exactly 72 hours have passed', function (array $ui) {
    $this->freezeTime();
    $started = now();
    config(['consent.ui' => $ui]);
    $logger = Mockery::mock(LoggerInterface::class);
    $logger->shouldReceive('warning')->twice();
    app()->instance(LoggerInterface::class, $logger);
    registerThemePage();

    $this->get('/theme-page')->assertOk();
    $this->get('/theme-page')->assertOk();
    app(BannerSettings::class);
    $logger->shouldHaveReceived('warning')->once();

    $this->travelTo($started->copy()->addHours(72)->subSecond());
    $this->get('/theme-page')->assertOk();
    $logger->shouldHaveReceived('warning')->once();

    $this->travelTo($started->copy()->addHours(72));
    $this->get('/theme-page')->assertOk();
    $this->get('/theme-page')->assertOk();
    $logger->shouldHaveReceived('warning')->twice();
})->with([
    'contrast warnings' => [['validate_contrast' => true, 'colors' => ['accent' => '#d86a32']]],
    'invalid color warnings with diagnostics disabled' => [['colors' => ['accent' => 'orange']]],
]);

it('reports a changed palette immediately even when it has the same contrast issues', function () {
    config(['consent.ui.validate_contrast' => true, 'consent.ui.colors' => ['accent' => '#d86a32']]);
    $logger = Mockery::mock(LoggerInterface::class);
    $logger->shouldReceive('warning')->twice();
    app()->instance(LoggerInterface::class, $logger);
    $first = app(BannerSettings::class);
    config(['consent.ui.colors' => ['accent' => '#e08040']]);
    $second = app(BannerSettings::class);
    expect($first->colorWarnings)->toBe($second->colorWarnings);
    config(['consent.ui.colors' => ['accent' => '#d86a32']]);
    app(BannerSettings::class);
});

it('reports newly detected issues immediately when the resolved palette stays the same', function () {
    config(['consent.ui.colors' => ['accent' => 'orange']]);
    $logger = Mockery::mock(LoggerInterface::class);
    $logger->shouldReceive('warning')->twice();
    app()->instance(LoggerInterface::class, $logger);
    $first = app(BannerSettings::class);
    config(['consent.ui.colors' => ['accent' => 'orange', 'focus' => 'blue']]);
    $second = app(BannerSettings::class);
    expect($first->colors)->toBe($second->colors)
        ->and($first->colorWarnings)->not->toBe($second->colorWarnings);
});

it('does not repeat diagnostics after presentation changes or equivalent color configuration', function () {
    config(['consent.ui.validate_contrast' => true, 'consent.ui.colors' => ['accent' => '#D86A32', 'focus' => '#245C49']]);
    $logger = Mockery::mock(LoggerInterface::class);
    $logger->shouldReceive('warning')->once();
    app()->instance(LoggerInterface::class, $logger);
    app(BannerSettings::class);
    config(['consent.ui.variant' => 'compact', 'consent.ui.locale' => 'fr', 'consent.ui.position' => 'bottom-right', 'consent.ui.policy_url' => '/cookies']);
    app(BannerSettings::class);
    config(['consent.ui.colors' => ['focus' => '#245c49', 'accent' => '#d86a32']]);
    app(BannerSettings::class);
});

it('persists diagnostic suppression across independent file cache instances', function () {
    $path = sys_get_temp_dir().'/consent-theme-cache-'.bin2hex(random_bytes(8));
    config(['consent.ui.validate_contrast' => true, 'consent.ui.colors' => ['accent' => '#d86a32']]);
    $logger = Mockery::mock(LoggerInterface::class);
    $logger->shouldReceive('warning')->once();
    app()->instance(LoggerInterface::class, $logger);
    registerThemePage();
    try {
        foreach (range(1, 3) as $attempt) {
            app()->instance(CacheContract::class, new CacheRepository(new FileStore(new Filesystem, $path)));
            $this->get('/theme-page')->assertOk()->assertSee('--consent-accent:#d86a32;', false);
        }
    } finally {
        (new Filesystem)->deleteDirectory($path);
    }
});

it('skips logging when cache cannot claim the diagnostic interval and preserves page rendering', function (bool $throws) {
    config(['consent.ui.validate_contrast' => true, 'consent.ui.colors' => ['accent' => '#d86a32']]);
    $cache = Mockery::mock(CacheContract::class);
    $claim = $cache->shouldReceive('add')->twice();
    if ($throws) {
        $claim->andThrow(new RuntimeException('Diagnostic cache unavailable.'));
    } else {
        $claim->andReturn(false);
    }
    app()->instance(CacheContract::class, $cache);
    $logger = Mockery::mock(LoggerInterface::class);
    $logger->shouldNotReceive('warning');
    app()->instance(LoggerInterface::class, $logger);
    registerThemePage();
    $this->get('/theme-page')->assertOk()->assertSee('Host page survives')->assertSee('--consent-accent:#d86a32;', false);
    $this->get('/theme-page')->assertOk()->assertSee('Host page survives');
})->with(['cache exception' => true, 'claim rejected or cache write failed' => false]);

it('does not access the diagnostic cache or logger when there are no warnings', function (bool $diagnostics) {
    config(['consent.ui.validate_contrast' => $diagnostics]);
    $cache = Mockery::mock(CacheContract::class);
    $cache->shouldNotReceive('add');
    app()->instance(CacheContract::class, $cache);
    $logger = Mockery::mock(LoggerInterface::class);
    $logger->shouldNotReceive('warning');
    app()->instance(LoggerInterface::class, $logger);
    registerThemePage();
    $this->get('/theme-page')->assertOk();
})->with([true, false]);

it('reports no contrast issues for the default and custom accessible themes', function () {
    foreach ([[], ['accent' => '#263c76', 'focus' => '#263c76']] as $colors) {
        $settings = new BannerSettings(['validate_contrast' => true, 'colors' => $colors]);
        expect($settings->colorWarnings)->toBe([]);
    }
});

it('checks every contrast pair only when diagnostics are enabled and preserves the selected colors', function (string $key, string $color, string $issue) {
    $unchecked = new BannerSettings(['colors' => [$key => $color]]);
    $checked = new BannerSettings(['validate_contrast' => true, 'colors' => [$key => $color]]);

    expect($unchecked->colorWarnings)->toBe([])->and($checked->colors)->toBe($unchecked->colors)
        ->and($checked->colors[$key])->toBe($color)->and(implode(' ', $checked->colorWarnings))->toContain($issue);
})->with([
    'text' => ['text', '#ffffff', '[text]'],
    'muted' => ['muted', '#aaaaaa', '[muted]'],
    'accent' => ['accent', '#d86a32', '[accent]'],
    'accent text' => ['accent_text', '#245c49', 'accent_text'],
    'control' => ['control', '#eeeeee', '[control]'],
    'focus' => ['focus', '#eeeeee', '[focus]'],
]);

it('does not enable contrast diagnostics through a truthy non-boolean flag', function () {
    $settings = new BannerSettings(['validate_contrast' => 'true', 'colors' => ['accent' => '#d86a32']]);
    expect($settings->validateContrast)->toBeFalse()->and($settings->colors['accent'])->toBe('#d86a32')
        ->and($settings->colorWarnings)->toHaveCount(1)->and($settings->colorWarnings[0])->toContain('must be boolean');
});

it('preserves saved consent and its lifetime across theme diagnostics changes', function (bool $allowed) {
    config(['consent.services' => ['statistics' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.']]]);
    $decision = app(ConsentManager::class)->choose(['analytics' => $allowed]);
    $cookie = app(ConsentCodec::class)->encode($decision);
    config(['consent.ui.validate_contrast' => true, 'consent.ui.colors' => ['accent' => '#d86a32']]);
    Blade::render('<x-consent::banner />');
    $restored = app(ConsentManager::class)->read(Request::create('https://example.test/', cookies: ['consent_preferences' => $cookie]));

    expect($restored->hasDecision())->toBeTrue()->and($restored->allows('analytics'))->toBe($allowed)
        ->and($restored->decidedAt)->toBe($decision->decidedAt)->and($restored->expiresAt)->toBe($decision->expiresAt);
})->with([true, false]);
