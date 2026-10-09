<?php

use ConsentForLaravel\ConsentForLaravel\AuditController;
use ConsentForLaravel\ConsentForLaravel\AuditNotice;
use ConsentForLaravel\ConsentForLaravel\AuditSettings;
use ConsentForLaravel\ConsentForLaravel\BrowserRuntime;
use ConsentForLaravel\ConsentForLaravel\Category;
use ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider;
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Illuminate\View\ViewException;

beforeEach(function () {
    config(['app.key' => 'base64:'.base64_encode(str_repeat('a', 32)), 'consent.audit.enabled' => true,
        'consent.services' => [
            'stats' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.'],
            'ads' => ['category' => 'marketing', 'name' => 'Campaigns', 'description' => 'Measure campaigns.'],
        ],
    ]);
    $this->migration = require dirname(__DIR__, 2).'/database/migrations/create_consent_audit_tables.php.stub';
    $this->migration->up();
    Route::post('/consent/decisions', AuditController::class);
});

afterEach(function () {
    $this->migration->down();
    Date::setTestNow();
});

function auditEnvelope(string $component = '<x-consent::banner />'): array
{
    $html = Blade::render($component);
    preg_match('~<script[^>]*data-consent-notice[^>]*>(.*?)</script>~s', $html, $matches);

    return json_decode($matches[1], true, 64, JSON_THROW_ON_ERROR);
}

function auditSubmission(string $action = 'save_preferences', ?array $notice = null, array $choices = []): array
{
    return ['id' => (string) Str::uuid(), 'notice' => $notice ?? auditEnvelope(), 'action' => $action, 'choices' => array_replace(Category::deniedChoices(), $choices)];
}

function auditPost(array $input, array $cookies = [])
{
    return test()->call('POST', '/consent/decisions', cookies: $cookies,
        server: ['HTTP_ORIGIN' => 'http://localhost', 'CONTENT_TYPE' => 'application/json'], content: json_encode($input, JSON_THROW_ON_ERROR));
}

it('leaves old configs and disabled auditing free of notices, writes, and audit cookies', function () {
    config(['consent.audit' => []]);
    $this->migration->down();
    expect(Blade::render('<x-consent::head /><x-consent::banner />'))->not->toContain('<script type="application/json" data-consent-notice');
    expect(app(BrowserRuntime::class)->configuration()['audit'])->toBeNull();
    app(ConsentManager::class)->read(Request::create('/'));
    auditPost(auditSubmission(notice: ['payload' => '{}', 'signature' => 'invalid']))->assertNotFound();
});

it('renders signed notices without database reads or writes or visitor-specific data', function () {
    DB::connection()->enableQueryLog();
    $first = auditEnvelope();
    $second = auditEnvelope();
    app(ConsentManager::class)->read(Request::create('/'));
    expect($first)->toBe($second)->and(DB::connection()->getQueryLog())->toBe([]);
    expect(app(AuditNotice::class)->authentic($first['payload'], $first['signature'], 'notice'))->toBeTrue();
    expect(json_decode($first['payload'], true)['html'])->toContain('data-consent-dialog', 'Measure visits.');
});

it('appends decisions and keeps a single immutable notice and signed browser identity', function () {
    Date::setTestNow('2026-10-10 12:00:00 UTC');
    $notice = auditEnvelope();
    $first = auditPost(auditSubmission('accept_all', $notice, ['analytics' => true, 'marketing' => true]))->assertCreated();
    $cookie = $first->headers->getCookies()[0];
    expect($cookie->getName())->toBe('consent_preferences_audit')->and($cookie->isHttpOnly())->toBeTrue();
    $cookies = [$cookie->getName() => $cookie->getValue()];
    Date::setTestNow('2026-10-10 12:05:00 UTC');
    auditPost(auditSubmission('save_preferences', $notice, ['analytics' => true]), $cookies)->assertCreated();
    auditPost(auditSubmission('reject_optional', $notice), $cookies)->assertCreated();
    auditPost(auditSubmission('withdraw', $notice), $cookies)->assertCreated();
    $rows = DB::table('consent_decisions')->orderBy('recorded_at')->get();
    expect($rows)->toHaveCount(4)->and($rows->pluck('consent_id')->unique())->toHaveCount(1)
        ->and($rows->pluck('notice_id')->unique())->toHaveCount(1)->and(DB::table('consent_notices')->count())->toBe(1)
        ->and($rows[0]->recorded_at)->toBe('2026-10-10 12:00:00')->and($rows->last()->expires_at)->toBeNull();
    expect(array_keys((array) $rows[0]))->toBe(['id', 'consent_id', 'notice_id', 'action', 'choices', 'recorded_at', 'expires_at']);
});

