<?php

namespace ConsentForLaravel\ConsentForLaravel\Tests;

use ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider;
use Livewire\LivewireServiceProvider;
use Orchestra\Testbench\TestCase as Orchestra;

class TestCase extends Orchestra
{
    protected function getPackageProviders($app): array
    {
        return array_filter([
            class_exists(LivewireServiceProvider::class) ? LivewireServiceProvider::class : null,
            ConsentForLaravelServiceProvider::class,
        ]);
    }
}
