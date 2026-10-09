<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\Database\DatabaseManager;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Str;
use InvalidArgumentException;

final readonly class AuditRecorder
{
    public function __construct(private AuditSettings $settings, private AuditNotice $signer, private DatabaseManager $database) {}

    /**
     * Records a submitted decision, never a preference-cookie read.
     *
     * @param  array<string, mixed>  $input
     * @return array{id: string, consent_id: string}
     */
    public function record(array $input, ?string $consentId = null): array
    {
        if (! $this->settings->enabled) {
            throw new InvalidArgumentException('Consent audit is disabled.');
        }
        if (array_diff(array_keys($input), ['id', 'notice', 'action', 'choices']) !== []
            || ! is_string($input['id'] ?? null) || ! preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z/', $input['id'])
            || ! in_array($input['action'] ?? null, ['accept_all', 'reject_optional', 'save_preferences', 'withdraw'], true)
            || ! is_array($input['notice'] ?? null) || count($input['notice']) !== 2 || array_diff(array_keys($input['notice']), ['payload', 'signature']) !== []
            || ! is_string($input['notice']['payload']) || ! is_string($input['notice']['signature'])
            || strlen($input['notice']['payload']) > AuditNotice::MAX_REQUEST_BYTES
            || ! $this->signer->authentic($input['notice']['payload'], $input['notice']['signature'], 'notice')) {
            throw new InvalidArgumentException('Invalid consent audit submission or notice signature.');
        }
        $notice = json_decode($input['notice']['payload'], true, 64, JSON_THROW_ON_ERROR);
        if (! is_array($notice) || ($notice['schema_version'] ?? null) !== 1
            || ! is_array($notice['categories'] ?? null) || ! in_array('necessary', $notice['categories'], true)
            || array_diff($notice['categories'], array_column(Category::cases(), 'value')) !== []
            || ! is_int($notice['retention_days'] ?? null) || $notice['retention_days'] < 1 || $notice['retention_days'] > 365
            || ! is_string($notice['policy_version'] ?? null) || ! is_string($notice['services_version'] ?? null)
            || ! is_string($notice['locale'] ?? null) || ! is_string($notice['html'] ?? null)) {
            throw new InvalidArgumentException('Invalid consent audit notice schema.');
        }
        $choices = $input['choices'] ?? null;
        $normalized = Category::deniedChoices();
        if (! is_array($choices) || count($choices) !== count($normalized) || array_diff(array_keys($choices), array_keys($normalized)) !== []) {
            throw new InvalidArgumentException('Consent audit requires a full category decision.');
        }
        foreach ($normalized as $category => $_) {
            $choice = $choices[$category];
            if (! is_bool($choice) || ($category === 'necessary' && ! $choice)
                || (! in_array($category, $notice['categories'], true) && $choice)
                || ($input['action'] === 'accept_all' && in_array($category, $notice['categories'], true) && ! $choice)
                || (in_array($input['action'], ['reject_optional', 'withdraw'], true) && $category !== 'necessary' && $choice)) {
                throw new InvalidArgumentException('Consent audit action and category choices do not match.');
            }
            $normalized[$category] = $choice;
        }
        if ($consentId !== null && ! Str::isUuid($consentId)) {
            throw new InvalidArgumentException('Consent audit browser identity must be a UUID.');
        }
        $id = $input['id'];
        $submittedConsentId = $consentId;
        $consentId ??= (string) Str::uuid();
        $fingerprint = hash('sha256', $input['notice']['payload']);
        $now = Date::now()->utc();
        $connection = $this->database->connection($this->settings->connection);

        return $connection->transaction(function () use ($connection, $input, $notice, $normalized, $id, $consentId, $submittedConsentId, $fingerprint, $now): array {
            $connection->table($this->settings->noticesTable)->insertOrIgnore([
                'fingerprint' => $fingerprint,
                'policy_version' => $notice['policy_version'],
                'services_version' => $notice['services_version'],
                'locale' => $notice['locale'],
                'snapshot' => $input['notice']['payload'],
                'created_at' => $now->format('Y-m-d H:i:s'),
            ]);
            $noticeId = $connection->table($this->settings->noticesTable)->where('fingerprint', $fingerprint)->value('id');
            $connection->table($this->settings->decisionsTable)->insertOrIgnore([
                'id' => $id,
                'consent_id' => $consentId,
                'notice_id' => $noticeId,
                'action' => $input['action'],
                'choices' => json_encode($normalized, JSON_THROW_ON_ERROR),
                'recorded_at' => $now->format('Y-m-d H:i:s'),
                'expires_at' => $input['action'] === 'withdraw' ? null : $now->copy()->addDays($notice['retention_days'])->format('Y-m-d H:i:s'),
            ]);
            $decision = $connection->table($this->settings->decisionsTable)->where('id', $id)->first();
            if ($decision === null || ($submittedConsentId !== null && $decision->consent_id !== $submittedConsentId) || (string) $decision->notice_id !== (string) $noticeId || $decision->action !== $input['action']
                || json_decode($decision->choices, true, 64, JSON_THROW_ON_ERROR) !== $normalized) {
                throw new AuditConflict('Consent audit event ID was already used for a different decision.');
            }

            return ['id' => $id, 'consent_id' => $decision->consent_id];
        }, 3);
    }
}
