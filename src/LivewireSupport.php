<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Composer\InstalledVersions;

final readonly class LivewireSupport
{
    public function __construct(public LivewireSettings $settings) {}

    /** @return array{enabled: bool, navigation: string, major: int|null} */
    public function configuration(): array
    {
        $version = class_exists(InstalledVersions::class) && InstalledVersions::isInstalled('livewire/livewire')
            ? InstalledVersions::getVersion('livewire/livewire') : null;

        return [
            'enabled' => $this->settings->enabled,
            'navigation' => $this->settings->navigation,
            'major' => is_string($version) && preg_match('/\A([0-9]+)\./', $version, $matches) ? (int) $matches[1] : null,
        ];
    }
}