it('deduplicates retries without changing timestamps and rejects conflicting reused event IDs', function () {
    $input = auditSubmission();
    auditPost($input)->assertCreated();
    $row = DB::table('consent_decisions')->first();
    Date::setTestNow(now()->addHour());
    auditPost($input)->assertCreated();
    expect(DB::table('consent_decisions')->count())->toBe(1)->and(DB::table('consent_decisions')->first())->toEqual($row);
    $input['choices']['analytics'] = true;
    auditPost($input)->assertStatus(409);
    expect(DB::table('consent_decisions')->count())->toBe(1)->and(DB::table('consent_notices')->count())->toBe(1);
});

it('rolls back a new notice when its decision ID conflicts', function () {
    $input = auditSubmission();
    auditPost($input)->assertCreated();
    $input['notice'] = auditEnvelope('<x-consent::banner locale="pl" />');
    auditPost($input)->assertStatus(409);
    expect(DB::table('consent_notices')->count())->toBe(1);
});

it('preserves old cached text while creating new notices for overrides and language changes', function () {
    $old = auditEnvelope();
    app('translator')->addLines(['messages.banner_title' => 'My own title <safe>'], 'en', 'consent');
    app('translator')->addLines(['services.stats.description' => 'My precise purpose.'], 'en', 'consent');
    $new = auditEnvelope();
    expect($new['payload'])->not->toBe($old['payload']);
    $snapshot = json_decode($new['payload'], true);
    expect($snapshot['html'])->toContain('My own title &lt;safe&gt;', 'My precise purpose.');
    config(['consent.policy_version' => 'changed', 'consent.services' => []]);
    auditPost(auditSubmission('save_preferences', $old, ['analytics' => true]))->assertCreated();
    auditPost(auditSubmission('save_preferences', $new, ['analytics' => true]))->assertCreated();
    auditPost(auditSubmission(notice: auditEnvelope('<x-consent::banner locale="pl" />')))->assertCreated();
    expect(DB::table('consent_notices')->count())->toBe(3);
    $stored = json_decode(DB::table('consent_notices')->where('fingerprint', hash('sha256', $old['payload']))->value('snapshot'), true);
    expect($stored['policy_version'])->toBe('1')->and($stored['html'])->not->toContain('My own title');
});

it('captures regional service overrides, per-key fallback, custom languages, and component props', function () {
    app('translator')->addLines(['messages.banner_title' => 'Titel'], 'nl', 'consent');
    app('translator')->addLines(['services.stats.description' => 'Regionale beschrijving'], 'nl-BE', 'consent');
    $notice = auditEnvelope('<x-consent::banner locale="nl-BE" variant="compact" position="bottom-right" policy-url="/cookies" />');
    $snapshot = json_decode($notice['payload'], true);
    expect($snapshot['locale'])->toBe('nl')->and($snapshot['requested_locale'])->toBe('nl-BE')
        ->and($snapshot['html'])->toContain('Titel', 'Regionale beschrijving', 'Accept all', 'href="/cookies"')
        ->and($snapshot['presentation']['variant'])->toBe('compact')->and($snapshot['presentation']['position'])->toBe('bottom-right');
});

it('captures every bundled language and both variants without depending on the default app locale', function (string $locale, string $variant) {
    $notice = auditEnvelope('<x-consent::banner locale="'.$locale.'" variant="'.$variant.'" />');
    $snapshot = json_decode($notice['payload'], true);
    expect($snapshot['locale'])->toBe($locale)->and($snapshot['presentation']['variant'])->toBe($variant);
    auditPost(auditSubmission(notice: $notice))->assertCreated();
})->with(['en', 'pl', 'de', 'fr', 'it', 'es', 'pt'])->with(['standard', 'compact']);

it('supports previous signing keys for cached pages and rejects removed keys', function () {
    $old = auditEnvelope();
    $oldKey = config('app.key');
    config(['app.key' => 'base64:'.base64_encode(str_repeat('b', 32)), 'app.previous_keys' => [$oldKey]]);
    auditPost(auditSubmission(notice: $old))->assertCreated();
    config(['app.previous_keys' => []]);
    auditPost(auditSubmission(notice: $old))->assertStatus(422);
});

it('rejects modified notices without storing any rows', function (string $field) {
    $input = auditSubmission();
    $input['notice'][$field] .= 'x';
    auditPost($input)->assertStatus(422);
    expect(DB::table('consent_notices')->count())->toBe(0)->and(DB::table('consent_decisions')->count())->toBe(0);
})->with(['payload', 'signature']);

