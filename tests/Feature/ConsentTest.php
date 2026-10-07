<?php

use ConsentForLaravel\ConsentForLaravel\Category;
use ConsentForLaravel\ConsentForLaravel\ConsentCodec;
use ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider;
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use ConsentForLaravel\ConsentForLaravel\ServiceRegistry;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    $this->travelTo(Date::parse('2026-10-07 12:00:00 UTC'));

    config(['consent.services' => [
        'site-analytics' => ['category' => 'analytics', 'name' => 'Site analytics', 'description' => 'Measure visits.'],
        'advertising' => ['category' => 'marketing', 'name' => 'Advertising', 'description' => 'Measure campaign conversions.'],
        'disabled-performance' => ['category' => 'performance', 'name' => 'Speed metrics', 'description' => 'Measure page speed.', 'enabled' => false],
    ]]);
});

function consentRequest(mixed $cookie = null): Request
{
    return Request::create('https://example.test/', 'GET', cookies: $cookie === null ? [] : ['consent_preferences' => $cookie]);
}

it('resolves the core and exposes only enabled services and used categories', function () {
    $registry = app(ServiceRegistry::class);

    expect(app(ConsentManager::class))->toBeInstanceOf(ConsentManager::class)
        ->and(array_keys($registry->all()))->toBe(['advertising', 'site-analytics'])
        ->and($registry->categories())->toBe([Category::Necessary, Category::Analytics, Category::Marketing])
        ->and($registry->get('site-analytics')->description)->toBe('Measure visits.')
        ->and(array_keys($registry->forCategory('analytics')))->toBe(['site-analytics'])
        ->and($registry->uses('performance'))->toBeFalse();
});

it('starts denied and never stores a decision on read', function () {
    $manager = app(ConsentManager::class);
    $request = consentRequest();
    $state = $manager->read($request);

    expect($state->hasDecision())->toBeFalse()
        ->and($state->decidedAt)->toBeNull()
        ->and($state->expiresAt)->toBeNull()
        ->and($state->choices)->toBe(Category::deniedChoices())
        ->and($state->allows('necessary'))->toBeTrue()
        ->and($state->allows('analytics'))->toBeFalse()
        ->and($manager->needsConsent($request))->toBeTrue()
        ->and(app('cookie')->getQueuedCookies())->toBe([]);
});

it('does not request optional consent when only necessary services exist', function () {
    config(['consent.services' => ['session' => ['category' => 'necessary', 'name' => 'Session', 'description' => 'Keep the session active.']]]);

    expect(app(ServiceRegistry::class)->categories())->toBe([Category::Necessary])
        ->and(app(ConsentManager::class)->needsConsent(consentRequest()))->toBeFalse();
});

it('accepts only used categories and remembers explicit rejection', function () {
    $manager = app(ConsentManager::class);
    $accepted = $manager->acceptAll();
    $rejected = $manager->rejectOptional();
    $codec = app(ConsentCodec::class);

    expect($accepted->choices)->toBe(['necessary' => true, 'analytics' => true, 'marketing' => true, 'performance' => false, 'other' => false])
        ->and($rejected->choices)->toBe(Category::deniedChoices())
        ->and($accepted->expiresAt)->toBe($rejected->expiresAt)
        ->and($accepted->expiresAt - $accepted->decidedAt)->toBe(180 * 86400)
        ->and($manager->read(consentRequest($codec->encode($rejected)))->hasDecision())->toBeTrue()
        ->and($manager->needsConsent(consentRequest($codec->encode($rejected))))->toBeFalse();
});

it('replaces a previous selection instead of retaining omitted grants', function () {
    $manager = app(ConsentManager::class);
    $manager->acceptAll();
    $selected = $manager->choose(['analytics' => true]);

    expect($selected->allows(Category::Analytics))->toBeTrue()
        ->and($selected->allows(Category::Marketing))->toBeFalse()
        ->and($selected->choices['necessary'])->toBeTrue();
});

it('does not retain preferences between requests on the same manager', function () {
    $manager = app(ConsentManager::class);
    $value = app(ConsentCodec::class)->encode($manager->acceptAll());

    expect($manager->read(consentRequest($value))->allows('analytics'))->toBeTrue()
        ->and($manager->read(consentRequest())->allows('analytics'))->toBeFalse();
});

it('rejects invalid choices instead of coercing them', function (array $choices) {
    expect(fn () => app(ConsentManager::class)->choose($choices))->toThrow(InvalidArgumentException::class);
})->with([
    'unknown category' => [['functional' => true]],
    'numeric key' => [[0 => true]],
    'necessary denied' => [['necessary' => false]],
    'unused grant' => [['performance' => true]],
    'string true' => [['analytics' => 'true']],
    'string false' => [['analytics' => 'false']],
    'integer' => [['analytics' => 1]],
    'null' => [['analytics' => null]],
]);

