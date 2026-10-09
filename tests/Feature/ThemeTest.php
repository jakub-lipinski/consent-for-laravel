<?php

use ConsentForLaravel\ConsentForLaravel\BannerSettings;
use Illuminate\Support\Facades\Blade;
use Psr\Log\LoggerInterface;

it('preserves light appearance when an existing published configuration omits theme settings', function () {
    config(['consent.ui' => ['colors' => ['accent' => '#263c76']]]);
    $settings = app(BannerSettings::class);
    expect($settings->theme)->toBe('light')
        ->and($settings->colors['accent'])->toBe('#263c76')
        ->and($settings->darkColors)->toBe(BannerSettings::DARK_COLORS)
        ->and(Blade::render('<x-consent::banner />'))->toContain('data-consent-theme="light"');
});

it('renders the configured theme in either variant without an unnecessary inline override', function (string $theme, string $variant) {
    config(['consent.ui.theme' => $theme, 'consent.ui.variant' => $variant]);
    $html = Blade::render('<x-consent::banner nonce="theme-nonce" />');
    expect($html)->toContain('data-consent-theme="'.$theme.'"', 'data-consent-variant="'.$variant.'"')
        ->and(substr_count($html, '<style'))->toBe(1);
})->with(['light', 'dark', 'auto'])->with(['standard', 'compact']);

it('rejects unsupported theme configuration', function (mixed $theme) {
    expect(fn () => new BannerSettings(['theme' => $theme]))->toThrow(InvalidArgumentException::class);
})->with([null, true, 1, '', 'Dark', 'system', [[]], ['dark;}</style>']]);

it('resolves partial palettes independently and normalizes both palettes', function () {
    $settings = new BannerSettings(['colors' => ['focus' => '#263C76'], 'dark_colors' => ['accent' => '#A5E4C4']]);
    expect($settings->colors)->toBe(array_replace(BannerSettings::COLORS, ['focus' => '#263c76']))
        ->and($settings->darkColors)->toBe(array_replace(BannerSettings::DARK_COLORS, ['accent' => '#a5e4c4']))
        ->and($settings->colorWarnings)->toBe([]);
});

it('keeps unsafe dark overrides out of inline and published-asset pages', function (mixed $colors, string $absent) {
    config(['consent.ui.dark_colors' => $colors]);
    $logger = Mockery::mock(LoggerInterface::class);
    $logger->shouldReceive('warning')->once();
    app()->instance(LoggerInterface::class, $logger);
    foreach (['<x-consent::banner nonce="theme-nonce" />', '<x-consent::banner nonce="theme-nonce" style-src="/consent.css" />'] as $view) {
        expect(Blade::render($view))->toContain('data-consent-ui')->not->toContain($absent);
    }
    $settings = new BannerSettings(['dark_colors' => $colors]);
    expect($settings->darkColors['accent'])->toBe(BannerSettings::DARK_COLORS['accent'])
        ->and(implode(' ', $settings->colorWarnings))->toContain('dark');
})->with([
    'injection' => [['accent' => '#000;}</style><script>window.darkInjected=true</script>'], 'window.darkInjected'],
    'short hex' => [['accent' => '#abc'], '--consent-dark-accent:#abc;'],
    'array value' => [['accent' => []], '--consent-dark-accent:Array;'],
    'unknown key' => [['unexpected' => '#abcdef'], '--consent-dark-unexpected'],
    'malformed palette' => [false, '--consent-dark-accent:;'],
]);

it('adds nonce-protected overrides for both palettes when only dark colors change', function () {
    config(['consent.ui.theme' => 'auto', 'consent.ui.dark_colors' => ['focus' => '#FFFFFF']]);
    $html = Blade::render('<x-consent::banner nonce="theme-nonce" style-src="/consent.css" script-src="/banner.js" />');
    expect($html)->toContain('href="/consent.css"', 'src="/banner.js"', '--consent-dark-focus:#ffffff;', '--consent-focus:#245c49;')
        ->and(substr_count($html, '<style'))->toBe(1)
        ->and($html)->toContain('<style  nonce="theme-nonce"');
});

it('keeps CSS defaults consistent with both server palettes', function () {
    $css = file_get_contents(dirname(__DIR__, 2).'/resources/css/consent.css');
    foreach (['' => BannerSettings::COLORS, 'dark-' => BannerSettings::DARK_COLORS] as $prefix => $colors) {
        foreach ($colors as $key => $color) {
            expect($css)->toContain('--consent-'.$prefix.str_replace('_', '-', $key).': '.$color.';');
        }
    }
    expect((new BannerSettings(['validate_contrast' => true]))->colorWarnings)->toBe([]);
});

it('identifies dark contrast problems even when the configured theme is light', function (string $key, string $color) {
    $unchecked = new BannerSettings(['dark_colors' => [$key => $color]]);
    $checked = new BannerSettings(['theme' => 'light', 'validate_contrast' => true, 'dark_colors' => [$key => $color]]);
    expect($unchecked->colorWarnings)->toBe([])
        ->and($checked->darkColors)->toBe($unchecked->darkColors)
        ->and(implode(' ', $checked->colorWarnings))->toContain('Consent dark', $key);
})->with([
    'text' => ['text', '#111b17'],
    'muted' => ['muted', '#111b17'],
    'accent' => ['accent', '#111b17'],
    'accent text' => ['accent_text', '#8dd8b4'],
    'control' => ['control', '#111b17'],
    'focus' => ['focus', '#111b17'],
]);

it('suppresses equivalent dark warnings across modes and reports a changed dark palette immediately', function () {
    config(['consent.ui.validate_contrast' => true, 'consent.ui.dark_colors' => ['accent' => '#111B17']]);
    $logger = Mockery::mock(LoggerInterface::class);
    $logger->shouldReceive('warning')->twice()->withArgs(fn (string $message, array $context) => str_contains(implode(' ', $context['issues']), 'Consent dark'));
    app()->instance(LoggerInterface::class, $logger);
    foreach (['light', 'dark', 'auto'] as $theme) {
        config(['consent.ui.theme' => $theme]);
        app(BannerSettings::class);
    }
    config(['consent.ui.dark_colors' => ['accent' => '#111b17']]);
    app(BannerSettings::class);
    $logger->shouldHaveReceived('warning')->once();
    config(['consent.ui.dark_colors' => ['accent' => '#111b18']]);
    app(BannerSettings::class);
});