it('rejects malformed decision submissions', function (Closure $mutate) {
    $input = auditSubmission();
    $mutate($input);
    auditPost($input)->assertStatus(422);
    expect(DB::table('consent_decisions')->count())->toBe(0);
})->with([
    'bad UUID' => [fn (&$i) => $i['id'] = 'bad'],
    'extra field' => [fn (&$i) => $i['user_id'] = 1],
    'missing choice' => [fn (&$i) => $i['choices'] = ['analytics' => true]],
    'necessary denied' => [fn (&$i) => $i['choices']['necessary'] = false],
    'unused category' => [fn (&$i) => $i['choices']['other'] = true],
    'string bool' => [fn (&$i) => $i['choices']['analytics'] = 'true'],
    'unknown action' => [fn (&$i) => $i['action'] = 'dismiss'],
    'false accept all' => [fn (&$i) => $i['action'] = 'accept_all'],
    'granted refusal' => [function (&$i) {
        $i['action'] = 'reject_optional';
        $i['choices']['analytics'] = true;
    }],
]);

it('rejects cross-origin, missing-origin, sibling-domain, and non-JSON requests', function (array $headers, int $status) {
    $this->call('POST', '/consent/decisions', server: $headers, content: json_encode(auditSubmission()))->assertStatus($status);
    expect(DB::table('consent_decisions')->count())->toBe(0);
})->with([
    [['HTTP_ORIGIN' => 'https://evil.test', 'CONTENT_TYPE' => 'application/json'], 403],
    [['CONTENT_TYPE' => 'application/json'], 403],
    [['HTTP_ORIGIN' => 'http://sub.localhost', 'CONTENT_TYPE' => 'application/json'], 403],
    [['HTTP_ORIGIN' => 'http://localhost', 'HTTP_SEC_FETCH_SITE' => 'cross-site', 'CONTENT_TYPE' => 'application/json'], 403],
    [['HTTP_ORIGIN' => 'http://localhost', 'CONTENT_TYPE' => 'text/plain'], 415],
]);

it('rejects oversized requests and invalid JSON before storage', function () {
    $headers = ['HTTP_ORIGIN' => 'http://localhost', 'CONTENT_TYPE' => 'application/json'];
    $this->call('POST', '/consent/decisions', server: $headers, content: str_repeat('x', AuditNotice::MAX_REQUEST_BYTES + 1))->assertStatus(413);
    $this->call('POST', '/consent/decisions', server: $headers, content: '{')->assertStatus(422);
    $this->call('POST', '/consent/decisions', server: $headers, content: 'null')->assertStatus(422);
});

it('fails oversized notices and missing application keys before publishing invalid evidence', function () {
    expect(fn () => app(AuditNotice::class)->seal(str_repeat('x', 62000), 'en', 'en', []))->toThrow(InvalidArgumentException::class);
    config(['app.key' => '']);
    expect(fn () => auditEnvelope())->toThrow(ViewException::class);
});

it('returns a sanitized storage error with no partial notice when decision storage fails', function () {
    Schema::drop('consent_decisions');
    auditPost(auditSubmission())->assertStatus(503)->assertExactJson(['error' => 'Consent audit storage is unavailable.']);
    expect(DB::table('consent_notices')->count())->toBe(0);
});

it('does not trust a tampered identity cookie', function () {
    auditPost(auditSubmission(), ['consent_preferences_audit' => 'forged'])->assertCreated();
    expect(DB::table('consent_decisions')->first()->consent_id)->not->toBe('forged');
});

it('prunes by server receipt time while preserving notices referenced by retained decisions', function () {
    Date::setTestNow('2026-01-01 00:00:00 UTC');
    $notice = auditEnvelope();
    auditPost(auditSubmission(notice: $notice))->assertCreated();
    auditPost(auditSubmission(notice: auditEnvelope('<x-consent::banner locale="pl" />')))->assertCreated();
    Date::setTestNow('2026-10-10 00:00:00 UTC');
    auditPost(auditSubmission(notice: $notice))->assertCreated();
    $this->artisan('consent:audit-prune')->assertSuccessful();
    expect(DB::table('consent_decisions')->count())->toBe(1)->and(DB::table('consent_notices')->count())->toBe(1);
    config(['consent.audit.retention_days' => null]);
    Date::setTestNow('2028-01-01 00:00:00 UTC');
    $this->artisan('consent:audit-prune')->assertSuccessful();
    expect(DB::table('consent_decisions')->count())->toBe(1);
});

