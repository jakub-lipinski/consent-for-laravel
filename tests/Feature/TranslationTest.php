<?php

use ConsentForLaravel\ConsentForLaravel\BannerSettings;
use ConsentForLaravel\ConsentForLaravel\BannerView;
use ConsentForLaravel\ConsentForLaravel\ConsentCodec;
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use ConsentForLaravel\ConsentForLaravel\ServiceRegistry;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Blade;
use Illuminate\View\ViewException;

beforeEach(function () {
    $path = sys_get_temp_dir().'/consent-translations-'.bin2hex(random_bytes(8));
    app('files')->ensureDirectoryExists($path);
    app()->useLangPath($path);
    app('translation.loader')->addPath($path);
    $this->beforeApplicationDestroyed(fn () => app('files')->deleteDirectory($path));
});

function writeConsentTranslation(string $locale, string $group, array $lines): void
{
    $path = lang_path('vendor/consent/'.$locale);
    app('files')->ensureDirectoryExists($path);
    file_put_contents($path.'/'.$group.'.php', '<?php return '.var_export($lines, true).';');
}

it('ships complete nonempty UTF-8 dictionaries for every bundled language', function (string $locale) {
    $english = Arr::dot(require dirname(__DIR__, 2).'/resources/lang/en/messages.php');
    $messages = Arr::dot(require dirname(__DIR__, 2).'/resources/lang/'.$locale.'/messages.php');
    expect(array_keys($messages))->toBe(array_keys($english));
    foreach ($messages as $message) {
        expect($message)->toBeString()->not->toBe('');
        expect(mb_check_encoding($message, 'UTF-8'))->toBeTrue();
    }
})->with(['en', 'pl', 'de', 'fr', 'it', 'es', 'pt']);

it('renders every bundled language and preset purpose in both variants', function (string $locale, string $variant) {
    app()->setLocale($locale);
    config(['consent.ui.variant' => $variant, 'consent.google.mode' => 'advanced', 'consent.presets' => [
        'ga4' => ['enabled' => true, 'measurement_id' => 'G-ABCD1234'],
        'google_ads' => ['enabled' => true, 'conversion_id' => 'AW-123456789'],
        'meta_pixel' => ['enabled' => true, 'pixel_id' => '123456789012345'],
        'clarity' => ['enabled' => true, 'project_id' => 'abc123def4', 'advertising' => true],
    ]]);
    $messages = require dirname(__DIR__, 2).'/resources/lang/'.$locale.'/messages.php';
    $html = Blade::render('<x-consent::banner />');
    expect($html)->toContain('lang="'.$locale.'"', 'data-consent-variant="'.$variant.'"', e($messages['accept_all']), e($messages['google_advanced']))
        ->not->toContain('consent::messages.', 'consent::services.');
    foreach ($messages['presets'] as $preset) {
        expect($html)->toContain(e($preset['name']), e($preset['description']));
    }
})->with(['en', 'pl', 'de', 'fr', 'it', 'es', 'pt'])->with(['standard', 'compact']);

it('selects the base language for regional app locales without regional dictionaries', function (string $locale, string $language) {
    app()->setLocale($locale);
    expect(Blade::render('<x-consent::banner />'))->toContain('lang="'.$language.'"');
})->with([
    ['pl_PL', 'pl'], ['pl-PL', 'pl'], ['DE_de', 'de'], ['fr_CA', 'fr'], ['it-IT', 'it'], ['es_MX', 'es'], ['pt_PT', 'pt'], ['pt-BR', 'pt'],
]);

