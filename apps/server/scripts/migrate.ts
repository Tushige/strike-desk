import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';

async function migrate(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const environment = process.env.STATS_ENVIRONMENT;
  if (!url || (environment !== 'development' && environment !== 'production')) {
    throw new Error('DATABASE_URL and STATS_ENVIRONMENT are required.');
  }
  const sql = neon(url);
  const directory = new URL('../migrations/', import.meta.url);
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const applied: unknown = await sql`SELECT name, checksum FROM schema_migrations`;
  const checksums = new Map((applied as { name: string; checksum: string }[]).map(row => [row.name, row.checksum]));
  for (const name of (await readdir(directory)).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort()) {
    const source = await readFile(new URL(name, directory), 'utf8');
    const checksum = createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
    const previous = checksums.get(name);
    if (previous !== undefined) {
      if (previous !== checksum) throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    // Migrations here contain plain DDL, without procedural blocks or semicolons in strings.
    const statements = source.split(';').map(statement => statement.trim()).filter(Boolean);
    await sql.transaction([
      ...statements.map(statement => sql.query(statement)),
      sql`INSERT INTO schema_migrations (name, checksum) VALUES (${name}, ${checksum})`,
    ], { fetchOptions: { signal: AbortSignal.timeout(30_000) } });
    console.log(`Applied ${name} (${environment}).`);
  }
  console.log('Database migrations are up to date.');
}

void migrate().catch(() => {
  // Provider exceptions can contain connection details. Do not print credentials.
  console.error('Migration failed. Check the database branch, credentials, and whether an applied migration was modified.');
  process.exitCode = 1;
});
