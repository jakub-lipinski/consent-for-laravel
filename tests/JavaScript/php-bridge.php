<?php

use ConsentForLaravel\ConsentForLaravel\BrowserRuntime;
use ConsentForLaravel\ConsentForLaravel\ConsentForLaravelServiceProvider;
use ConsentForLaravel\ConsentForLaravel\ConsentManager;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Request;
use Orchestra\Testbench\Foundation\Application;

// Exercise the real PHP/browser cookie contract without a web server.
require dirname(__DIR__, 2).'/vendor/autoload.php';

$app = Application::create(options: ['extra' => ['providers' => [ConsentForLaravelServiceProvider::class]]]);
$app->make(Kernel::class)->bootstrap();
$app['config']->set('consent.services', [
    'stats' => ['category' => 'analytics', 'name' => 'Statistics', 'description' => 'Measure visits.', 'cookies' => [['name' => '_fixture']]],
    'ads' => ['category' => 'marketing', 'name' => 'Campaigns', 'description' => 'Measure campaigns.'],
]);

$input = json_decode(file_get_contents('php://stdin'), true, 512, JSON_THROW_ON_ERROR);
$manager = $app->make(ConsentManager::class);
$request = Request::create('/', cookies: ['consent_preferences' => $input['cookie'] ?? null]);

echo json_encode([
    'config' => $app->make(BrowserRuntime::class)->configuration(),
    'decision' => $manager->choose(['analytics' => true])->toArray(),
    'restored' => $manager->read($request)->toArray(),
], JSON_THROW_ON_ERROR);
