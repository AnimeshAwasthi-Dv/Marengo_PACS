require('dotenv').config({ quiet: true });
if (process.env.DATABASE_READ_ONLY === 'true') {
  console.log('Read-only database: migrations skipped.');
  process.exit(0);
}
const { run } = require('./with-pg-tls-proxy.cjs');
void run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
