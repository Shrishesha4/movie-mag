const { Pool } = require('pg');
const redis = require('redis');

// PostgreSQL connection with explicit SSL disabled
const pool = new Pool({
  host: 'postgres',
  port: 5432,
  database: 'moviedb',
  user: 'movieuser',
  password: 'moviepass',
  ssl: false
});

// Redis connection
const redisClient = redis.createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

async function init() {
  try {
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL');
    client.release();
    
    await redisClient.connect();
    console.log('✅ Connected to Redis');
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
}

module.exports = {
  pool,
  redis: redisClient,
  init
};
