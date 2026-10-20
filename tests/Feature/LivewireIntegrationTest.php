<?php

use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\File;
use Livewire\Component;
use Livewire\Livewire;

beforeEach(function () {
    config(['app.key' => 'base64:'.base64_encode(str_repeat('l', 32))]);
});

if (class_exists(Component::class)) {
    class ConsentLivewireIntegrationFixture extends Component
    {
        public string $locale = 'en';

        public function language(string $locale): void
        {
            $this->locale = $locale;
        }

        public function render(): string
        {
            app()->setLocale($this->locale);

            return <<<'BLADE'
                <div>
                    @consent('analytics', 'component-example')
                    <script>window.example = true;</script>
                    @endconsent
                    <x-consent::banner />
                </div>
                BLADE;
        }
    }
}

it('keeps actual Livewire component updates inert and replaces translated presentation', function () {
    config(['consent.services' => ['stats' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.']]]);
    Livewire::component('consent-integration-fixture', ConsentLivewireIntegrationFixture::class);
    $component = Livewire::test('consent-integration-fixture')
        ->assertSeeHtml('data-consent-block="component-example"')
        ->assertSeeHtml('lang="en"');
    preg_match('/wire:key="(consent-ui-[^"]+)"/', $component->html(), $initial);
    $component->call('language', 'pl')->assertSeeHtml('lang="pl"')->assertSeeHtml('data-consent-block="component-example"');
    preg_match('/wire:key="(consent-ui-[^"]+)"/', $component->html(), $translated);
    expect($initial[1])->not->toBe($translated[1])
        ->and($component->effects['scripts'] ?? [])->toBe([]);
})->skip(fn () => ! class_exists(Component::class), 'Installed by the dedicated Livewire compatibility job.');

it('protects actual Livewire single-file extraction before Blade compilation', function () {
    $directory = sys_get_temp_dir().'/consent-livewire-'.bin2hex(random_bytes(6));
    File::makeDirectory($directory);
    $path = $directory.'/single.blade.php';
    File::put($path, <<<'BLADE'
        <?php new class extends \Livewire\Component { public int $count = 0; }; ?>
        <div>
            @consent('analytics', 'single-'.$count)
        <script>window.gatedSingle = true;</script>
            @endconsent
        </div>
        BLADE);
    try {
        app('livewire')->addComponent('consent-single-test', viewPath: $path);
        $component = Livewire::test('consent-single-test')->assertSeeHtml('data-consent-block="single-0"')
            ->assertSeeHtml('<script>window.gatedSingle = true;</script>');
        expect(method_exists($component->instance(), 'scriptModuleSrc'))->toBeFalse();
        $component->set('count', 1)->assertSeeHtml('data-consent-block="single-1"');
        expect($component->effects['scripts'] ?? [])->toBe([]);
    } finally {
        File::deleteDirectory($directory);
    }
})->skip(fn () => ! class_exists(Component::class) || ! method_exists(app('livewire'), 'addComponent'), 'Livewire 4 single-file compiler.');

it('renders serialized script literals through actual Livewire file compilers', function (string $format, string $value, bool $navigation) {
    config(['consent.livewire.enabled' => $navigation]);
    $directory = sys_get_temp_dir().'/consent-serialized-'.bin2hex(random_bytes(6));
    File::makeDirectory($directory);
    $class = '<?php new class extends \\Livewire\\Component { public int $count = 0; }; ?>';
    $view = str_replace('__VALUE__', var_export($value, true), <<<'BLADE'
        <div>
        @consent('analytics', 'serialized-'.$count)
        <script>window.serialized = @json(__VALUE__);</script>
        @endconsent
        </div>
        BLADE);
    $expected = Blade::render('<script>window.serialized = @json('.var_export($value, true).');</script>');
    if ($format === 'single') {
        $path = $directory.'/single.blade.php';
        File::put($path, $class."\n".$view);
    } else {
        $path = $directory.'/multi';
        File::makeDirectory($path);
        File::put($path.'/multi.php', $class);
        File::put($path.'/multi.blade.php', $view);
    }

    try {
        app('livewire')->addComponent('consent-serialized-test', viewPath: $path);
        $component = Livewire::test('consent-serialized-test')
            ->assertSeeHtml('data-consent-block="serialized-0"')
            ->assertSeeHtml($expected);
        expect(method_exists($component->instance(), 'scriptModuleSrc'))->toBeFalse();
        $component->set('count', 1)->assertSeeHtml('data-consent-block="serialized-1"')->assertSeeHtml($expected);
        expect($component->effects['scripts'] ?? [])->toBe([]);
    } finally {
        File::deleteDirectory($directory);
    }
})->with(['single', 'multi'])->with([
    'script delimiters' => ['</script><script>'],
    'multiline consent names' => ["</script>\n<script>window.literal = true;</script>\n@endconsent"],
])->with([true, false])->skip(fn () => ! class_exists(Component::class) || ! method_exists(app('livewire'), 'addComponent'), 'Livewire 4 file compilers.');
