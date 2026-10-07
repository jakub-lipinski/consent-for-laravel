<?php

namespace ConsentForLaravel\ConsentForLaravel\Tests;

use ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider;
use Orchestra\Testbench\TestCase as Orchestra;

class TestCase extends Orchestra
{
    protected function getPackageProviders($app): array
    {
        return [ConsentForLaravelServiceProvider::class];
    }
}
