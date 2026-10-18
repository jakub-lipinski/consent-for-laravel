<?php

use ConsentForLaravel\ConsentForLaravel\BrowserRuntime;
use ConsentForLaravel\ConsentForLaravel\LivewireBladePrecompiler;
use ConsentForLaravel\ConsentForLaravel\LivewireSettings;
use ConsentForLaravel\ConsentForLaravel\ServiceRegistry;
use Illuminate\Support\Facades\Blade;

it('defaults to optional Livewire support with cacheable strict settings', function () {
    $settings = new LivewireSettings;
    expect($settings->enabled)->toBeTrue()->and($settings->navigation)->toBe('auto');
    $data = require dirname(__DIR__, 2).'/config/consent.php';
    $cached = eval('return '.var_export($data, true).';');
    expect((new LivewireSettings($cached['livewire']))->navigation)->toBe('auto');
    config(['consent.livewire' => ['enabled' => false, 'navigation' => 'reload']]);
    expect(app(BrowserRuntime::class)->configuration()['livewire'])->toMatchArray(['enabled' => false, 'navigation' => 'reload'])
        ->and(Blade::render('<x-consent::banner />'))->not->toContain('wire:ignore');
});

it('rejects invalid Livewire settings', function (mixed $value) {
    expect(fn () => new LivewireSettings($value))->toThrow(InvalidArgumentException::class);
})->with([[null], [['enabled' => 'true']], [['navigation' => 'spa']], [['unknown' => true]]]);

it('keeps runtime context independent of locale nonce and decisions', function () {
    $runtime = app(BrowserRuntime::class);
    $context = $runtime->context();
    $services = app(ServiceRegistry::class)->version();
    app()->setLocale('pl');
    expect(app(BrowserRuntime::class)->locale())->toBe('pl')
        ->and(app(BrowserRuntime::class)->context())->toBe($context);
    $html = Blade::render('<x-consent::head nonce="one" /><x-consent::head nonce="two" />');
    expect(substr_count($html, 'name="consent-runtime-context"'))->toBe(1)
        ->and($html)->toContain($context, 'data-consent-locale="pl"')->not->toContain('"choices":');
    config(['consent.livewire.navigation' => 'reload']);
    expect(app(BrowserRuntime::class)->context())->not->toBe($context)
        ->and(app(ServiceRegistry::class)->version())->toBe($services);
});

it('keys the protected interface by translated presentation and pairs its audit notice', function () {
    config(['consent.audit.enabled' => true, 'app.key' => 'base64:'.base64_encode(str_repeat('a', 32))]);
    $en = Blade::render('<x-consent::banner />');
    app()->setLocale('pl');
    $pl = Blade::render('<x-consent::banner />');
    preg_match('/wire:key="([^"]+)"/', $en, $enKey);
    preg_match('/wire:key="([^"]+)"/', $pl, $plKey);
    expect($enKey[1])->not->toBe($plKey[1]);
    $dom = new DOMDocument;
    @$dom->loadHTML($pl);
    $xpath = new DOMXPath($dom);
    expect($xpath->query('//*[@data-consent-container and @*[name()="wire:ignore"]]')->length)->toBe(1)
        ->and($xpath->query('//*[@data-consent-container]//*[@data-consent-ui]')->length)->toBe(1)
        ->and($xpath->query('//*[@data-consent-container]//script[@data-consent-notice]')->length)->toBe(1);
});

it('protects unindented single-file scripts without changing rendered markup', function () {
    $source = <<<'BLADE'
        <div>
        @consent('analytics', 'single-file')
        <script src="/test.js"></script>
        <script>window.text = @json('hello'); const marker = '@endconsent';</script>
        @endconsent
        </div>
        BLADE;
    $precompiler = new LivewireBladePrecompiler;
    $protected = $precompiler($source);
    expect($protected)->not->toMatch('/(?:^|\n)<script\b/')
        ->and(Blade::render($protected))->toBe(Blade::render($source));
});

it('skips PHP Blade comments escaped directives and literal verbatim text', function () {
    $source = <<<'BLADE'
        <?php $example = '@consent("x")'; ?>
        {{-- @consent('example') --}}
        @php $example = '@endconsent'; @endphp
        @verbatim @consent('example') @endverbatim
        @@consent('example')
        @consent('analytics', str_replace(')', '', 'id)'))
        @php($value = '<script>')
        <script>const value = {!! json_encode('<script>') !!};</script>
        @endconsent
        BLADE;
    expect(Blade::render((new LivewireBladePrecompiler)($source)))->toBe(Blade::render($source));
});

it('preserves inline PHP and quoted directives within gated scripts', function () {
    $source = <<<'BLADE'
        @consent('analytics', 'php-script')
        <script><?php $value = '@endphp <script>'; ?> const value = @json($value);</script>
        <script>@php($value = '<script>') const other = @json($value);</script>
        @endconsent
        BLADE;
    expect(Blade::render((new LivewireBladePrecompiler)($source)))->toBe(Blade::render($source));
});

it('rejects Livewire execution transports nested with consent', function (string $source) {
    expect(fn () => (new LivewireBladePrecompiler)($source))->toThrow(InvalidArgumentException::class);
})->with([
    '@consent("analytics") @script <script>bad()</script> @endscript @endconsent',
    '@consent("analytics") @assets <script src="/bad.js"></script> @endassets @endconsent',
    '@script @consent("analytics") <script>bad()</script> @endconsent @endscript',
    '@assets @consent("analytics") <script src="/bad.js"></script> @endconsent @endassets',
    '@consent("analytics") <script>bad()</script>',
]);
