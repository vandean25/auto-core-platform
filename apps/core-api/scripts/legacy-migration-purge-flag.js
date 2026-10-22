export async function enableLegacyMigrationPurgeFlag(tx) {
    await tx.$executeRaw `SELECT set_config('acp.allow_purge', 'on', true)`;
}
//# sourceMappingURL=legacy-migration-purge-flag.js.map