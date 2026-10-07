<?php

namespace ConsentForLaravel\ConsentForLaravel;

use InvalidArgumentException;

final class ScriptRenderer
{
    private int $sequence = 0;

    public function open(Category|string $category, ?string $id = null): string
    {
        $category = is_string($category) ? Category::from($category) : $category;
        if ($id !== null && str_starts_with($id, 'consent-auto-')) {
            throw new InvalidArgumentException('The consent-auto- prefix is reserved for generated block IDs.');
        }
        $id ??= 'consent-auto-'.++$this->sequence;

        if (! preg_match('/\A[a-zA-Z][a-zA-Z0-9._:-]{0,127}\z/', $id)) {
            throw new InvalidArgumentException('Consent block IDs must start with a letter and contain only letters, digits, dots, underscores, colons, or hyphens.');
        }

        return '<template data-consent-block="'.e($id).'" data-consent-category="'.$category->value.'">';
    }
}
