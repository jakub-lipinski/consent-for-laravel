<?php

namespace ConsentForLaravel\ConsentForLaravel;

use InvalidArgumentException;

final readonly class LivewireSettings
{
    public bool $enabled;

    public string $navigation;

    public function __construct(mixed $configuration = [])
    {
        if (! is_array($configuration) || array_diff(array_keys($configuration), ['enabled', 'navigation']) !== []) {
            throw new InvalidArgumentException('consent.livewire must contain only enabled and navigation.');
        }
        $configuration += ['enabled' => true, 'navigation' => 'auto'];
        if (! is_bool($configuration['enabled']) || ! in_array($configuration['navigation'], ['auto', 'reload'], true)) {
            throw new InvalidArgumentException('consent.livewire requires boolean enabled and auto or reload navigation.');
        }
        $this->enabled = $configuration['enabled'];
        $this->navigation = $configuration['navigation'];
    }
}
