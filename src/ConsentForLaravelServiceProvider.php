<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\Contracts\Config\Repository;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Spatie\LaravelPackageTools\Package;
use Spatie\LaravelPackageTools\PackageServiceProvider;

class ConsentForLaravelServiceProvider extends PackageServiceProvider
{
    public function configurePackage(Package $package): void
    {
        $package
            ->name('consent')
            ->hasConfigFile()
            ->hasViews()
            ->hasTranslations();
    }

    public function packageRegistered(): void
    {
        $this->app->bind(ConsentSettings::class, fn (Application $app): ConsentSettings => new ConsentSettings(
            $app->make(Repository::class)->get('consent'),
            $app->make(Repository::class)->get('session.cookie'),
        ));

        $this->app->bind(ServiceRegistry::class, fn (Application $app): ServiceRegistry => new ServiceRegistry($app->make(Repository::class)->get('consent.services', [])));
    }

    public function packageBooted(): void
    {
        // Only the preferences cookie is readable by the browser. It contains no identity or authentication data.
        EncryptCookies::except($this->app->make(ConsentSettings::class)->cookieName);
    }
}
