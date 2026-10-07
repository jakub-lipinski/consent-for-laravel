<?php

use ConsentForLaravel\ConsentForLaravel\BrowserRuntime;
use ConsentForLaravel\ConsentForLaravel\Category;
use ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider;
use ConsentForLaravel\ConsentForLaravel\ConsentSettings;
use ConsentForLaravel\ConsentForLaravel\CookieRule;
use ConsentForLaravel\ConsentForLaravel\ScriptRenderer;
use ConsentForLaravel\ConsentForLaravel\ServiceRegistry;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\ServiceProvider;

it('renders the short directive into inert templates regardless of request cookies', function () {
    $rendered = Blade::render(<<<'BLADE'
        @consent('analytics')
            <script src="https://example.test/analytics.js"></script>
            <script>window.measurement = @json($measurement);</script>
        @endconsent
        BLADE, ['measurement' => 'value']);

    expect($rendered)->toContain('<template data-consent-block="consent-auto-1" data-consent-category="analytics">')
        ->toContain('window.measurement = "value";')
        ->toContain("</script>\n</template>")
        ->and(substr_count($rendered, '<template'))->toBe(1);
});

it('supports explicit identifiers, enums, multiple blocks, includes, and compiled views', function () {
    $directory = sys_get_temp_dir().'/consent-blade-'.bin2hex(random_bytes(6));
    mkdir($directory);
    file_put_contents($directory.'/tracking.blade.php', '<script>window.example = {{ $value }};</script>');
    file_put_contents($directory.'/page.blade.php', <<<'BLADE'
        @consent($category, 'custom-tracking')
            @include('fixture::tracking')
        @endconsent
        @consent('marketing')<script>window.marketing = true;</script>@endconsent
        BLADE);
    view()->addNamespace('fixture', $directory);

    try {
        $first = view('fixture::page', ['category' => Category::Analytics, 'value' => 3])->render();
        $second = view('fixture::page', ['category' => Category::Analytics, 'value' => 5])->render();
        expect($first)->toContain('data-consent-block="custom-tracking"')->toContain('window.example = 3;')
            ->and($second)->toContain('window.example = 5;')
            ->and(substr_count($first, '<template'))->toBe(2);
    } finally {
        unlink($directory.'/tracking.blade.php');
        unlink($directory.'/page.blade.php');
        rmdir($directory);
    }
});

it('rejects invalid block identifiers and categories', function () {
    expect(fn () => (new ScriptRenderer)->open('analytics', 'bad" id'))->toThrow(InvalidArgumentException::class)
        ->and(fn () => (new ScriptRenderer)->open('analytics', 'consent-auto-1'))->toThrow(InvalidArgumentException::class)
        ->and(fn () => (new ScriptRenderer)->open('unknown'))->toThrow(ValueError::class);
});

it('keeps generated IDs in the render scope instead of leaking them between workers', function () {
    expect(app(ScriptRenderer::class)->open('analytics'))->toContain('consent-auto-1');
    expect(app(ScriptRenderer::class)->open('analytics'))->toContain('consent-auto-2');
    app()->forgetScopedInstances();
    expect(app(ScriptRenderer::class)->open('analytics'))->toContain('consent-auto-1');
});

it('renders one cache-safe runtime with CSP nonces and no visitor-specific choices', function () {
    config(['consent.services' => ['analytics' => ['category' => 'analytics', 'name' => '</script><img src=x>', 'description' => 'Measure visits.']]]);
    $html = Blade::render('<x-consent::head nonce="test-nonce" /><x-consent::head nonce="test-nonce" />');

    expect(substr_count($html, 'data-consent-runtime'))->toBe(1)
        ->and(preg_match_all('/<script[^>]*data-consent-config/', $html))->toBe(1)
        ->and($html)->toContain('nonce="test-nonce"')
        ->not->toContain('</script><img src=x>')
        ->not->toContain('"choices":')
        ->toContain('\\u003C');
});

it('can reference a published runtime asset while escaping its URL', function () {
    $html = Blade::render('<x-consent::head :src="$source" />', ['source' => '/vendor/consent/consent.js?x="&y=1']);

    expect($html)->toContain('src="/vendor/consent/consent.js?x=&quot;&amp;y=1"')
        ->not->toContain('const knownCategories');

    $paths = ServiceProvider::pathsToPublish(ConsentForLaravelServiceProvider::class, 'consent-assets');
    expect(array_map('realpath', array_keys($paths)))->toContain(dirname(__DIR__, 2).'/resources/js/consent.js');
});

it('preserves beta.1 service fingerprints until cookie cleanup rules are added', function () {
    $definition = ['id' => 'analytics', 'category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.'];
    config(['consent.services' => ['analytics' => array_diff_key($definition, ['id' => true])]]);
    $registry = app(ServiceRegistry::class);
    $expected = hash('sha256', json_encode(['analytics' => $definition], JSON_THROW_ON_ERROR));

    expect($registry->version())->toBe($expected);
    config(['consent.services.analytics.cookies' => [['prefix' => '_example_', 'domain' => '.example.test']]]);
    expect(app(ServiceRegistry::class)->version())->not->toBe($expected)
        ->and(app(BrowserRuntime::class)->configuration()['services'][0]['cookies'][0]['prefix'])->toBe('_example_');
});

it('validates cookie cleanup rules', function (mixed $definition) {
    expect(fn () => new CookieRule($definition))->toThrow(InvalidArgumentException::class);
})->with([
    [false], [[]], [['name' => '_ga', 'prefix' => '_ga_']], [['prefix' => '']], [['name' => null]],
    [['name' => '*']], [['name' => 'bad;name']], [['name' => '_example', 'path' => 'relative']],
    [['name' => '_example', 'domain' => 'https://example.test']], [['name' => '_example', 'unexpected' => true]],
]);

it('validates cookie lists even for disabled services', function () {
    config(['consent.services' => ['analytics' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.', 'enabled' => false, 'cookies' => 'invalid']]]);
    expect(fn () => app(ServiceRegistry::class))->toThrow(InvalidArgumentException::class);
});

it('validates loader timeouts', function (mixed $loader) {
    expect(fn () => new ConsentSettings(['loader' => $loader]))->toThrow(InvalidArgumentException::class);
})->with([[null], [['script_timeout_ms' => 0]], [['cleanup_timeout_ms' => '3000']], [['unknown' => true]], [['script_timeout_ms' => 120001]]]);
