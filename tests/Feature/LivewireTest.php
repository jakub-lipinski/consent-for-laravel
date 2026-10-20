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

it('preserves server expressions containing script delimiters and consent names', function (string $body) {
    Blade::directive('serializeConsentFixture', fn (string $expression): string => '<?php echo json_encode('.$expression.', JSON_HEX_TAG); ?>');
    $source = "<div>\n@consent('analytics', 'serialized-html')\n<script>".$body."</script>\n<script>window.following = true;</script>\n@endconsent\n</div>";
    $expected = Blade::render($source);
    $prepared = app(LivewireBladePrecompiler::class)($source);

    expect(Blade::render($prepared))->toBe($expected)
        ->and($prepared)->not->toMatch('/(?:^|\n)<script\b/');
})->with([
    'json opening delimiter' => [<<<'BLADE'
        const value = @json('</script><script>');
        BLADE],
    'json quoted consent name' => [<<<'BLADE'
        const value = @json('</script> @endconsent');
        BLADE],
    'json double quotes and parentheses' => [<<<'BLADE'
        const value = @json("</script><script> ) @consent('analytics')");
        BLADE],
    'json multiline script literal' => [<<<'BLADE'
        const value = @json('
        </script>
        <script>window.literal = true;</script>
        @endconsent');
        BLADE],
    'js expression' => [<<<'BLADE'
        const value = @js('</script><script> @endconsent');
        BLADE],
    'js nested arguments' => [<<<'BLADE'
        const value = @js(str_replace(')', '', '</script><script>)'));
        BLADE],
    'short PHP echo' => [<<<'BLADE'
        const value = <?= json_encode('</script><script> @endconsent', JSON_HEX_TAG) ?>;
        BLADE],
    'PHP block and comment' => [<<<'BLADE'
        <?php /* </script><script> @endconsent */ $value = '</script><script> @endconsent'; ?> const value = @json($value);
        BLADE],
    'PHP nowdoc' => [<<<'BLADE'
        <?php $value = <<<'HTML'
        </script><script> @endconsent
        HTML;
        echo json_encode($value, JSON_HEX_TAG); ?>
        BLADE],
    'escaped echo' => [<<<'BLADE'
        const value = "{{ '</script><script> @endconsent' }}";
        BLADE],
    'raw echo' => [<<<'BLADE'
        const value = {!! json_encode('</script><script> @endconsent', JSON_HEX_TAG) !!};
        BLADE],
    'inline PHP directive' => [<<<'BLADE'
        @php($value = '</script><script> @endconsent') const value = @json($value);
        BLADE],
    'block PHP directive' => [<<<'BLADE'
        @php $value = '</script><script> @endconsent'; @endphp const value = @json($value);
        BLADE],
    'Blade comment' => [<<<'BLADE'
        {{-- </script><script> @endconsent @script --}} const value = @json('safe');
        BLADE],
    'PHP comment inside arguments' => [<<<'BLADE'
        const value = @json(/* </script><script> @endconsent */ '<script>');
        BLADE],
    'conditional arguments' => [<<<'BLADE'
        @if (str_contains('</script><script> @endconsent', 'script')) const value = @json('safe'); @endif
        BLADE],
    'custom directive arguments' => [<<<'BLADE'
        const value = @serializeConsentFixture('</script><script> @endconsent');
        BLADE],
    'escaped directive' => [<<<'BLADE'
        /* @@json('<script> @endconsent') */ const value = @json('safe');
        BLADE],
    'verbatim text' => [<<<'BLADE'
        /* @verbatim @json('<script> @endconsent') @endverbatim */ const value = @json('safe');
        BLADE],
]);

it('leaves unrelated source unchanged when consent names are only server-side data', function () {
    $source = <<<'BLADE'
        <div>
        @json('</script><script> @consent @endconsent')
        <script>const value = @js('</script><script> @consent @endconsent');</script>
        @verbatim @consent('literal') @endverbatim
        </div>
        BLADE;

    expect(app(LivewireBladePrecompiler::class)($source))->toBe($source);
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
