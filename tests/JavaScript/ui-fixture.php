<?php

use ConsentForLaravel\ConsentForLaravel\BrowserRuntime;
use ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Blade;
use Orchestra\Testbench\Foundation\Application;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = Application::create(options: ['extra' => ['providers' => [ConsentForLaravelServiceProvider::class]]]);
$app->make(Kernel::class)->bootstrap();
$input = json_decode(file_get_contents('php://stdin'), true, 512, JSON_THROW_ON_ERROR);
$app['config']->set('consent.services', $input['services'] ?? [
    'stats' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.'],
    'ads' => ['category' => 'marketing', 'name' => 'Campaigns', 'description' => 'Measure conversions.'],
]);
$app['config']->set('consent.ui', $input['ui'] ?? []);
$app->setLocale($input['locale'] ?? 'en');
echo json_encode([
    'head' => Blade::render('<x-consent::head />'),
    'banner' => Blade::render('<x-consent::banner />'),
    'config' => $app->make(BrowserRuntime::class)->configuration(),
], JSON_THROW_ON_ERROR);
