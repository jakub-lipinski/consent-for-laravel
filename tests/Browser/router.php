<?php

use ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Blade;
use Orchestra\Testbench\Foundation\Application;

$repo = dirname(__DIR__, 2);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$requestLog = getenv('CONSENT_BROWSER_LOG');
if (is_string($requestLog) && $requestLog !== '') {
    file_put_contents($requestLog, $path."\n", FILE_APPEND);
}
if (in_array($path, ['/library.js', '/module.js', '/dependency.js', '/slow.js'])) {
    header('Content-Type: text/javascript');
    if ($path === '/slow.js') {
        usleep(600000);
    }
    echo 'window.smokeOrder.push('.json_encode(trim($path, '/')).'); document.cookie = "_fixture_tracking=active; Path=/";';
    exit;
}
if ($path === '/consent.js') {
    header('Content-Type: text/javascript');
    readfile($repo.'/resources/js/consent.js');
    exit;
}
if ($path === '/favicon.ico') {
    http_response_code(204);
    exit;
}
require $repo.'/vendor/autoload.php';
$app = Application::create(options: ['extra' => ['providers' => [ConsentForLaravelServiceProvider::class]]]);
$app->make(Kernel::class)->bootstrap();
$app['config']->set('consent.cookie.name', 'consent_beta2_fixture');
$app['config']->set('consent.services', ['fixture' => ['category' => 'analytics', 'name' => 'Fixture', 'description' => 'Local test only.', 'cookies' => [['prefix' => '_fixture_']]]]);
$nonce = base64_encode(random_bytes(18));
$mode = $_GET['mode'] ?? 'classic';
$dynamic = $mode === 'blocked' ? '' : " 'strict-dynamic'";
header("Content-Security-Policy: default-src 'self'; script-src 'nonce-{$nonce}'{$dynamic}; style-src 'nonce-{$nonce}'; object-src 'none'; base-uri 'self'");
header('Cache-Control: no-store');
$external = $mode === 'module' ? '<script type="module" src="/module.js"></script>' : '<script async src="/library.js"></script>';
if ($mode === 'slow') {
    $external = '<script src="/slow.js"></script>';
}
$template = <<<'BLADE'
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Consent beta.2 runtime verification</title>
<x-consent::head :nonce="$nonce" :src="$mode === 'asset' ? '/consent.js' : null" />
<style nonce="{{ $nonce }}">body{font:17px system-ui;max-width:820px;margin:48px auto;padding:20px;color:#172039}button{font:inherit;padding:12px;margin:5px}pre{white-space:pre-wrap;padding:20px;background:#f2f5f8;border-radius:12px}a{margin-right:14px}</style>
<script nonce="{{ $nonce }}">window.smokeOrder=[]; window.smokeErrors=[]; document.addEventListener('consent:error', event=>smokeErrors.push(event.detail));</script>
</head><body><h1>Consent v1.0.0-beta.2</h1><p>Local runtime verification fixture. This is not the banner UI.</p>
<p>Scenario: {{ $mode }}. CSP uses a fresh nonce{{ $mode === 'blocked' ? ' (nonce-only)' : ' and strict-dynamic' }}.</p>
<nav><a href="/?mode=classic">Classic</a><a href="/?mode=module">Module</a><a href="/?mode=asset">Published asset</a><a href="/?mode=slow">In-flight revoke</a><a href="/?mode=cooperative">Cooperative cleanup</a><a href="/?mode=blocked">Blocked inline CSP</a></nav>
<p><button id="accept">Grant analytics</button><button id="reject">Reject optional</button><button id="forget">Forget decision</button><button id="race">Grant then revoke in flight</button></p>
<pre id="result" role="status">Starting</pre>
@consent('analytics', 'fixture-library')
{!! $external !!}
<script>window.smokeOrder.push('initialization');</script>
@endconsent
@consent('analytics', 'fixture-library')
{!! $external !!}
<script>window.smokeOrder.push('initialization');</script>
@endconsent
@if($mode === 'module')
@consent('analytics', 'inline-module')
<script type="module">import '/dependency.js'; await new Promise(resolve => setTimeout(resolve, 20)); window.smokeOrder.push('inline-module');</script>
<script>window.smokeOrder.push('after-module');</script>
@endconsent
@endif
@if($mode === 'blocked')
@consent('analytics', 'blocked-inline')
<script nonce="intentionally-invalid">window.smokeOrder.push('must-not-run-blocked');</script>
<script>window.smokeOrder.push('must-not-run-dependent');</script>
@endconsent
@endif
<script nonce="{{ $nonce }}">
const mode=@json($mode);
function render(){document.getElementById('result').textContent=JSON.stringify({allowed:Consent.allowed('analytics'),decided:Consent.state().decidedAt!==null,order:smokeOrder,trackerCookie:document.cookie.includes('_fixture_tracking='),errors:smokeErrors},null,2)}
document.getElementById('accept').onclick=async()=>{try{await Consent.choose({analytics:true});await Consent.whenIdle();render()}catch(error){document.getElementById('result').textContent=error.message}};
document.getElementById('reject').onclick=async()=>{await Consent.rejectOptional();render()};
document.getElementById('forget').onclick=async()=>{await Consent.forget();render()};
document.getElementById('race').onclick=async()=>{await Consent.acceptAll();setTimeout(()=>Consent.rejectOptional(),60)};
if(mode==='cooperative') Consent.onRevoke('analytics',()=>smokeOrder.push('cleanup'),{reload:false});
Consent.onChange(render);Consent.whenIdle().then(render);setInterval(render,200);
</script></body></html>
BLADE;
echo Blade::render($template, compact('nonce', 'mode', 'external'));
