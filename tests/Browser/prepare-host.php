<?php

// Generate a disposable host OUTSIDE the package checkout. No host is shipped in the library.
$package = dirname(__DIR__, 2);
$host = realpath($argv[1] ?? '');
if ($host === false || str_starts_with($host.'/', $package.'/') || ! is_file($host.'/artisan')) {
    throw new RuntimeException('Pass an existing disposable Laravel application outside this checkout.');
}
$write = function (string $path, string $contents) use ($host): void {
    if (! is_dir(dirname($host.'/'.$path))) {
        mkdir(dirname($host.'/'.$path), 0777, true);
    }
    file_put_contents($host.'/'.$path, $contents);
};
$write('config/consent.php', '<?php return array_replace_recursive(require '.var_export($package.'/config/consent.php', true).', '.var_export([
    'audit' => ['enabled' => true],
    'loader' => ['script_timeout_ms' => 1500],
    'services' => [
        'stats' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.', 'cookies' => [['name' => '_fixture']]],
        'ads' => ['category' => 'marketing', 'name' => 'Campaigns', 'description' => 'Measure conversions.'],
    ],
    'ui' => ['policy_url' => '/en/privacy'],
], true).');');
$write('config/livewire.php', "<?php return ['csp_safe' => true, 'navigate' => ['show_progress_bar' => (int) \\Composer\\InstalledVersions::getVersion('livewire/livewire') === 3]];");
$write('app/Http/Middleware/FixtureCsp.php', <<<'PHP'
<?php
namespace App\Http\Middleware;
use Closure;
use Illuminate\Support\Facades\Vite;
class FixtureCsp {
    public function handle($request, Closure $next) {
        $nonce = $request->boolean('nonce') || str_contains($request->headers->get('Referer', ''), 'nonce=1');
        if ($nonce) Vite::useCspNonce(bin2hex(random_bytes(16)));
        $response = $next($request);
        if ($nonce) {
            $major = (int) \Composer\InstalledVersions::getVersion('livewire/livewire');
            // Livewire's DOMParser can report nonce style violations before adoption.
            // Authorize only the exact static styles, without enabling unsafe-inline.
            preg_match_all('~<style[^>]*>(.*?)</style>~s', $response->getContent(), $styles);
            $hashes = implode('', array_map(fn ($css) => " 'sha256-".base64_encode(hash('sha256', $css, true))."'", $styles[1]));
            $policy = "default-src 'self'; script-src 'self' 'nonce-".Vite::cspNonce()."'".($major === 3 ? " 'unsafe-eval'" : '')."; style-src 'self' 'nonce-".Vite::cspNonce()."'".$hashes."; img-src 'self' data:; connect-src 'self'; base-uri 'self'";
            $response->headers->set('Content-Security-Policy', $policy);
        }
        return $response;
    }
}
PHP);
$bootstrap = file_get_contents($host.'/bootstrap/app.php');
if (! str_contains($bootstrap, 'FixtureCsp::class')) {
    $bootstrap = str_replace('->withMiddleware(function (Middleware $middleware): void {', '->withMiddleware(function (Middleware $middleware): void { $middleware->append(\App\Http\Middleware\FixtureCsp::class);', $bootstrap);
    $write('bootstrap/app.php', $bootstrap);
}
$write('app/Livewire/Fixture.php', <<<'PHP'
<?php
namespace App\Livewire;
class Fixture extends \Livewire\Component {
    public string $locale = 'en';
    public int $counter = 0;
    public bool $inlineBanner = false;
    public function mount(string $locale, bool $inlineBanner = false) { $this->locale = $locale; $this->inlineBanner = $inlineBanner; }
    public function language(string $locale) { $this->locale = $locale; }
    public function render() { app()->setLocale($this->locale); return view('livewire.fixture'); }
}
PHP);
$write('resources/views/livewire/fixture.blade.php', <<<'BLADE'
<div>
    <button id="update" wire:click="$set('counter', {{ $counter + 1 }})">Update component</button>
    @foreach(['en', 'pl', 'cs', 'nl'] as $lang)
    <button id="component-{{ $lang }}" wire:click="language('{{ $lang }}')">{{ $lang }} component</button>
    @endforeach
    <output id="counter">{{ $counter }}</output>
    @consent('analytics', 'component-'.$counter)
    <script>window.fixtureComponents = (window.fixtureComponents || 0) + 1;</script>
    @endconsent
    @if($inlineBanner)<x-consent::banner />@endif
</div>
BLADE);
$write('resources/views/components/single-check.blade.php', <<<'BLADE'
<?php new class extends \Livewire\Component { public int $counter = 0; }; ?>
<div>
    <button id="single-update" wire:click="$set('counter', {{ $counter + 1 }})">Single update</button>
    @consent('analytics', 'single-'.$counter)
<script>window.fixtureSingle = (window.fixtureSingle || 0) + 1;</script>
    @endconsent
</div>
BLADE);
$write('resources/views/fixture.blade.php', <<<'BLADE'
<!doctype html><html lang="{{ $locale }}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="csrf-token" content="{{ csrf_token() }}">
<title>{{ $locale }} {{ $page }}</title>
<x-consent::head :nonce="Illuminate\Support\Facades\Vite::cspNonce()" :src="request()->boolean('assets') ? '/vendor/consent/consent.js' : null" />
@livewireStyles(['nonce' => Illuminate\Support\Facades\Vite::cspNonce()])
<script nonce="{{ Illuminate\Support\Facades\Vite::cspNonce() }}" data-navigate-once>
window.fixtureDocument = window.fixtureDocument || Math.random(); window.fixtureVisits = window.fixtureVisits || [];
document.addEventListener('consent:navigated', e => window.fixtureVisits.push(e.detail));
document.addEventListener('securitypolicyviolation', e => { (window.fixtureCsp ||= []).push({ directive: e.effectiveDirective, blocked: e.blockedURI }); });
</script>
</head><body>
<main><h1 id="page-title">{{ $locale }} {{ $page }}</h1><nav>
@foreach(['en', 'pl', 'de', 'fr', 'it', 'es', 'pt', 'cs', 'nl'] as $lang)
<a id="language-{{ $lang }}" href="/{{ $lang }}/{{ $page }}{{ request()->getQueryString() ? '?'.request()->getQueryString() : '' }}" wire:navigate>{{ $lang }}</a>
@endforeach
@foreach(['a', 'b', 'c'] as $next)
<a id="page-{{ $next }}" href="/{{ $locale }}/{{ $next }}{{ request()->getQueryString() ? '?'.request()->getQueryString() : '' }}" wire:navigate>{{ $next }}</a>
@endforeach
</nav><button id="outside" data-consent-open>Cookie preferences</button>
<livewire:fixture :locale="$locale" :inline-banner="request()->boolean('component')" />
@if($page === 'single' && method_exists(app('livewire'), 'addComponent'))<livewire:single-check />@endif
@consent('analytics', 'site-sdk')
<script src="/fixture/sdk.js"></script><script>window.fixtureInitialized = (window.fixtureInitialized || 0) + 1;</script>
@endconsent
@consent('analytics', 'page-'.$page)
<script>window.fixturePages = (window.fixturePages || []).concat(@json($page));</script>
@endconsent
@if($page === 'modules')
@consent('analytics', 'module-order')
<script type="module" src="/fixture/module.js"></script><script>window.fixtureModuleTail = window.fixtureModuleDone;</script>
@endconsent
@endif
@if($page === 'blocked')
@consent('analytics', 'blocked-inline')
<script nonce="intentionally-invalid">window.fixtureBlocked = true;</script><script>window.fixtureBlockedTail = true;</script>
@endconsent
@endif
</main>
@if(!request()->boolean('component'))
@if(request()->boolean('persist'))
@persist('consent-fixture')
<div><x-consent::banner :nonce="Illuminate\Support\Facades\Vite::cspNonce()" :style-src="request()->boolean('assets') ? '/vendor/consent/consent.css' : null" :script-src="request()->boolean('assets') ? '/vendor/consent/banner.js' : null" /></div>
@endpersist
@else
<x-consent::banner :nonce="Illuminate\Support\Facades\Vite::cspNonce()" :style-src="request()->boolean('assets') ? '/vendor/consent/consent.css' : null" :script-src="request()->boolean('assets') ? '/vendor/consent/banner.js' : null" />
@endif
@endif
@livewireScripts(['nonce' => Illuminate\Support\Facades\Vite::cspNonce()])
</body></html>
BLADE);
$write('routes/web.php', <<<'PHP'
<?php
use Illuminate\Support\Facades\Route;
Route::get('/fixture/log', fn () => response()->json(is_file(storage_path('fixture-requests.log')) ? file(storage_path('fixture-requests.log'), FILE_IGNORE_NEW_LINES) : []));
Route::get('/fixture/sdk.js', function () {
    file_put_contents(storage_path('fixture-requests.log'), "sdk\n", FILE_APPEND | LOCK_EX);
    return response('window.fixtureSdkLoads = (window.fixtureSdkLoads || 0) + 1; document.cookie="_fixture=1; Path=/";', 200, ['Content-Type' => 'application/javascript']);
});
Route::get('/fixture/import.js', fn () => response('export const value = 42;', 200, ['Content-Type' => 'application/javascript']));
Route::get('/fixture/module.js', fn () => response('import { value } from "/fixture/import.js"; await new Promise(r => setTimeout(r, 40)); window.fixtureModuleDone = value;', 200, ['Content-Type' => 'application/javascript']));
Route::get('/{locale}/{page?}', function (string $locale, string $page = 'a') {
    abort_unless(in_array($locale, ['en', 'pl', 'de', 'fr', 'it', 'es', 'pt', 'cs', 'nl']), 404);
    app()->setLocale($locale);
    config(['consent.ui.variant' => request('variant', 'standard'), 'consent.ui.position' => request('position', 'bottom-left'), 'consent.ui.theme' => request('theme', 'light')]);
    if (request()->boolean('tiktok')) {
        config(['consent.presets.tiktok_pixel.enabled' => true, 'consent.presets.tiktok_pixel.pixel_id' => 'C1234567890ABCDEFGHI']);
    }
    if ($page === 'context') config(['consent.policy_version' => '2']);
    return view('fixture', compact('locale', 'page'));
});
PHP);
foreach (['js/consent.js', 'js/banner.js', 'css/consent.css'] as $file) {
    $write('public/vendor/consent/'.basename($file), file_get_contents($package.'/resources/'.$file));
}
$write('database/migrations/2026_10_10_000000_create_consent_audit_tables.php', file_get_contents($package.'/database/migrations/create_consent_audit_tables.php.stub'));
echo "Prepared disposable host: {$host}\n";
