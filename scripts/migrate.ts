import { migrate } from '../src/migrate';
import { closeDatabase } from '../src/services/database.service';

migrate().catch(() => { console.error('Database migration failed; check connection and schema permissions.'); process.exitCode = 1; }).finally(closeDatabase);
