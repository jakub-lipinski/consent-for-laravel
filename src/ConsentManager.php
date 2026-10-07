<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use InvalidArgumentException;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Response;

final readonly class ConsentManager
{
    public function __construct(
        private ConsentSettings $settings,
        private ServiceRegistry $services,
        private ConsentCodec $codec,
    ) {}

    public function read(Request $request): ConsentState
    {
        return $this->codec->decode($request->cookies->all()[$this->settings->cookieName] ?? null)
            ?? new ConsentState($this->settings->policyVersion, $this->services->version(), Category::deniedChoices());
    }

    public function needsConsent(Request $request): bool
    {
        return count($this->services->categories()) > 1 && ! $this->read($request)->hasDecision();
    }

    public function acceptAll(): ConsentState
    {
        $choices = [];

        foreach ($this->services->categories() as $category) {
            $choices[$category->value] = true;
        }

        return $this->choose($choices);
    }

    public function rejectOptional(): ConsentState
    {
        return $this->choose([]);
    }

    /** @param array<array-key, mixed> $choices */
    public function choose(array $choices): ConsentState
    {
        $normalized = Category::deniedChoices();

        foreach ($choices as $key => $choice) {
            $category = is_string($key) ? Category::tryFrom($key) : null;

            if (
                $category === null
                || ! is_bool($choice)
                || ($category === Category::Necessary && ! $choice)
                || (! $this->services->uses($category) && $choice)
            ) {
                throw new InvalidArgumentException('Consent choices must use known categories and boolean values. Necessary cookies cannot be rejected and unused categories cannot be granted.');
            }

            $normalized[$category->value] = $choice;
        }

        $now = Date::now()->getTimestamp();

        return new ConsentState($this->settings->policyVersion, $this->services->version(), $normalized, $now, $now + $this->settings->retentionDays * 86400);
    }

    /**
     * @template TResponse of Response
     *
     * @param  TResponse  $response
     * @return TResponse
     */
    public function persist(ConsentState $state, Response $response, Request $request): Response
    {
        $value = $this->codec->encode($state);

        if ($this->codec->decode($value) === null) {
            throw new InvalidArgumentException('Only a current, valid consent decision can be persisted.');
        }

        $response->headers->setCookie($this->cookie($value, $state->expiresAt, $request));
        $response->headers->set('Cache-Control', 'private, no-store');

        return $response;
    }

    /**
     * @template TResponse of Response
     *
     * @param  TResponse  $response
     * @return TResponse
     */
    public function forget(Response $response, Request $request): Response
    {
        $response->headers->setCookie($this->cookie('', 1, $request));
        $response->headers->set('Cache-Control', 'private, no-store');

        return $response;
    }

    private function cookie(string $value, ?int $expiresAt, Request $request): Cookie
    {
        return new Cookie(
            name: $this->settings->cookieName,
            value: $value,
            expire: $expiresAt ?? 1,
            path: $this->settings->cookiePath,
            domain: $this->settings->cookieDomain,
            secure: $this->settings->cookieSecure ?? $request->isSecure(),
            httpOnly: false,
            raw: false,
            sameSite: $this->settings->cookieSameSite,
        );
    }
}