it('keeps decisions until the exact expiry and does not extend them on read', function () {
    config(['consent.retention_days' => 2]);
    $manager = app(ConsentManager::class);
    $state = $manager->choose(['analytics' => true]);
    $value = app(ConsentCodec::class)->encode($state);

    $this->travel(2 * 86400 - 1)->seconds();

    expect($manager->read(consentRequest($value))->allows('analytics'))->toBeTrue()
        ->and($manager->read(consentRequest($value))->expiresAt)->toBe($state->expiresAt);

    $this->travel(1)->seconds();

    expect($manager->read(consentRequest($value))->hasDecision())->toBeFalse()
        ->and($manager->needsConsent(consentRequest($value)))->toBeTrue()
        ->and($state->allows('analytics'))->toBeFalse();
});

it('invalidates decisions when the policy or retention limit changes', function (string $key, mixed $replacement) {
    $manager = app(ConsentManager::class);
    $value = app(ConsentCodec::class)->encode($manager->acceptAll());
    config([$key => $replacement]);

    expect(app(ConsentManager::class)->read(consentRequest($value))->choices)->toBe(Category::deniedChoices())
        ->and(app(ConsentManager::class)->needsConsent(consentRequest($value)))->toBeTrue();
})->with([
    'policy' => ['consent.policy_version', '2'],
    'shorter retention' => ['consent.retention_days', 30],
]);

it('invalidates decisions when enabled services or their purposes change', function (string $change) {
    $manager = app(ConsentManager::class);
    $value = app(ConsentCodec::class)->encode($manager->acceptAll());

    if ($change === 'addition') {
        config(['consent.services.extra' => ['category' => 'analytics', 'name' => 'Extra measurement', 'description' => 'Measure another purpose.']]);
    } elseif ($change === 'removal') {
        config(['consent.services.advertising.enabled' => false]);
    } elseif ($change === 'enable') {
        config(['consent.services.disabled-performance.enabled' => true]);
    } elseif ($change === 'category') {
        config(['consent.services.site-analytics.category' => 'other']);
    } else {
        config(['consent.services.site-analytics.description' => 'Measure a changed purpose.']);
    }

    expect(app(ConsentManager::class)->read(consentRequest($value))->hasDecision())->toBeFalse()
        ->and(app(ConsentManager::class)->read(consentRequest($value))->allows('analytics'))->toBeFalse();
})->with(['addition', 'removal', 'enable', 'category', 'purpose']);

it('does not invalidate decisions for service ordering or disabled metadata', function () {
    $manager = app(ConsentManager::class);
    $value = app(ConsentCodec::class)->encode($manager->acceptAll());
    $services = array_reverse(config('consent.services'), true);
    $services['disabled-performance']['description'] = 'Updated disabled purpose.';
    config(['consent.services' => $services]);

    expect(app(ConsentManager::class)->read(consentRequest($value))->allows('analytics'))->toBeTrue();
});

it('fails closed for malformed stored values', function (mixed $value) {
    $state = app(ConsentManager::class)->read(consentRequest($value));

    expect($state->hasDecision())->toBeFalse()
        ->and($state->choices)->toBe(Category::deniedChoices());
})->with([
    'empty' => [''],
    'broken JSON' => ['{'],
    'list' => ['[]'],
    'JSON null' => ['null'],
    'scalar' => ['true'],
    'oversized' => [str_repeat('x', 3073)],
    'invalid UTF-8' => ["\xff"],
    'array cookie' => [['analytics' => true]],
    'integer cookie' => [123],
]);

it('fails closed for corrupted decision fields', function (string $field, mixed $replacement) {
    $data = app(ConsentManager::class)->acceptAll()->toArray();
    data_set($data, $field, $replacement);
    $state = app(ConsentManager::class)->read(consentRequest(json_encode($data, JSON_THROW_ON_ERROR)));

    expect($state->hasDecision())->toBeFalse()
        ->and($state->allows('analytics'))->toBeFalse();
})->with([
    'schema' => ['schemaVersion', 2],
    'schema type' => ['schemaVersion', '1'],
    'policy' => ['policyVersion', 'other'],
    'services' => ['servicesVersion', 'other'],
    'future decision' => ['decidedAt', 9999999999],
    'decision zero' => ['decidedAt', 0],
    'decision string' => ['decidedAt', '1791374400'],
    'expiry past' => ['expiresAt', 1],
    'expiry extension' => ['expiresAt', 9999999999],
    'expiry type' => ['expiresAt', '9999999999'],
    'necessary denied' => ['choices.necessary', false],
    'truthy grant' => ['choices.analytics', 'true'],
    'unused grant' => ['choices.other', true],
    'unknown choice' => ['choices.unknown', true],
    'unexpected field' => ['unexpected', true],
]);

it('rejects incomplete decisions', function (string $field) {
    $data = app(ConsentManager::class)->acceptAll()->toArray();
    data_forget($data, $field);

    expect(app(ConsentManager::class)->read(consentRequest(json_encode($data, JSON_THROW_ON_ERROR)))->hasDecision())->toBeFalse();
})->with(['decidedAt', 'choices.analytics']);

