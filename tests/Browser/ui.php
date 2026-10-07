<?php

use ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Blade;
use Orchestra\Testbench\Foundation\Application;

$repo = dirname(__DIR__, 2);
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$log = getenv('CONSENT_BROWSER_LOG');
if (is_string($log) && $log !== '') {
    file_put_contents($log, $path."\n", FILE_APPEND);
}
$assets = [
    '/assets/consent.js' => ['/resources/js/consent.js', 'text/javascript'],
    '/assets/banner.js' => ['/resources/js/banner.js', 'text/javascript'],
    '/assets/consent.css' => ['/resources/css/consent.css', 'text/css'],
    '/axe.js' => ['/node_modules/axe-core/axe.min.js', 'text/javascript'],
];
if (isset($assets[$path])) {
    header('Content-Type: '.$assets[$path][1]);
    readfile($repo.$assets[$path][0]);
    exit;
}
if ($path === '/tracker.js') {
    header('Content-Type: text/javascript');
    echo 'window.mockEvents=0; document.cookie="_fixture_tracking=active; Path=/"; setInterval(()=>window.mockEvents++,200);';
    exit;
}
if ($path === '/favicon.ico') {
    http_response_code(204);
    exit;
}
require $repo.'/vendor/autoload.php';
$app = Application::create(options: ['extra' => ['providers' => [ConsentForLaravelServiceProvider::class]]]);
$app->make(Kernel::class)->bootstrap();
$position = $_GET['position'] ?? 'bottom-left';
$locale = $_GET['locale'] ?? 'pl';
$published = isset($_GET['assets']);
$stress = isset($_GET['stress']);
$zoom = isset($_GET['zoom']);
$services = [
    'stats' => ['category' => 'analytics', 'name' => 'Site statistics', 'description' => 'Measure visits and navigation in this local example.', 'cookies' => [['prefix' => '_fixture_']]],
    'campaigns' => ['category' => 'marketing', 'name' => 'Campaign measurement', 'description' => 'Measure advertising conversions in this local example.'],
];
if (isset($_GET['all'])) {
    $services['speed'] = ['category' => 'performance', 'name' => 'Performance measurement', 'description' => 'Measure page load speed.'];
    $services['extra'] = ['category' => 'other', 'name' => 'Additional functionality', 'description' => 'A separately explained optional purpose.'];
}
if (isset($_GET['empty'])) {
    $services = [];
}
$app['config']->set('consent.services', $services);
$app['config']->set('consent.cookie.name', 'consent_beta3_fixture');
$app['config']->set('consent.ui', ['position' => $position, 'locale' => $locale, 'policy_url' => '/policy']);
$app['translator']->addLines([
    'services.stats.name' => 'Statystyki strony', 'services.stats.description' => 'Pomiar odwiedzin i sposobu korzystania ze strony w tym przykładzie.',
    'services.campaigns.name' => 'Pomiar kampanii', 'services.campaigns.description' => 'Pomiar efektów kampanii reklamowych w tym przykładzie.',
], 'pl', 'consent');
$nonce = base64_encode(random_bytes(18));
header("Content-Security-Policy: default-src 'self'; script-src 'nonce-{$nonce}' 'strict-dynamic'; style-src 'self' 'nonce-{$nonce}'; object-src 'none'; base-uri 'self'");
header('Cache-Control: no-store');
$html = <<<'BLADE'
<!doctype html><html lang="en" @class(['zoom' => $zoom])><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Consent for Laravel - UI verification</title>
<x-consent::head :nonce="$nonce" :src="$published ? '/assets/consent.js' : null" />
<style nonce="{{ $nonce }}">
body{margin:0;background:#f5f7f4;color:#243a2f;font:1rem/1.65 system-ui}main{max-width:68rem;margin:auto;padding:3rem clamp(12px,4vw,32px) 20rem}header{display:flex;flex-wrap:wrap;align-items:center;gap:1rem;border-bottom:1px solid #cad4cb;padding-bottom:1rem}header strong{margin-right:auto;overflow-wrap:anywhere}a{color:#245c49;text-underline-offset:.2em}nav{display:flex;gap:1.5rem;flex-wrap:wrap}h1{font-size:clamp(2rem,4vw,3.5rem);line-height:1.15;max-width:42rem;margin:4rem 0 1.5rem}p{max-width:42rem}button{min-height:44px;padding:.6rem 1rem;font:inherit;color:#243a2f;border:1px solid #62776a;background:white;border-radius:8px;cursor:pointer;max-width:100%;overflow-wrap:anywhere}button:focus-visible,a:focus-visible{outline:3px solid #245c49;outline-offset:3px}.fixture-tools{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:2rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem;border:1px solid #cad4cb;border-radius:12px;padding:1rem;max-width:42rem}.stress .consent-ui p,.stress .consent-ui span,.stress .consent-ui button,.stress .consent-ui label{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}.stress .consent-ui p{margin-bottom:2em!important}.zoom{font-size:200%}
</style>
</head><body @class(['stress' => $stress])><main><header><strong>Consent for Laravel</strong><a href="/">Home</a><button data-consent-open type="button">Cookie preferences</button></header>
<div class="fixture-tools"><button id="reset" type="button">Reset test choice</button><button id="audit-banner" type="button">Audit current page</button><button id="audit-modal" type="button">Audit preferences</button><button id="spacing" type="button">Text spacing stress</button><button id="zoom" type="button">Text size 200%</button><button id="storage" type="button">Simulate blocked cookies</button></div>
<h1>A little more control.<br>A little more privacy.</h1><p>A local website example for testing the package's cookie interface. No real analytics or advertising providers are loaded.</p>
<nav aria-label="Preview options"><a href="/?position=bottom-left&locale={{ $locale }}">Bottom left</a><a href="/?position=bottom-right&locale={{ $locale }}">Bottom right</a><a href="/?position=bottom-center&locale={{ $locale }}">Bottom center</a><a href="/?position={{ $position }}&locale=en">English</a><a href="/?position={{ $position }}&locale=pl">Polski</a></nav>

<pre id="audit-result">Accessibility audit not started.</pre><pre id="runtime-result">Runtime ready.</pre>
<p><a href="/policy">Example cookie policy</a></p>
</main>
<x-consent::banner :nonce="$nonce" :style-src="$published ? '/assets/consent.css' : null" :script-src="$published ? '/assets/banner.js' : null" />
@consent('analytics', 'fixture-statistics')<script src="/tracker.js"></script>@endconsent
@consent('marketing', 'fixture-campaigns')<script>window.mockMarketing=true;</script>@endconsent
<script nonce="{{ $nonce }}">
let auditLibrary;
async function audit(modal){if(modal)Consent.openPreferences();if(!auditLibrary)auditLibrary=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/axe.js';script.nonce=@json($nonce);script.onload=resolve;script.onerror=reject;document.head.appendChild(script)});await auditLibrary;const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});document.getElementById('audit-result').textContent=JSON.stringify({violations:result.violations.map(item=>({id:item.id,targets:item.nodes.map(node=>node.target)})),incomplete:result.incomplete.map(item=>({id:item.id,nodes:item.nodes.map(node=>({target:node.target,summary:node.failureSummary}))})),passes:result.passes.length},null,2)}
document.getElementById('audit-banner').onclick=()=>audit(false);
document.getElementById('audit-modal').onclick=()=>audit(true);
document.getElementById('reset').onclick=()=>Consent.forget();
document.getElementById('spacing').onclick=()=>document.body.classList.toggle('stress');
document.getElementById('zoom').onclick=()=>document.documentElement.classList.toggle('zoom');
document.getElementById('storage').onclick=()=>Object.defineProperty(document,'cookie',{get:()=>'',set:()=>{},configurable:true});
setInterval(()=>{document.getElementById('runtime-result').textContent=JSON.stringify({analyticsAllowed:Consent.allowed('analytics'),marketingAllowed:Consent.allowed('marketing'),hasDecision:Consent.state().decidedAt!==null,trackerCookie:document.cookie.includes('_fixture_tracking='),mockEvents:window.mockEvents??0},null,2)},300);
</script></body></html>
BLADE;
echo Blade::render($html, compact('nonce', 'position', 'locale', 'published', 'stress', 'zoom'));
