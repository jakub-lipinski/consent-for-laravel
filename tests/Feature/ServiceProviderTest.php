<?php

use ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider;
use Illuminate\Support\ServiceProvider;

it('boots the package in a Laravel application without publishing resources', function () {
    expect($this->app->getProvider(ConsentForLaravelServiceProvider::class))
        ->toBeInstanceOf(ConsentForLaravelServiceProvider::class)
        ->and(config('consent'))->toBeArray();
});

it('allows the host application to override package configuration', function () {
    config()->set('consent', ['application_option' => 'preserved']);

    $this->app->register(ConsentForLaravelServiceProvider::class, true);

    expect(config('consent.application_option'))->toBe('preserved');
});

it('publishes configuration through the consent-config tag', function () {
    $source = dirname(__DIR__, 2).'/config/consent.php';

    $paths = ServiceProvider::pathsToPublish(ConsentForLaravelServiceProvider::class, 'consent-config');

    expect(array_map('realpath', array_keys($paths)))->toContain($source)
        ->and(array_values($paths))->toContain(config_path('consent.php'));

    $this->artisan('vendor:publish', ['--tag' => 'consent-config', '--force' => true])
        ->assertExitCode(0);

    try {
        expect(require config_path('consent.php'))->toBe(require $source);
    } finally {
        unlink(config_path('consent.php'));
    }
});

it('registers namespaced views and their publish tag', function () {
    $source = dirname(__DIR__, 2).'/resources/views';
    $hints = $this->app['view']->getFinder()->getHints()['consent'];
    $paths = ServiceProvider::pathsToPublish(ConsentForLaravelServiceProvider::class, 'consent-views');

    expect(array_map('realpath', $hints))->toContain($source)
        ->and(array_map('realpath', array_keys($paths)))->toContain($source)
        ->and(array_values($paths))->toContain(resource_path('views/vendor/consent'));
});

it('registers namespaced translations and their publish tag', function () {
    $source = dirname(__DIR__, 2).'/resources/lang';

    $namespaces = $this->app['translator']->getLoader()->namespaces();
    $paths = ServiceProvider::pathsToPublish(ConsentForLaravelServiceProvider::class, 'consent-translations');

    expect(realpath($namespaces['consent']))->toBe($source)
        ->and(array_map('realpath', array_keys($paths)))->toContain($source)
        ->and(array_values($paths))->toContain(lang_path('vendor/consent'));
});

it('can cache the application configuration', function () {
    $path = $this->app->getCachedConfigPath();

    try {
        $this->artisan('config:cache')->assertExitCode(0);

        expect((require $path)['consent'])->toBe(require dirname(__DIR__, 2).'/config/consent.php');
    } finally {
        $this->artisan('config:clear')->assertExitCode(0);
    }
});
