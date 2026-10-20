<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\View\Compilers\BladeCompiler;
use InvalidArgumentException;

/** Keeps Livewire's script extraction outside consent blocks. */
final class LivewireBladePrecompiler
{
    private const SERVER_TOKENS = '\{\{--|\{!!|\{\{|<\?(?:php\b|=)|\B@\w+(?:::\w+)?\b';

    public function __construct(private readonly ?BladeCompiler $blade = null) {}

    public function __invoke(string $source): string
    {
        if (! str_contains($source, '@consent')) {
            return $source;
        }
        $offset = 0;
        $consent = false;
        $livewire = [];
        $output = '';
        $pattern = '~'.self::SERVER_TOKENS.'|<script\b~i';
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
            if ($lower === '<script') {
                $end = $this->scriptEnd($source, $end);
                $script = substr($source, $start, $end - $start);
                // Keep expressions opaque to extraction, then restore them before normal Blade compilation.
                $output .= $consent ? '{{-- consent-livewire-script:'.base64_encode($script).' --}}' : $script;
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
            } else {
                $end = $this->serverEnd($source, $start, $token);
            }
            $output .= substr($source, $start, $end - $start);
            $offset = $end;
        }
        if ($consent) {
            throw new InvalidArgumentException('A Livewire consent block requires @endconsent.');
        }

        return $output.substr($source, $offset);
    }

    public function restore(string $source): string
    {
        if (! str_contains($source, '{{-- consent-livewire-script:')) {
            return $source;
        }

        return preg_replace_callback('~\{\{-- consent-livewire-script:([A-Za-z0-9+/=]+) --\}\}~', static function (array $match): string {
            $script = base64_decode($match[1], true);

            return $script === false ? $match[0] : $script;
        }, $source) ?? $source;
    }

    private function scriptEnd(string $source, int $offset): int
    {
        $pattern = '~'.self::SERVER_TOKENS.'|</script\s*>~i';
        while (preg_match($pattern, $source, $match, PREG_OFFSET_CAPTURE, $offset)) {
            [$token, $start] = $match[0];
            if (str_starts_with($token, '</')) {
                return $start + strlen($token);
            }
            $offset = $this->serverEnd($source, $start, $token);
        }

        throw new InvalidArgumentException('A script in a Livewire view requires a closing script tag.');
    }

    private function serverEnd(string $source, int $start, string $token): int
    {
        $end = $start + strlen($token);
        $lower = strtolower($token);
        if ($lower === '{{--') {
            return $this->through($source, '--}}', $end);
        }
        if ($lower === '{!!' || $lower === '{{') {
            return $this->through($source, $lower === '{!!' ? '!!}' : '}}', $end);
        }
        if (str_starts_with($lower, '<?')) {
            return $this->phpEnd(substr($source, $start), $start);
        }
        if ($start > 0 && $source[$start - 1] === '@') {
            return $end;
        }
        if ($lower === '@verbatim') {
            return $this->through($source, '@endverbatim', $end);
        }
        $next = $end + strspn($source, " \t\r\n", $end);
        if ($lower === '@php' && ($source[$next] ?? '') !== '(') {
            return $this->phpEnd('<?php '.substr($source, $end), $end - 6, true);
        }
        $name = substr($token, 1);
        if (($source[$next] ?? '') === '(' && (method_exists($this->blade ?? BladeCompiler::class, 'compile'.ucfirst($name))
            || array_key_exists($name, $this->blade?->getCustomDirectives() ?? []))) {
            return $this->expressionEnd($source, $next);
        }

        return $end;
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
        throw new InvalidArgumentException('Unclosed Blade directive arguments in a Livewire view.');
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
}
