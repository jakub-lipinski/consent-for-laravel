<?php

use ConsentForLaravel\ConsentForLaravel\BannerSettings;
use ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider;
use ConsentForLaravel\ConsentForLaravel\ConsentSettings;
use ConsentForLaravel\ConsentForLaravel\ServiceRegistry;
use Illuminate\Cookie\Middleware\EncryptCookies;

it('validates consent settings', function (mixed $configuration) {
    expect(fn () => new ConsentSettings($configuration, 'custom_session'))->toThrow(InvalidArgumentException::class);
})->with([
    'scalar config' => [false],
    'numeric policy' => [['policy_version' => 1]],
    'empty policy' => [['policy_version' => ' ']],
    'null policy' => [['policy_version' => null]],
    'long policy' => [['policy_version' => str_repeat('a', 129)]],
    'non UTF-8 policy' => [['policy_version' => "\xff"]],
    'zero days' => [['retention_days' => 0]],
    'negative days' => [['retention_days' => -1]],
    'string days' => [['retention_days' => '180']],
    'fractional days' => [['retention_days' => 1.5]],
    'null days' => [['retention_days' => null]],
    'excessive retention' => [['retention_days' => 366]],
    'scalar cookie' => [['cookie' => false]],
    'null cookie' => [['cookie' => null]],
    'unknown cookie option' => [['cookie' => ['http_only' => true]]],
    'empty cookie name' => [['cookie' => ['name' => '']]],
    'null cookie name' => [['cookie' => ['name' => null]]],
    'invalid cookie name' => [['cookie' => ['name' => 'bad;name']]],
    'session collision' => [['cookie' => ['name' => 'custom_session']]],
    'default session collision' => [['cookie' => ['name' => 'laravel_session']]],
    'remember-me collision' => [['cookie' => ['name' => 'remember_web_'.sha1('auth-guard')]]],
    'CSRF collision' => [['cookie' => ['name' => 'XSRF-TOKEN']]],
    'relative path' => [['cookie' => ['path' => 'shop']]],
    'unsafe path' => [['cookie' => ['path' => "/shop\r\n"]]],
    'null path' => [['cookie' => ['path' => null]]],
    'invalid domain' => [['cookie' => ['domain' => 'https://example.test']]],
    'invalid domain labels' => [['cookie' => ['domain' => 'example..test']]],
    'empty domain' => [['cookie' => ['domain' => '']]],
    'invalid secure flag' => [['cookie' => ['secure' => 'true']]],
    'invalid same site' => [['cookie' => ['same_site' => 'none']]],
    'null same site' => [['cookie' => ['same_site' => null]]],
]);

it('supports partial cookie configuration and valid domain scopes', function () {
    $settings = new ConsentSettings(['cookie' => ['domain' => '.example.test']]);

    expect($settings->policyVersion)->toBe('1')
        ->and($settings->retentionDays)->toBe(180)
        ->and($settings->cookieName)->toBe('consent_preferences')
        ->and($settings->cookiePath)->toBe('/')
        ->and($settings->cookieDomain)->toBe('.example.test')
        ->and($settings->cookieSecure)->toBeNull()
        ->and($settings->cookieSameSite)->toBe('lax');
});

