<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use InvalidArgumentException;
use JsonException;
use Symfony\Component\HttpFoundation\Cookie;
use Throwable;

final readonly class AuditController
{
    public function __construct(private AuditSettings $audit, private ConsentSettings $settings, private AuditNotice $signer, private AuditRecorder $recorder) {}

    public function __invoke(Request $request): JsonResponse
    {
        abort_unless($this->audit->enabled, 404);
        // A stateless JSON endpoint keeps cached HTML free of session/CSRF tokens.
        // Require an exact same origin and a non-simple content type, without CORS opt-in.
        abort_unless($request->headers->get('Origin') === $request->getSchemeAndHttpHost()
            && in_array($request->headers->get('Sec-Fetch-Site'), [null, 'same-origin'], true), 403);
        abort_unless(strtolower(trim(explode(';', ($request->headers->get('Content-Type') ?? ''))[0])) === 'application/json', 415);
        abort_if(strlen($request->getContent()) > AuditNotice::MAX_REQUEST_BYTES, 413);
        try {
            $input = json_decode($request->getContent(), true, 64, JSON_THROW_ON_ERROR);
            if (! is_array($input)) {
                throw new InvalidArgumentException('Consent audit requires a JSON object.');
            }
            $identity = $request->cookies->get($this->audit->cookieName);
            $consentId = null;
            if (is_string($identity) && preg_match('/\A([0-9a-f-]{36})\.([0-9a-f]{64})\z/', $identity, $parts)
                && $this->signer->authentic($parts[1], $parts[2], 'identity')) {
                $consentId = $parts[1];
            }
            $receipt = $this->recorder->record($input, $consentId);
            $response = new JsonResponse(['id' => $receipt['id']], 201, ['Cache-Control' => 'private, no-store']);
            $response->headers->setCookie(new Cookie(
                name: $this->audit->cookieName,
                value: $receipt['consent_id'].'.'.$this->signer->sign($receipt['consent_id'], 'identity'),
                expire: Date::now()->getTimestamp() + $this->settings->retentionDays * 86400,
                path: $this->audit->path,
                domain: null,
                secure: $this->settings->cookieSecure ?? $request->isSecure(),
                httpOnly: true,
                sameSite: $this->settings->cookieSameSite,
            ));

            return $response;
        } catch (AuditConflict) {
            return new JsonResponse(['error' => 'Consent audit event conflicts with an existing decision.'], 409, ['Cache-Control' => 'no-store']);
        } catch (InvalidArgumentException|JsonException) {
            return new JsonResponse(['error' => 'Invalid consent audit submission.'], 422, ['Cache-Control' => 'no-store']);
        } catch (Throwable) {
            // Do not disclose database details, snapshots, or submitted decisions.
            return new JsonResponse(['error' => 'Consent audit storage is unavailable.'], 503, ['Cache-Control' => 'no-store']);
        }
    }
}