it('loads custom published dictionaries and service translations without a language allowlist', function (string $variant) {
    writeConsentTranslation('nl', 'messages', ['banner_title' => 'Uw privacy telt', 'accept_all' => 'Alles accepteren']);
    writeConsentTranslation('nl', 'services', ['site-analytics' => ['name' => 'Statistieken', 'description' => 'Bezoeken meten.']]);
    config(['consent.services' => ['site-analytics' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.']], 'consent.ui.variant' => $variant]);
    app()->setLocale('nl_NL');
    $html = Blade::render('<x-consent::banner />');
    expect($html)->toContain('lang="nl"', 'Uw privacy telt', 'Alles accepteren', 'Statistieken', 'Bezoeken meten.', 'Reject optional', 'Save preferences')
        ->not->toContain('consent::messages.');
})->with(['standard', 'compact']);

it('respects component then configured then application locale without changing the application', function () {
    writeConsentTranslation('nl', 'messages', ['accept_all' => 'Alles accepteren']);
    app()->setLocale('fr');
    config(['consent.ui.locale' => 'de']);
    expect(Blade::render('<x-consent::banner />'))->toContain('lang="de"', 'Alle akzeptieren');
    expect(Blade::render('<x-consent::banner locale="nl" />'))->toContain('lang="nl"', 'Alles accepteren');
    expect(app()->getLocale())->toBe('fr');
    config(['consent.ui.locale' => 'nl']);
    expect(Blade::render('<x-consent::banner />'))->toContain('lang="nl"', 'Alles accepteren');
    config(['consent.ui.locale' => null]);
    expect(Blade::render('<x-consent::banner />'))->toContain('lang="fr"', 'Tout accepter');
});

it('uses regional translations before base and English per key independently of the app fallback', function (string $directory, string $selection) {
    writeConsentTranslation($directory, 'messages', ['accept_all' => 'Accepter tous les témoins']);
    writeConsentTranslation($directory, 'services', ['site-analytics' => ['name' => 'Statistiques canadiennes']]);
    writeConsentTranslation('fr', 'messages', ['customize' => 'Préférences françaises']);
    writeConsentTranslation('fr', 'services', ['site-analytics' => ['description' => 'Mesurer les visites.']]);
    app('translator')->setFallback('pl');
    config(['consent.ui.locale' => $selection, 'consent.services' => ['site-analytics' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.']]]);
    $html = Blade::render('<x-consent::banner />');
    expect($html)->toContain('lang="fr-CA"', 'Accepter tous les témoins', 'Préférences françaises', 'Statistiques canadiennes', 'Mesurer les visites.');
    $ui = app(BannerView::class);
    expect($ui->text('reject_optional', 'nl'))->toBe('Reject optional');
})->with([['fr-CA', 'fr_CA'], ['fr_CA', 'FR-ca']]);

it('falls back through script-specific dictionaries before the base language', function () {
    writeConsentTranslation('zh_Hant', 'messages', ['banner_title' => '繁體中文標題']);
    writeConsentTranslation('zh', 'messages', ['accept_all' => '接受全部']);
    config(['consent.ui.locale' => 'zh-Hant-TW']);
    expect(Blade::render('<x-consent::banner />'))->toContain('lang="zh-Hant"', '繁體中文標題', '接受全部', 'Save preferences');
});

it('loads regional service translations even when UI messages fall back to the base language', function () {
    writeConsentTranslation('fr_CA', 'services', ['site-analytics' => ['description' => 'Mesurer les visites au Canada.']]);
    config(['consent.ui.locale' => 'fr-CA', 'consent.services' => ['site-analytics' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.']]]);
    expect(Blade::render('<x-consent::banner />'))->toContain('lang="fr"', 'Tout accepter', 'Mesurer les visites au Canada.');
});

it('prefers hyphen keys and inherits remaining underscore keys when both directories exist', function () {
    writeConsentTranslation('fr-CA', 'messages', ['accept_all' => 'Hyphen choice']);
    writeConsentTranslation('fr_CA', 'messages', ['accept_all' => 'Underscore choice', 'customize' => 'Underscore preferences']);
    expect(Blade::render('<x-consent::banner locale="fr_CA" />'))->toContain('lang="fr-CA"', 'Hyphen choice', 'Underscore preferences')
        ->not->toContain('Underscore choice');
});

it('uses English and an English language attribute when no UI dictionary exists', function () {
    writeConsentTranslation('nl', 'services', ['site-analytics' => ['name' => 'Statistieken']]);
    app()->setLocale('nl');
    app('translator')->setFallback('pl');
    expect(Blade::render('<x-consent::banner />'))->toContain('lang="en"', 'Accept all', 'Reject optional');
    expect(Blade::render('<x-consent::banner locale="nl-BE" />'))->toContain('lang="en"', 'Accept all');
});

it('uses English for missing or blank custom keys and preserves escaped text', function () {
    writeConsentTranslation('nl', 'messages', ['banner_title' => '<img src=x onerror=alert(1)>', 'accept_all' => '', 'save' => '   ']);
    $html = Blade::render('<x-consent::banner locale="nl" />');
    expect($html)->toContain('lang="nl"', '&lt;img', 'Accept all', 'Save preferences')->not->toContain('<img src=x');
});

it('preserves canonical custom preset descriptions in new and custom locales', function (string $locale) {
    writeConsentTranslation('nl', 'messages', ['accept_all' => 'Alles accepteren']);
    config(['consent.ui.locale' => $locale, 'consent.presets.clarity' => ['enabled' => true, 'project_id' => 'abc123def4', 'description' => 'Our precise recording purpose.']]);
    expect(Blade::render('<x-consent::banner />'))->toContain('Our precise recording purpose.');
})->with(['de', 'fr', 'it', 'es', 'pt', 'nl']);

it('preserves the decision fingerprint and lifetime across language and wording changes', function (bool $allowed) {
    config(['consent.services' => ['site-analytics' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.']]]);
    $version = app(ServiceRegistry::class)->version();
    $decision = app(ConsentManager::class)->choose(['analytics' => $allowed]);
    $cookie = app(ConsentCodec::class)->encode($decision);
    writeConsentTranslation('nl', 'messages', ['accept_all' => 'Alles accepteren']);
    writeConsentTranslation('nl', 'services', ['site-analytics' => ['description' => 'Bezoeken meten.']]);
    foreach (['de', 'fr-CA', 'it', 'es', 'pt', 'nl'] as $locale) {
        config(['consent.ui.locale' => $locale]);
        Blade::render('<x-consent::banner />');
        $restored = app(ConsentManager::class)->read(Request::create('https://example.test/', cookies: ['consent_preferences' => $cookie]));
        expect(app(ServiceRegistry::class)->version())->toBe($version)
            ->and($restored->hasDecision())->toBeTrue()
            ->and($restored->allows('analytics'))->toBe($allowed)
            ->and($restored->decidedAt)->toBe($decision->decidedAt)
            ->and($restored->expiresAt)->toBe($decision->expiresAt);
    }
})->with([true, false]);

it('rejects malformed or unsafe explicit language tags before loading translations', function (mixed $locale) {
    expect(fn () => new BannerSettings(['locale' => $locale]))->toThrow(InvalidArgumentException::class);
})->with([[''], [' fr'], ['fr '], ['../fr'], ['fr/CA'], ['fr\\CA'], ['fr..CA'], ['fr--CA'], ['fr@CA'], ['fr" onmouseover="x'], [true], [1], [[]], [str_repeat('a', 86)]]);

it('rejects unsafe component locales and malformed translation values', function () {
    expect(fn () => Blade::render('<x-consent::banner locale="../fr" />'))->toThrow(ViewException::class, 'Consent UI locale must be a language tag');
    writeConsentTranslation('nl', 'messages', ['accept_all' => ['invalid']]);
    expect(fn () => Blade::render('<x-consent::banner locale="nl" />'))->toThrow(ViewException::class, 'must be a string');
});
