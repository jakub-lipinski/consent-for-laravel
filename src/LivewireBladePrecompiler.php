<?php

namespace ConsentForLaravel\ConsentForLaravel;

use InvalidArgumentException;

/** Keeps Livewire's single-file script extraction outside consent blocks. */
final class LivewireBladePrecompiler
{
    public function __invoke(string $source): string
    {
        if (! str_contains($source, '@consent')) {
            return $source;
        }
        $offset = 0;
        $consent = false;
        $livewire = [];
        $output = '';
        $pattern = '~\{\{--|\{!!|\{\{|<\?(?:php\b|=)|@(?:verbatim|php|consent|endconsent|script|endscript|assets|endassets)\b|<script\b~i';
        while (preg_match($pattern, $source, $match, PREG_OFFSET_CAPTURE, $offset)) {
            [$token, $start] = $match[0];
            $output .= substr($source, $offset, $start - $offset);
            $end = $start + strlen($token);
            if (str_starts_with($token, '@') && $start > 0 && $source[$start - 1] === '@') {
                $output .= $token;
                $offset = $end;

                continue;
            }
            $lower = strtolower($token);
            if ($lower === '{{--') {
                $end = $this->through($source, '--}}', $end);
            } elseif ($lower === '{!!' || $lower === '{{') {
                $end = $this->through($source, $lower === '{!!' ? '!!}' : '}}', $end);
            } elseif ($lower === '@verbatim') {
                $end = $this->through($source, '@endverbatim', $end);
            } elseif (str_starts_with($lower, '<?')) {
                $end = $this->phpEnd(substr($source, $start), $start);
            } elseif ($lower === '@php') {
                $next = $end + strspn($source, " \t\r\n", $end);
                $end = ($source[$next] ?? '') === '(' ? $this->expressionEnd($source, $next)
                    : $this->phpEnd('<?php '.substr($source, $end), $end - 6, true);
            } elseif ($lower === '<script') {
                if (! preg_match('~</script\s*>~i', $source, $closing, PREG_OFFSET_CAPTURE, $end)) {
                    throw new InvalidArgumentException('A script in a Livewire view requires a closing script tag.');
                }
                $end = $closing[0][1] + strlen($closing[0][0]);
                $script = substr($source, $start, $end - $start);
                $output .= $consent ? $this->protectScript($script) : $script;
                $offset = $end;

                continue;
            } elseif ($lower === '@consent') {
                if ($consent || $livewire !== []) {
                    throw new InvalidArgumentException('Use @consent outside Livewire @script and @assets blocks; nested consent blocks are unsupported.');
                }
                $consent = true;
                $next = $end + strspn($source, " \t\r\n", $end);
                $end = $this->expressionEnd($source, $next);
            } elseif ($lower === '@endconsent') {
                if (! $consent) {
                    throw new InvalidArgumentException('Unmatched @endconsent in a Livewire view.');
                }
                $consent = false;
            } elseif ($lower === '@script' || $lower === '@assets') {
                if ($consent) {
                    throw new InvalidArgumentException('Livewire @script and @assets cannot execute inside @consent. Use ordinary script tags.');
                }
                $livewire[] = $lower;
            } elseif ($lower === '@endscript' || $lower === '@endassets') {
                array_pop($livewire);
            }
            $output .= substr($source, $start, $end - $start);
            $offset = $end;
        }
        if ($consent) {
            throw new InvalidArgumentException('A Livewire consent block requires @endconsent.');
        }

        return $output.substr($source, $offset);
    }

    private function through(string $source, string $closing, int $offset): int
    {
        $position = strpos($source, $closing, $offset);

        return $position === false ? strlen($source) : $position + strlen($closing);
    }

    private function expressionEnd(string $source, int $offset): int
    {
        if (($source[$offset] ?? '') !== '(') {
            throw new InvalidArgumentException('A Livewire consent directive requires parenthesized arguments.');
        }
        $position = $offset - 6;
        $depth = 0;
        foreach (token_get_all('<?php '.substr($source, $offset)) as $token) {
            $text = is_array($token) ? $token[1] : $token;
            $position += strlen($text);
            if ($token === '(') {
                $depth++;
            } elseif ($token === ')' && --$depth === 0) {
                return $position;
            }
        }
        throw new InvalidArgumentException('Unclosed consent directive arguments.');
    }

    private function phpEnd(string $source, int $offset, bool $blade = false): int
    {
        $position = $offset;
        $at = false;
        foreach (token_get_all($source) as $token) {
            $text = is_array($token) ? $token[1] : $token;
            $position += strlen($text);
            if (is_array($token) && ((! $blade && $token[0] === T_CLOSE_TAG)
                || ($blade && $at && $token[0] === T_STRING && $text === 'endphp'))) {
                return $position;
            }
            $at = $token === '@';
        }

        return $offset + strlen($source);
    }

    private function protectScript(string $source): string
    {
        // PHP/Blade expressions stay intact; their output is already invisible to extraction.
        $offset = 0;
        $result = '';
        $pattern = '~\{\{--|\{!!|\{\{|<\?(?:php\b|=)|@(?:verbatim|php)\b|<script\b~i';
        while (preg_match($pattern, $source, $match, PREG_OFFSET_CAPTURE, $offset)) {
            [$token, $start] = $match[0];
            $result .= substr($source, $offset, $start - $offset);
            $end = $start + strlen($token);
            $lower = strtolower($token);
            if ($lower === '<script') {
                $result .= '{!! '.var_export($token, true).' !!}';
                $offset = $end;

                continue;
            }
            if ($lower === '{{--') {
                $end = $this->through($source, '--}}', $end);
            } elseif ($lower === '{!!' || $lower === '{{') {
                $end = $this->through($source, $lower === '{!!' ? '!!}' : '}}', $end);
            } elseif ($lower === '@verbatim' && ($source[$start - 1] ?? '') !== '@') {
                $end = $this->through($source, '@endverbatim', $end);
            } elseif (str_starts_with($lower, '<?')) {
                $end = $this->phpEnd(substr($source, $start), $start);
            } elseif ($lower === '@php' && ($source[$start - 1] ?? '') !== '@') {
                $next = $end + strspn($source, " \t\r\n", $end);
                $end = ($source[$next] ?? '') === '(' ? $this->expressionEnd($source, $next)
                    : $this->phpEnd('<?php '.substr($source, $end), $end - 6, true);
            }
            $result .= substr($source, $start, $end - $start);
            $offset = $end;
        }

        return $result.substr($source, $offset);
    }
}
