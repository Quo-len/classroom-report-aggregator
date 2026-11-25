import fs from 'fs/promises';
import path from 'path';
import { database, closeDatabase } from '../src/services/database.service';

async function main() {
  const directory = path.resolve('migrations');
  for (const name of (await fs.readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    await database().query(await fs.readFile(path.join(directory, name), 'utf8'));
    console.log(`Applied ${name}`);
  }
}
main().catch(() => { console.error('Database migration failed; check connection and schema permissions.'); process.exitCode = 1; }).finally(closeDatabase);
