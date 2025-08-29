const { Pool } = require('pg');

// Simple database connection check
async function checkDatabase() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'postgres',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'moviedb',
    user: process.env.DB_USER || 'movieuser',
    password: process.env.DB_PASSWORD || 'moviepass',
    ssl: false
  });

  try {
    const client = await pool.connect();
    console.log('✅ Database connection test successful');
    client.release();
    await pool.end();
    return true;
  } catch (error) {
    console.error('❌ Database connection test failed:', error.message);
    await pool.end();
    return false;
  }
}

// Run check if called directly
if (require.main === module) {
  checkDatabase().then(success => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = { checkDatabase };