it('rejects invalid service definitions', function (mixed $services) {
    expect(fn () => new ServiceRegistry($services))->toThrow(InvalidArgumentException::class);
})->with([
    'scalar registry' => [false],
    'numeric ID' => [[['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.']]],
    'invalid ID' => [['bad id' => []]],
    'scalar definition' => [['statistics' => false]],
    'missing category' => [['statistics' => ['name' => 'Statistics', 'description' => 'Measure visits.']]],
    'unknown category' => [['statistics' => ['category' => 'functional', 'name' => 'Statistics', 'description' => 'Measure visits.']]],
    'missing name' => [['statistics' => ['category' => 'analytics', 'description' => 'Measure visits.']]],
    'empty name' => [['statistics' => ['category' => 'analytics', 'name' => ' ', 'description' => 'Measure visits.']]],
    'missing purpose' => [['statistics' => ['category' => 'analytics', 'name' => 'Statistics']]],
    'empty other purpose' => [['statistics' => ['category' => 'other', 'name' => 'Statistics', 'description' => ' ']]],
    'non UTF-8 name' => [['statistics' => ['category' => 'analytics', 'name' => "\xff", 'description' => 'Measure visits.']]],
    'non UTF-8 purpose' => [['statistics' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => "\xff"]]],
    'truthy enabled' => [['statistics' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.', 'enabled' => 'true']]],
    'null enabled' => [['statistics' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.', 'enabled' => null]]],
    'unknown option' => [['statistics' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.', 'script' => 'tracking.js']]],
]);

it('validates disabled service metadata too', function () {
    expect(fn () => new ServiceRegistry(['disabled' => ['enabled' => false]]))->toThrow(InvalidArgumentException::class);
});

it('normalizes metadata without changing the service version', function () {
    $first = new ServiceRegistry(['statistics' => ['category' => 'analytics', 'name' => ' Statistics ', 'description' => ' Measure visits. ']]);
    $second = new ServiceRegistry(['statistics' => ['description' => 'Measure visits.', 'name' => 'Statistics', 'category' => 'analytics', 'enabled' => true]]);

    expect($first->version())->toBe($second->version())
        ->and($first->get('statistics')->name)->toBe('Statistics');
});

it('rejects an unknown or disabled service lookup', function () {
    expect(fn () => (new ServiceRegistry([]))->get('missing'))->toThrow(InvalidArgumentException::class);
});

it('exempts only the configured consent cookie during provider boot', function () {
    config(['consent.cookie.name' => 'custom_consent', 'app.key' => 'base64:'.base64_encode(str_repeat('a', 32))]);
    $this->app->register(ConsentForLaravelServiceProvider::class, true);
    $middleware = app(EncryptCookies::class);

    expect($middleware->isDisabled('custom_consent'))->toBeTrue()
        ->and($middleware->isDisabled(config('session.cookie')))->toBeFalse()
        ->and($middleware->isDisabled('ordinary_private_cookie'))->toBeFalse();
});

it('caches custom service and cookie configuration without closures or objects', function () {
    $configuration = require dirname(__DIR__, 2).'/config/consent.php';
    $configuration['policy_version'] = 'policy-2';
    $configuration['cookie']['name'] = 'cached_consent';
    $configuration['ui']['variant'] = 'compact';
    $configuration['ui']['locale'] = 'nl_BE';
    $configuration['ui']['validate_contrast'] = true;
    $configuration['ui']['colors'] = ['accent' => '#d86a32'];
    $configuration['ui']['theme'] = 'auto';
    $configuration['ui']['dark_colors'] = ['accent' => '#a5e4c4'];
    $configuration['services'] = ['statistics' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.']];
    $configPath = config_path('consent.php');
    $cachePath = $this->app->getCachedConfigPath();
    file_put_contents($configPath, '<?php return '.var_export($configuration, true).';');

    try {
        $this->artisan('config:cache')->assertExitCode(0);
        $cached = (require $cachePath)['consent'];

        expect($cached)->toBe($configuration)
            ->and((new ConsentSettings($cached))->cookieName)->toBe('cached_consent')
            ->and((new BannerSettings($cached['ui']))->variant)->toBe('compact')
            ->and((new BannerSettings($cached['ui']))->locale)->toBe('nl-BE')
            ->and((new BannerSettings($cached['ui']))->validateContrast)->toBeTrue()
            ->and((new BannerSettings($cached['ui']))->colors['accent'])->toBe('#d86a32')
            ->and((new BannerSettings($cached['ui']))->theme)->toBe('auto')
            ->and((new BannerSettings($cached['ui']))->darkColors['accent'])->toBe('#a5e4c4')
            ->and((new ServiceRegistry($cached['services']))->get('statistics')->category->value)->toBe('analytics');
    } finally {
        $this->artisan('config:clear')->assertExitCode(0);
        unlink($configPath);
    }
});
