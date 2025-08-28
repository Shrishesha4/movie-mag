const express = require('express');
const { pool, redis } = require('../db/db');
const userAuth = require('../middleware/userAuth');

const router = express.Router();

// Get streaming statistics for a movie (requires user auth)
router.get('/stats/:movieId', userAuth, async (req, res) => {
  try {
    const { movieId } = req.params;
    
    // Get movie data
    const movieResult = await pool.query('SELECT * FROM movies WHERE id = $1', [movieId]);
    if (movieResult.rows.length === 0) {
      return res.status(404).json({ error: 'Movie not found' });
    }
    
    // Check if stats are cached in Redis
    const cacheKey = `movie:stats:${movieId}`;
    const cachedStats = await redis.get(cacheKey);
    
    if (cachedStats) {
      return res.json(JSON.parse(cachedStats));
    }
    
    // Get actual streaming stats from database (if you implement view tracking)
    const statsResult = await pool.query(`
      SELECT 
        COUNT(DISTINCT session_id) as current_viewers,
        SUM(bytes_downloaded) as total_downloaded,
        AVG(download_speed) as average_speed
      FROM streaming_sessions 
      WHERE movie_id = $1 AND created_at > NOW() - INTERVAL '1 hour'
    `, [movieId]);
    
    const stats = {
      movieId: parseInt(movieId),
      currentViewers: statsResult.rows[0]?.current_viewers || 0,
      totalDownloaded: statsResult.rows[0]?.total_downloaded || 0,
      averageSpeed: statsResult.rows[0]?.average_speed || 0
    };
    
    // Cache for 30 seconds
    await redis.setEx(cacheKey, 30, JSON.stringify(stats));
    
    res.json(stats);
  } catch (error) {
    console.error('Error getting streaming stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Track streaming session (requires user auth)
router.post('/session', userAuth, async (req, res) => {
  try {
    const { movieId, sessionId, downloadSpeed, bytesDownloaded } = req.body;
    
    if (!movieId || !sessionId) {
      return res.status(400).json({ error: 'movieId and sessionId are required' });
    }
    
    // Insert or update streaming session
    await pool.query(`
      INSERT INTO streaming_sessions (movie_id, session_id, download_speed, bytes_downloaded, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (session_id) DO UPDATE SET
        download_speed = EXCLUDED.download_speed,
        bytes_downloaded = EXCLUDED.bytes_downloaded,
        updated_at = NOW()
    `, [movieId, sessionId, downloadSpeed || 0, bytesDownloaded || 0]);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error tracking streaming session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check for streaming service (public - no auth required)
router.get('/health', async (req, res) => {
  try {
    // Check database connection
    await pool.query('SELECT 1');
    
    // Check Redis connection
    await redis.ping();
    
    // Get active streaming sessions count
    const activeSessionsResult = await pool.query(`
      SELECT COUNT(*) as active_sessions 
      FROM streaming_sessions 
      WHERE created_at > NOW() - INTERVAL '5 minutes'
    `);
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      activeSessions: parseInt(activeSessionsResult.rows[0]?.active_sessions) || 0,
      database: 'connected',
      redis: 'connected'
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

module.exports = router;
