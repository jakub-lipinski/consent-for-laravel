<?php

use ConsentForLaravel\ConsentForLaravel\BannerSettings;
use ConsentForLaravel\ConsentForLaravel\BrowserRuntime;
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use ConsentForLaravel\ConsentForLaravel\ServiceRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Env;
use Illuminate\Support\Facades\Blade;
use Symfony\Component\Yaml\Yaml;

function boostSkillPath(string $file = ''): string
{
    return dirname(__DIR__, 2).'/resources/boost/skills/consent-for-laravel-development'.($file === '' ? '' : '/'.$file);
}

/** @return list<string> */
function boostCodeExamples(string $document, string $language): array
{
    preg_match_all('/^```'.preg_quote($language, '/').'\R(.*?)^```\s*$/ms', $document, $matches);

    return $matches[1];
}

it('exposes a discoverable skill with valid frontmatter and self-contained reachable references', function () {
    $root = boostSkillPath();
    $skill = file_get_contents($root.'/SKILL.md');
    expect(preg_match('/\A---\R(.*?)\R---\R/s', $skill, $frontmatter))->toBe(1);
    $metadata = Yaml::parse($frontmatter[1]);
    expect($metadata['name'])->toBe(basename($root))->toMatch('/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/')
        ->and($metadata['description'])->toBeString()->not->toBeEmpty()
        ->and(strlen($metadata['description']))->toBeLessThanOrEqual(1024);

    $pending = [$root.'/SKILL.md'];
    $visited = [];
    while ($pending !== []) {
        $file = array_pop($pending);
        if (isset($visited[$file])) {
            continue;
        }
        $visited[$file] = true;
        $document = preg_replace('/^```.*?^```\s*$/ms', '', file_get_contents($file));
        preg_match_all('/\[[^\]]+\]\(([^)]+)\)/', $document, $links);
        foreach ($links[1] as $link) {
            if (preg_match('/\A(?:[a-z]+:|#)/i', $link)) {
                continue;
            }
            $target = realpath(dirname($file).'/'.explode('#', $link, 2)[0]);
            expect($target)->not->toBeFalse();
            expect(str_starts_with($target, $root.'/'))->toBeTrue()
                ->and(is_file($target))->toBeTrue();
            $pending[] = $target;
        }
    }

    $files = [];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $file) {
        if ($file->isFile() && $file->getExtension() === 'md') {
            $files[] = $file->getPathname();
        }
    }
    expect(array_keys($visited))->toEqualCanonicalizing($files);
});

it('renders Boost core guidance without executing the literal package Blade directive', function () {
    $source = file_get_contents(dirname(__DIR__, 2).'/resources/boost/guidelines/core.blade.php');
    $expected = trim(str_replace(['@verbatim', '@endverbatim'], '', $source));
    expect(trim(Blade::render($source)))->toBe($expected)
        ->not->toContain('data-consent-block', 'data-consent-runtime');
});

it('accepts integration configuration examples and registers their consent purposes', function (string $reference, array $services) {
    $document = file_get_contents(boostSkillPath('references/integrations/'.$reference.'.md'));
    $environment = Env::getRepository();
    $original = [];
    preg_match_all('/^([A-Z][A-Z0-9_]+)=(.+)$/m', boostCodeExamples($document, 'dotenv')[0], $variables, PREG_SET_ORDER);
    foreach ($variables as [, $key, $value]) {
        $original[$key] = $environment->get($key);
        $environment->set($key, $value);
    }

    try {
        $presets = eval('return ['.boostCodeExamples($document, 'php')[0].'];');
        config(['consent.presets' => array_replace(config('consent.presets'), $presets)]);
        $registry = app(ServiceRegistry::class);
        expect(array_keys($registry->all()))->toEqualCanonicalizing($services);
        $manager = app(ConsentManager::class);
        foreach ($registry->all() as $service) {
            expect($manager->read(Request::create('/'))->allows($service->category))->toBeFalse();
        }
        $state = $manager->acceptAll();
        $request = Request::create('/', cookies: ['consent_preferences' => json_encode($state->toArray(), JSON_THROW_ON_ERROR)]);
        foreach ($registry->all() as $service) {
            expect($manager->read($request)->allows($service->category))->toBeTrue();
        }
        expect(app(BrowserRuntime::class)->json())->toBeJson();
        $layout = boostCodeExamples(file_get_contents(boostSkillPath('SKILL.md')), 'blade')[0];
        expect(Blade::render($layout))->toContain('data-consent-runtime', 'data-consent-ui');
    } finally {
        foreach ($original as $key => $value) {
            $value === null ? $environment->clear($key) : $environment->set($key, $value);
        }
    }
})->with([
    'google' => ['google', ['google-ga4', 'google-ads']],
    'meta' => ['meta-pixel', ['meta-pixel']],
    'clarity' => ['clarity', ['microsoft-clarity']],
    'matomo' => ['matomo', ['matomo']],
    'tiktok' => ['tiktok', ['tiktok-pixel']],
]);

it('renders custom script examples inertly and accepts the documented presentation options', function () {
    $scripts = file_get_contents(boostSkillPath('references/custom-scripts.md'));
    config(['consent.services' => eval('return ['.boostCodeExamples($scripts, 'php')[0].'];')]);
    $interface = file_get_contents(boostSkillPath('references/interface.md'));
    config(['consent.ui' => eval('return ['.boostCodeExamples($interface, 'php')[0].'];')]);
    expect(app(BannerSettings::class)->colorWarnings)->toBe([]);

    $examples = boostCodeExamples($scripts, 'blade');
    $html = Blade::render($examples[0]);
    expect($html)->toContain('<template data-consent-block="site-statistics-loader" data-consent-category="analytics">', 'window.siteStatistics.start();');
    foreach (array_slice($examples, 2) as $example) {
        expect(Blade::render($example, ['cspNonce' => 'example-nonce']))->toContain('nonce="example-nonce"', 'data-consent-theme="auto"');
    }
});
