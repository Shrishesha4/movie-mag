const express = require('express');
const { pool, redis } = require('../db/db');
const userAuth = require('../middleware/userAuth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiting for watch time operations
const watchTimeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many watch time operations, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Save watch time for a movie
router.post('/save', watchTimeLimiter, userAuth, async (req, res) => {
    try {
        const { movieId, watchTimeSeconds, totalDurationSeconds, isCompleted = false } = req.body;
        const userId = req.user.id;

        if (!movieId || watchTimeSeconds === undefined) {
            return res.status(400).json({ error: 'movieId and watchTimeSeconds are required' });
        }

        if (watchTimeSeconds < 0) {
            return res.status(400).json({ error: 'watchTimeSeconds cannot be negative' });
        }

        // Check if movie exists
        const movieResult = await pool.query('SELECT id FROM movies WHERE id = $1', [movieId]);
        if (movieResult.rows.length === 0) {
            return res.status(404).json({ error: 'Movie not found' });
        }

        // Upsert watch time record
        const result = await pool.query(`
            INSERT INTO user_watch_time (user_id, movie_id, watch_time_seconds, total_duration_seconds, is_completed, last_watched_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            ON CONFLICT (user_id, movie_id) DO UPDATE SET
                watch_time_seconds = EXCLUDED.watch_time_seconds,
                total_duration_seconds = EXCLUDED.total_duration_seconds,
                is_completed = EXCLUDED.is_completed,
                last_watched_at = NOW(),
                updated_at = NOW()
            RETURNING *
        `, [userId, movieId, watchTimeSeconds, totalDurationSeconds || null, isCompleted]);

        const watchTime = result.rows[0];

        // Clear cache for this user's watch time
        const cacheKey = `watch_time:${userId}:${movieId}`;
        await redis.del(cacheKey);

        console.log(`✅ Watch time saved for user ${userId}, movie ${movieId}: ${watchTimeSeconds}s`);

        res.json({
            success: true,
            watchTime: {
                id: watchTime.id,
                movieId: watchTime.movie_id,
                watchTimeSeconds: watchTime.watch_time_seconds,
                totalDurationSeconds: watchTime.total_duration_seconds,
                isCompleted: watchTime.is_completed,
                lastWatchedAt: watchTime.last_watched_at,
                progress: totalDurationSeconds ? Math.round((watchTimeSeconds / totalDurationSeconds) * 100) : 0
            }
        });

    } catch (error) {
        console.error('Error saving watch time:', error);
        res.status(500).json({ error: 'Failed to save watch time' });
    }
});

// Get watch time for a specific movie
router.get('/movie/:movieId', watchTimeLimiter, userAuth, async (req, res) => {
    try {
        const { movieId } = req.params;
        const userId = req.user.id;

        // Check cache first
        const cacheKey = `watch_time:${userId}:${movieId}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(JSON.parse(cached));
        }

        const result = await pool.query(`
            SELECT * FROM user_watch_time 
            WHERE user_id = $1 AND movie_id = $2
        `, [userId, movieId]);

        if (result.rows.length === 0) {
            const response = { watchTime: null };
            await redis.setEx(cacheKey, 300, JSON.stringify(response)); // Cache for 5 minutes
            return res.json(response);
        }

        const watchTime = result.rows[0];
        const response = {
            watchTime: {
                id: watchTime.id,
                movieId: watchTime.movie_id,
                watchTimeSeconds: watchTime.watch_time_seconds,
                totalDurationSeconds: watchTime.total_duration_seconds,
                isCompleted: watchTime.is_completed,
                lastWatchedAt: watchTime.last_watched_at,
                progress: watchTime.total_duration_seconds ? 
                    Math.round((watchTime.watch_time_seconds / watchTime.total_duration_seconds) * 100) : 0
            }
        };

        await redis.setEx(cacheKey, 300, JSON.stringify(response)); // Cache for 5 minutes
        res.json(response);

    } catch (error) {
        console.error('Error getting watch time:', error);
        res.status(500).json({ error: 'Failed to get watch time' });
    }
});

// Get all watch time records for a user
router.get('/user', watchTimeLimiter, userAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 50, offset = 0 } = req.query;

        // Check cache first
        const cacheKey = `watch_time:user:${userId}:${limit}:${offset}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(JSON.parse(cached));
        }

        const result = await pool.query(`
            SELECT wt.*, m.title, m.poster_url, m.year
            FROM user_watch_time wt
            JOIN movies m ON wt.movie_id = m.id
            WHERE wt.user_id = $1
            ORDER BY wt.last_watched_at DESC
            LIMIT $2 OFFSET $3
        `, [userId, parseInt(limit), parseInt(offset)]);

        const watchTimes = result.rows.map(row => ({
            id: row.id,
            movieId: row.movie_id,
            movieTitle: row.title,
            posterUrl: row.poster_url,
            year: row.year,
            watchTimeSeconds: row.watch_time_seconds,
            totalDurationSeconds: row.total_duration_seconds,
            isCompleted: row.is_completed,
            lastWatchedAt: row.last_watched_at,
            progress: row.total_duration_seconds ? 
                Math.round((row.watch_time_seconds / row.total_duration_seconds) * 100) : 0
        }));

        const response = { watchTimes, total: watchTimes.length };

        await redis.setEx(cacheKey, 300, JSON.stringify(response)); // Cache for 5 minutes
        res.json(response);

    } catch (error) {
        console.error('Error getting user watch times:', error);
        res.status(500).json({ error: 'Failed to get user watch times' });
    }
});