it('publishes the optional migration and supports custom database tables', function () {
    $paths = ServiceProvider::pathsToPublish(ConsentForLaravelServiceProvider::class, 'consent-audit-migrations');
    expect($paths)->toHaveCount(1)->and(array_key_first($paths))->toContain('create_consent_audit_tables.php.stub');
    $this->migration->down();
    config(['consent.audit.decisions_table' => 'site_decisions', 'consent.audit.notices_table' => 'site_notices']);
    $this->migration->up();
    auditPost(auditSubmission())->assertCreated();
    expect(DB::table('site_decisions')->count())->toBe(1)->and(DB::table('site_notices')->count())->toBe(1);
});

it('validates audit config instead of silently coercing unsafe values', function (array $config) {
    expect(fn () => new AuditSettings($config))->toThrow(InvalidArgumentException::class);
})->with([
    [['enabled' => 'true']], [['path' => '//evil.test']], [['path' => '/a?b']], [['path' => '/a/']],
    [['notices_table' => 'foo.bar']], [['decisions_table' => 'consent_notices']], [['connection' => false]],
    [['timeout_ms' => 0]], [['retention_days' => 0]], [['unknown' => true]],
]);

it('captures direct wording edits inside an application-owned published view', function () {
    $path = sys_get_temp_dir().'/consent-audit-view-'.bin2hex(random_bytes(8));
    app('files')->ensureDirectoryExists($path.'/components');
    $source = file_get_contents(dirname(__DIR__, 2).'/resources/views/components/banner.blade.php');
    file_put_contents($path.'/components/banner.blade.php', str_replace('{{ $'."ui->text('banner_description', $".'language) }}', 'Our own literal disclosure.', $source));
    app('view')->prependNamespace('consent', $path);
    $this->beforeApplicationDestroyed(fn () => app('files')->deleteDirectory($path));
    $notice = auditEnvelope();
    expect(json_decode($notice['payload'], true)['html'])->toContain('Our own literal disclosure.');
    auditPost(auditSubmission(notice: $notice))->assertCreated();
    expect(DB::table('consent_notices')->value('snapshot'))->toContain('Our own literal disclosure.');
});

it('cleans up output capture even when translation rendering throws', function () {
    app('translator')->addLines(['messages.banner_description' => ['invalid']], 'en', 'consent');
    $level = ob_get_level();
    expect(fn () => auditEnvelope())->toThrow(ViewException::class);
    expect(ob_get_level())->toBe($level);
});

it('accepts reordered envelope fields and choice keys without creating duplicate notices', function () {
    $input = auditSubmission();
    $input['notice'] = array_reverse($input['notice'], true);
    $input['choices'] = array_reverse($input['choices'], true);
    auditPost($input)->assertCreated();
    auditPost($input)->assertCreated();
    expect(DB::table('consent_decisions')->count())->toBe(1)->and(DB::table('consent_notices')->count())->toBe(1);
});

it('rejects event ID reuse from a different signed browser history', function () {
    $input = auditSubmission();
    auditPost($input)->assertCreated();
    $id = (string) Str::uuid();
    $cookie = $id.'.'.app(AuditNotice::class)->sign($id, 'identity');
    auditPost($input, ['consent_preferences_audit' => $cookie])->assertStatus(409);
    expect(DB::table('consent_decisions')->count())->toBe(1);
});

it('preserves server time in UTC and lifetime from the original cached notice', function () {
    config(['app.timezone' => 'Europe/Warsaw']);
    Date::setTestNow('2026-10-10 14:00:00 Europe/Warsaw');
    $notice = auditEnvelope();
    config(['consent.retention_days' => 1]);
    auditPost(auditSubmission(notice: $notice))->assertCreated();
    $row = DB::table('consent_decisions')->first();
    expect($row->recorded_at)->toBe('2026-10-10 12:00:00')
        ->and($row->expires_at)->toBe('2027-04-08 12:00:00');
});

it('protects the audit cookie from cleanup rules and session-name collisions', function () {
    expect(app(BrowserRuntime::class)->configuration()['protectedCookies'])->toContain('consent_preferences_audit');
    expect(fn () => new AuditSettings(['enabled' => true], 'consent_preferences', 'consent_preferences_audit'))->toThrow(InvalidArgumentException::class);
});

it('registers an enabled custom route and can cache it', function () {
    config(['consent.audit.path' => '/privacy/record']);
    app()->getProvider(ConsentForLaravelServiceProvider::class)->packageBooted();
    $this->call('POST', '/privacy/record', server: ['HTTP_ORIGIN' => 'http://localhost', 'CONTENT_TYPE' => 'application/json'], content: json_encode(auditSubmission()))->assertCreated();
    expect(app(BrowserRuntime::class)->configuration()['audit']['path'])->toBe('/privacy/record');
    try {
        $this->artisan('route:cache')->assertSuccessful();
    } finally {
        $this->artisan('route:clear')->assertSuccessful();
    }
});
