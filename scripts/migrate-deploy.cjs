require('dotenv').config({ quiet: true });
if (process.env.DATABASE_READ_ONLY === 'true') {
  console.log('Read-only database: migrations skipped.');
  process.exit(0);
}
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
