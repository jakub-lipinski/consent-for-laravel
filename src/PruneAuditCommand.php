<?php

namespace ConsentForLaravel\ConsentForLaravel;

use Illuminate\Console\Command;
use Illuminate\Database\DatabaseManager;
use Illuminate\Support\Facades\Date;

final class PruneAuditCommand extends Command
{
    protected $signature = 'consent:audit-prune';

    protected $description = 'Delete consent audit decisions past their configured retention and unused notices';

    public function handle(AuditSettings $settings, DatabaseManager $database): int
    {
        if (! $settings->enabled || $settings->retentionDays === null) {
            $this->info('Consent audit pruning is disabled.');

            return self::SUCCESS;
        }
        $connection = $database->connection($settings->connection);
        $cutoff = Date::now()->utc()->subDays($settings->retentionDays)->format('Y-m-d H:i:s');
        $deleted = 0;
        do {
            $ids = $connection->table($settings->decisionsTable)->where('recorded_at', '<', $cutoff)->orderBy('recorded_at')->limit(1000)->pluck('id');
            $deleted += $connection->table($settings->decisionsTable)->whereIn('id', $ids)->delete();
        } while ($ids->count() === 1000);
        // Never remove a notice referenced by a retained decision.
        $connection->table($settings->noticesTable)->where('created_at', '<', $cutoff)
            ->whereNotIn('id', $connection->table($settings->decisionsTable)->select('notice_id'))->delete();
        $this->info("Deleted {$deleted} expired consent audit decisions.");

        return self::SUCCESS;
    }
}
