<?php

namespace ConsentForLaravel\ConsentForLaravel;

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
}
