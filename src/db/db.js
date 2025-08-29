const { Pool } = require('pg');
const redis = require('redis');

// PostgreSQL connection with environment variable support
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'moviedb',
  user: process.env.DB_USER || 'movieuser',
  password: process.env.DB_PASSWORD || 'moviepass',
  ssl: false
});

// Redis connection
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379'
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

// Database schema initialization
const initSchema = `
-- Movies table
CREATE TABLE IF NOT EXISTS movies (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    year INTEGER,
    genre VARCHAR(100),
    magnet TEXT NOT NULL,
    poster_url TEXT,
    imdb_id VARCHAR(20),
    info_hash VARCHAR(40),
    torrent_files JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Regular users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Streaming sessions table (for real analytics)
CREATE TABLE IF NOT EXISTS streaming_sessions (
    id SERIAL PRIMARY KEY,
    movie_id INTEGER REFERENCES movies(id) ON DELETE CASCADE,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    download_speed BIGINT DEFAULT 0,
    bytes_downloaded BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User watch time tracking table
CREATE TABLE IF NOT EXISTS user_watch_time (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    movie_id INTEGER REFERENCES movies(id) ON DELETE CASCADE,
    watch_time_seconds INTEGER DEFAULT 0,
    total_duration_seconds INTEGER,
    last_watched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_completed BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, movie_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(year);
CREATE INDEX IF NOT EXISTS idx_movies_genre ON movies(genre);
CREATE INDEX IF NOT EXISTS idx_streaming_sessions_movie_id ON streaming_sessions(movie_id);
CREATE INDEX IF NOT EXISTS idx_streaming_sessions_created_at ON streaming_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_user_watch_time_user_id ON user_watch_time(user_id);
CREATE INDEX IF NOT EXISTS idx_user_watch_time_movie_id ON user_watch_time(movie_id);
CREATE INDEX IF NOT EXISTS idx_user_watch_time_user_movie ON user_watch_time(user_id, movie_id);

-- Torrent cache table
CREATE TABLE IF NOT EXISTS torrent_cache (
    id SERIAL PRIMARY KEY,
    info_hash VARCHAR(40) UNIQUE NOT NULL,
    name VARCHAR(255),
    total_length BIGINT,
    file_count INTEGER,
    video_files JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_torrent_cache_hash ON torrent_cache(info_hash);
`;

async function init() {
  const maxRetries = 10;
  const retryDelay = 5000; // 5 seconds
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Attempting database connection (${attempt}/${maxRetries})...`);
      
      const client = await pool.connect();
      console.log('✅ Connected to PostgreSQL');
      
      // Initialize database schema
      await client.query(initSchema);
      console.log('✅ Database schema initialized');
      
      client.release();
      
      await redisClient.connect();
      console.log('✅ Connected to Redis');
      
      return; // Success, exit the retry loop
      
    } catch (error) {
      console.error(`❌ Database connection attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        console.error('❌ Max retries reached. Database connection failed.');
        throw error;
      }
      
      console.log(`⏳ Retrying in ${retryDelay/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

module.exports = {
  pool,
  redis: redisClient,
  init
};
