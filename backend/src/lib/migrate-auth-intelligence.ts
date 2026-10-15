import { runMigrations } from './migrate.js';

runMigrations()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error('Migration failed:', error);
		process.exit(1);
	});