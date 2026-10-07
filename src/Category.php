<?php

namespace ConsentForLaravel\ConsentForLaravel;

enum Category: string
{
    case Necessary = 'necessary';
    case Analytics = 'analytics';
    case Marketing = 'marketing';
    case Performance = 'performance';
    case Other = 'other';

    /** @return array<string, bool> */
    public static function deniedChoices(): array
    {
        $choices = [];

        foreach (self::cases() as $category) {
            $choices[$category->value] = $category === self::Necessary;
        }

        return $choices;
    }
}
