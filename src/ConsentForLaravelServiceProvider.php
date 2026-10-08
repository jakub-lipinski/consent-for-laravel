<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\Contracts\Config\Repository;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\View\Compilers\BladeCompiler;
use Psr\Log\LoggerInterface;
use Spatie\LaravelPackageTools\Package;
use Spatie\LaravelPackageTools\PackageServiceProvider;
use Throwable;

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

        $this->app->bind(GoogleSettings::class, fn (Application $app): GoogleSettings => new GoogleSettings(
            $app->make(Repository::class)->get('consent.google', []),
            $app->make(Repository::class)->get('consent.presets', []),
        ));
        $this->app->bind(TrackerSettings::class, fn (Application $app): TrackerSettings => new TrackerSettings(
            $app->make(Repository::class)->get('consent.presets', []),
        ));
        $this->app->bind(ServiceRegistry::class, function (Application $app): ServiceRegistry {
            $google = $app->make(GoogleSettings::class);
            $trackers = $app->make(TrackerSettings::class);
            $context = $google->toArray() ?? [];
            if ($trackers->toArray() !== []) {
                $context['trackers'] = $trackers->toArray();
            }

            return new ServiceRegistry($app->make(Repository::class)->get('consent.services', []), $google->services() + $trackers->services(), $context);
        });
        $this->app->scoped(ScriptRenderer::class);
        $this->app->bind(BannerSettings::class, function (Application $app): BannerSettings {
            $settings = new BannerSettings($app->make(Repository::class)->get('consent.ui', []));
            if ($settings->colorWarnings !== []) {
                try {
                    $app->make(LoggerInterface::class)->warning('Consent UI theme requires attention.', ['issues' => $settings->colorWarnings]);
                } catch (Throwable) {
                    // Optional theme diagnostics must not interrupt the host page if logging fails.
                }
            }

            return $settings;
        });
    }

    public function packageBooted(): void
    {
        // Only the preferences cookie is readable by the browser. It contains no identity or authentication data.
        EncryptCookies::except($this->app->make(ConsentSettings::class)->cookieName);

        $blade = $this->app->make(BladeCompiler::class);
        $blade->directive('consent', fn (string $expression): string => '<?php echo app(\\'.ScriptRenderer::class.'::class)->open('.$expression.'); ?>');
        $blade->directive('endconsent', fn (): string => '</template>');

        $this->publishes([
            __DIR__.'/../resources/js/consent.js' => public_path('vendor/consent/consent.js'),
            __DIR__.'/../resources/js/banner.js' => public_path('vendor/consent/banner.js'),
            __DIR__.'/../resources/css/consent.css' => public_path('vendor/consent/consent.css'),
        ], 'consent-assets');
    }
}