it('persists and deletes cookies with the same configured scope', function () {
    config(['consent.cookie' => ['name' => 'custom_consent', 'path' => '/shop', 'domain' => '.example.test', 'secure' => true, 'same_site' => 'strict']]);
    $manager = app(ConsentManager::class);
    $decision = $manager->choose(['analytics' => true]);
    $request = Request::create('https://example.test/shop');
    $response = response()->json(['saved' => true])->setPublic()->setMaxAge(3600);

    expect($manager->persist($decision, $response, $request))->toBe($response);
    $cookie = $response->headers->getCookies()[0];

    expect($cookie->getName())->toBe('custom_consent')
        ->and($response->headers->hasCacheControlDirective('private'))->toBeTrue()
        ->and($response->headers->hasCacheControlDirective('no-store'))->toBeTrue()
        ->and($response->headers->hasCacheControlDirective('public'))->toBeFalse()
        ->and($cookie->getPath())->toBe('/shop')
        ->and($cookie->getDomain())->toBe('.example.test')
        ->and($cookie->isSecure())->toBeTrue()
        ->and($cookie->isHttpOnly())->toBeFalse()
        ->and($cookie->getSameSite())->toBe('strict')
        ->and($cookie->getExpiresTime())->toBe($decision->expiresAt)
        ->and(app(ConsentCodec::class)->decode($cookie->getValue())->allows('analytics'))->toBeTrue();

    $deleted = $manager->forget(response()->noContent(), $request)->headers->getCookies()[0];

    expect($deleted->getName())->toBe($cookie->getName())
        ->and($deleted->getPath())->toBe($cookie->getPath())
        ->and($deleted->getDomain())->toBe($cookie->getDomain())
        ->and($deleted->getSameSite())->toBe($cookie->getSameSite())
        ->and($deleted->isSecure())->toBe($cookie->isSecure())
        ->and($deleted->getExpiresTime())->toBeLessThan(time());
});

it('follows HTTPS unless the cookie secure setting is explicit', function (string $url, ?bool $setting, bool $expected) {
    config(['consent.cookie.secure' => $setting]);
    $manager = app(ConsentManager::class);
    $cookie = $manager->persist($manager->rejectOptional(), response()->noContent(), Request::create($url))->headers->getCookies()[0];

    expect($cookie->isSecure())->toBe($expected);
})->with([
    ['https://example.test/', null, true],
    ['http://example.test/', null, false],
    ['http://example.test/', true, true],
    ['https://example.test/', false, false],
]);

it('refuses to persist a pending, outdated, or expired decision', function (string $kind) {
    $manager = app(ConsentManager::class);
    $state = $kind === 'pending' ? $manager->read(consentRequest()) : $manager->acceptAll();

    if ($kind === 'outdated') {
        config(['consent.policy_version' => '2']);
        $manager = app(ConsentManager::class);
    } elseif ($kind === 'expired') {
        $this->travel(180)->days();
    }

    expect(fn () => $manager->persist($state, response()->noContent(), consentRequest()))->toThrow(InvalidArgumentException::class);
})->with(['pending', 'outdated', 'expired']);

it('round trips through the web middleware without exempting session cookies', function () {
    config(['app.key' => 'base64:'.base64_encode(str_repeat('a', 32))]);
    $this->app->register(ConsentForLaravelServiceProvider::class, true);
    Route::middleware('web')->post('/consent-test', function (Request $request, ConsentManager $manager) {
        return $manager->persist($manager->choose(['analytics' => true]), response()->json(['saved' => true]), $request)
            ->cookie('ordinary_private_cookie', 'private');
    });
    Route::middleware('web')->get('/consent-test', fn (Request $request, ConsentManager $manager) => response()->json($manager->read($request)));

    $response = $this->postJson('/consent-test')->assertOk();
    $cookie = collect($response->headers->getCookies())->first(fn ($cookie) => $cookie->getName() === 'consent_preferences');
    $ordinary = collect($response->headers->getCookies())->first(fn ($cookie) => $cookie->getName() === 'ordinary_private_cookie');

    expect(json_decode($cookie->getValue(), true, flags: JSON_THROW_ON_ERROR)['choices']['analytics'])->toBeTrue()
        ->and($ordinary->getValue())->not->toBe('private')
        ->and(app(EncryptCookies::class)->isDisabled(config('session.cookie')))->toBeFalse();

    $this->withUnencryptedCookie('consent_preferences', $cookie->getValue())
        ->withCredentials()
        ->getJson('/consent-test')
        ->assertOk()
        ->assertJsonPath('choices.analytics', true)
        ->assertJsonPath('choices.marketing', false);

    $this->withUnencryptedCookie('consent_preferences', '')
        ->getJson('/consent-test')->assertOk()->assertJsonPath('choices.analytics', false);
});