// Get watch time statistics for a user
router.get('/stats', watchTimeLimiter, userAuth, async (req, res) => {
    try {
        const userId = req.user.id;

        // Check cache first
        const cacheKey = `watch_time:stats:${userId}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(JSON.parse(cached));
        }

        const result = await pool.query(`
            SELECT 
                COUNT(*) as total_movies_watched,
                COUNT(CASE WHEN is_completed = true THEN 1 END) as completed_movies,
                SUM(watch_time_seconds) as total_watch_time_seconds,
                AVG(watch_time_seconds) as avg_watch_time_seconds,
                MAX(last_watched_at) as last_activity
            FROM user_watch_time 
            WHERE user_id = $1
        `, [userId]);

        const stats = result.rows[0];
        const response = {
            totalMoviesWatched: parseInt(stats.total_movies_watched) || 0,
            completedMovies: parseInt(stats.completed_movies) || 0,
            totalWatchTimeSeconds: parseInt(stats.total_watch_time_seconds) || 0,
            avgWatchTimeSeconds: Math.round(parseFloat(stats.avg_watch_time_seconds) || 0),
            lastActivity: stats.last_activity,
            totalWatchTimeHours: Math.round((parseInt(stats.total_watch_time_seconds) || 0) / 3600 * 100) / 100
        };

        await redis.setEx(cacheKey, 600, JSON.stringify(response)); // Cache for 10 minutes
        res.json(response);

    } catch (error) {
        console.error('Error getting watch time stats:', error);
        res.status(500).json({ error: 'Failed to get watch time stats' });
    }
});

// Delete watch time for a movie (reset progress)
router.delete('/movie/:movieId', watchTimeLimiter, userAuth, async (req, res) => {
    try {
        const { movieId } = req.params;
        const userId = req.user.id;

        const result = await pool.query(`
            DELETE FROM user_watch_time 
            WHERE user_id = $1 AND movie_id = $2
            RETURNING *
        `, [userId, movieId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Watch time record not found' });
        }

        // Clear cache
        const cacheKey = `watch_time:${userId}:${movieId}`;
        await redis.del(cacheKey);

        console.log(`✅ Watch time reset for user ${userId}, movie ${movieId}`);

        res.json({ success: true, message: 'Watch time reset successfully' });

    } catch (error) {
        console.error('Error deleting watch time:', error);
        res.status(500).json({ error: 'Failed to reset watch time' });
    }
});

// Mark movie as completed
router.post('/complete/:movieId', watchTimeLimiter, userAuth, async (req, res) => {
    try {
        const { movieId } = req.params;
        const { totalDurationSeconds } = req.body;
        const userId = req.user.id;

        if (!totalDurationSeconds) {
            return res.status(400).json({ error: 'totalDurationSeconds is required' });
        }

        const result = await pool.query(`
            INSERT INTO user_watch_time (user_id, movie_id, watch_time_seconds, total_duration_seconds, is_completed, last_watched_at, updated_at)
            VALUES ($1, $2, $3, $4, true, NOW(), NOW())
            ON CONFLICT (user_id, movie_id) DO UPDATE SET
                watch_time_seconds = EXCLUDED.watch_time_seconds,
                total_duration_seconds = EXCLUDED.total_duration_seconds,
                is_completed = true,
                last_watched_at = NOW(),
                updated_at = NOW()
            RETURNING *
        `, [userId, movieId, totalDurationSeconds, totalDurationSeconds]);

        const watchTime = result.rows[0];

        // Clear cache
        const cacheKey = `watch_time:${userId}:${movieId}`;
        await redis.del(cacheKey);

        console.log(`✅ Movie marked as completed for user ${userId}, movie ${movieId}`);

        res.json({
            success: true,
            watchTime: {
                id: watchTime.id,
                movieId: watchTime.movie_id,
                watchTimeSeconds: watchTime.watch_time_seconds,
                totalDurationSeconds: watchTime.total_duration_seconds,
                isCompleted: watchTime.is_completed,
                lastWatchedAt: watchTime.last_watched_at,
                progress: 100
            }
        });

    } catch (error) {
        console.error('Error marking movie as completed:', error);
        res.status(500).json({ error: 'Failed to mark movie as completed' });
    }
});

module.exports = router;
