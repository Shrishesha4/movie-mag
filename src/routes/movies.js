const express = require('express');
const { pool, redis } = require('../db/db');
const auth = require('../middleware/auth');
const userAuth = require('../middleware/userAuth');
const rateLimit = require('express-rate-limit');
const validator = require('validator');

const router = express.Router();

// Rate limiting
const readLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: { error: 'Too many read requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

const writeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many write requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Helper functions (same as before)
function normalizeGenres(genreString) {
    if (!genreString) return [];
    return genreString
        .split(',')
        .map(genre => genre.trim().toLowerCase())
        .filter(genre => genre.length > 0)
        .filter((genre, index, array) => array.indexOf(genre) === index);
}

function formatGenresForDisplay(genreArray) {
    return genreArray
        .map(genre => genre.split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
        )
        .join(', ');
}

function validateMagnetLink(magnet) {
    if (!magnet || typeof magnet !== 'string') return false;
    const magnetRegex = /^magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}/;
    return magnetRegex.test(magnet);
}

function extractInfoHash(magnet) {
    const match = magnet.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
    return match ? match[1].toLowerCase() : null;
}

async function analyzeTorrent(magnet) {
    try {
        const response = await fetch(`http://localhost:7000/api/torrent/info/${encodeURIComponent(magnet)}`, {
            timeout: 30000,
            headers: { 'User-Agent': 'MovieMag/1.0' }
        });
        
        if (response.ok) {
            return await response.json();
        }
        return null;
    } catch (error) {
        console.warn('Torrent analysis error:', error.message);
        return null;
    }
}

// Helper function to fix sequence if out of sync
async function fixSequenceIfNeeded() {
    try {
        console.log('🔧 Checking and fixing sequence if needed...');
        await pool.query(`
            SELECT setval(
                pg_get_serial_sequence('movies', 'id'), 
                COALESCE(MAX(id), 1), 
                true
            ) FROM movies;
        `);
        console.log('✅ Sequence check completed');
    } catch (error) {
        console.error('⚠️ Could not fix sequence:', error.message);
        throw new Error(`Failed to fix database sequence: ${error.message}`); // Re-throw for main catch block
    }
}

// ADMIN ROUTES FIRST (require admin authentication)

// Add movie (admin only)
router.post('/', writeLimiter, auth, async (req, res) => {
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    console.log('🎬 POST /api/movies - Add movie request received');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Auth user:', req.user ? req.user.username : 'NO USER');

    // Check if auth middleware worked
    if (!req.user) {
        console.log('❌ No authenticated user found');
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const { title, description, year, genre, magnet, poster_url, imdb_id } = req.body;
        
        // Validation
        if (!title || !magnet) {
            console.log('❌ Validation failed: Missing required fields');
            return res.status(400).json({ 
                error: 'Validation failed',
                details: {
                    title: !title ? 'Title is required' : null,
                    magnet: !magnet ? 'Magnet link is required' : null
                }
            });
        }

        if (title.length > 255) {
            return res.status(400).json({ error: 'Title must be less than 255 characters' });
        }

        if (!validateMagnetLink(magnet)) {
            return res.status(400).json({ error: 'Invalid magnet link format' });
        }

        if (year && (isNaN(year) || year < 1900 || year > new Date().getFullYear() + 2)) {
            return res.status(400).json({ error: 'Invalid year' });
        }

        if (poster_url && !validator.isURL(String(poster_url), { require_protocol: false })) {
            return res.status(400).json({ error: 'Invalid poster URL' });
        }

        if (imdb_id && !/^tt\d{7,8}$/.test(imdb_id)) {
            return res.status(400).json({ error: 'Invalid IMDB ID format' });
        }

        // Check for duplicate magnet
        console.log('🔍 Checking for duplicate magnet...');
        const duplicateCheck = await pool.query('SELECT id, title FROM movies WHERE magnet = $1', [magnet]);
        if (duplicateCheck.rows.length > 0) {
            console.log('❌ Duplicate magnet found');
            return res.status(409).json({ 
                error: 'Movie with this magnet link already exists',
                existing_movie: duplicateCheck.rows[0]
            });
        }

        // Process data
        const normalizedGenres = normalizeGenres(genre);
        const normalizedGenreString = normalizedGenres.join(', ');
        const infoHash = extractInfoHash(magnet);

        console.log('🔍 Analyzing torrent for:', title);
        const torrentInfo = await analyzeTorrent(magnet);

        // Try to fix sequence before insert
        await fixSequenceIfNeeded();

        // Insert movie (DO NOT specify id, let SERIAL handle it)
        console.log('💾 Inserting movie into database...');
        
        const movieResult = await pool.query(`
            INSERT INTO movies (title, description, year, genre, magnet, poster_url, imdb_id, info_hash, torrent_files)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
            RETURNING *
        `, [
            title, 
            description || null, 
            year || null, 
            normalizedGenreString || null, 
            magnet, 
            poster_url || null, 
            imdb_id || null, 
            infoHash,
            torrentInfo?.files ? JSON.stringify(torrentInfo.files) : null
        ]);

        const movie = movieResult.rows[0];
        
        // Clear caches
        try {
            const keys = await redis.keys('movies:*');
            if (keys.length > 0) {
                await redis.del(keys);
            }
            await redis.del('movies:genres');
            await redis.del('movies:stats');
            console.log('✅ Redis caches cleared');
        } catch (redisError) {
            console.warn('⚠️ Failed to clear Redis caches for POST:', redisError.message);
        }

        console.log(`✅ Movie added successfully: "${title}" (ID: ${movie.id})`);
        
        const response = {
            ...movie,
            normalizedGenres,
            displayGenres: formatGenresForDisplay(normalizedGenres),
            hasValidMagnet: true,
            torrent_analysis: torrentInfo ? {
                name: torrentInfo.name,
                total_size: torrentInfo.length,
                file_count: torrentInfo.files?.length || 0,
                video_files: torrentInfo.files?.filter(f => 
                    /\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(f.name)
                ).length || 0
            } : null
        };

        res.status(201).json(response);

    } catch (error) {
        console.error('❌ Error adding movie:', error);
        
        // If it's a duplicate key error, try to fix sequence and suggest retry
        if (error.message && error.message.includes('duplicate key')) {
            console.log('🔧 Detected duplicate key error, attempting to fix sequence...');
            await fixSequenceIfNeeded();
            
            return res.status(409).json({ 
                error: 'Database sequence was out of sync and has been fixed. Please try again.',
                message: 'The database sequence has been automatically repaired. Please retry your request.',
                retry: true
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to add movie',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Update movie (admin only) 
router.put('/:id', writeLimiter, auth, async (req, res) => {
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    console.log('🎬 PUT /api/movies/:id - Edit movie request received');
    console.log('Movie ID:', req.params.id);
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Auth user:', req.user ? req.user.username : 'NO USER');

    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const { id } = req.params;
        const { title, description, year, genre, magnet, poster_url, imdb_id } = req.body;
        
        // Validate ID
        if (!id || (isNaN(parseInt(id)) && !validator.isUUID(id))) {
            return res.status(400).json({ error: 'Invalid movie ID format' });
        }

        // Check if movie exists
        console.log('🔍 Checking if movie exists...');
        const existsCheck = await pool.query('SELECT id FROM movies WHERE id = $1', [id]);
        if (existsCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Movie not found' });
        }

        // Validation (same as add movie)
        if (title && title.length > 255) {
            return res.status(400).json({ error: 'Title must be less than 255 characters' });
        }

        if (magnet && !validateMagnetLink(magnet)) {
            return res.status(400).json({ error: 'Invalid magnet link format' });
        }

        if (year && (isNaN(year) || year < 1900 || year > new Date().getFullYear() + 2)) {
            return res.status(400).json({ error: 'Invalid year' });
        }

        if (poster_url && !validator.isURL(String(poster_url), { require_protocol: false })) {
            return res.status(400).json({ error: 'Invalid poster URL' });
        }

        if (imdb_id && !/^tt\d{7,8}$/.test(imdb_id)) {
            return res.status(400).json({ error: 'Invalid IMDB ID format' });
        }

        // Build dynamic update query
        const updates = [];
        const values = [];
        let paramCount = 0;

        if (title !== undefined) {
            paramCount++;
            updates.push(`title = $${paramCount}`);
            values.push(title);
        }
        if (description !== undefined) {
            paramCount++;
            updates.push(`description = $${paramCount}`);
            values.push(description);
        }
        if (year !== undefined) {
            paramCount++;
            updates.push(`year = $${paramCount}`);
            values.push(year || null);
        }
        if (genre !== undefined) {
            const normalizedGenreString = normalizeGenres(genre).join(', ');
            paramCount++;
            updates.push(`genre = $${paramCount}`);
            values.push(normalizedGenreString || null);
        }
        if (magnet !== undefined) {
            // Check for duplicate magnet (excluding current movie)
            console.log('🔍 Checking for duplicate magnet on update...');
            const duplicateCheck = await pool.query(
                'SELECT id, title FROM movies WHERE magnet = $1 AND id != $2',
                [magnet, id]
            );
            if (duplicateCheck.rows.length > 0) {
                return res.status(409).json({
                    error: 'Another movie with this magnet link already exists',
                    existing_movie: duplicateCheck.rows[0]
                });
            }

            paramCount++;
            updates.push(`magnet = $${paramCount}`);
            values.push(magnet);

            const infoHash = extractInfoHash(magnet);
            paramCount++;
            updates.push(`info_hash = $${paramCount}`);
            values.push(infoHash);

            // Re-analyze torrent and update files
            console.log('🔍 Re-analyzing torrent for updated magnet link...');
            const torrentInfo = await analyzeTorrent(magnet);
            paramCount++;
            updates.push(`torrent_files = $${paramCount}`);
            values.push(torrentInfo?.files ? JSON.stringify(torrentInfo.files) : null);
        }
        if (poster_url !== undefined) {
            paramCount++;
            updates.push(`poster_url = $${paramCount}`);
            values.push(poster_url || null);
        }
        if (imdb_id !== undefined) {
            paramCount++;
            updates.push(`imdb_id = $${paramCount}`);
            values.push(imdb_id || null);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);

        const query = `
            UPDATE movies 
            SET ${updates.join(', ')} 
            WHERE id = $${paramCount + 1} 
            RETURNING *
        `;

        console.log('💾 Updating movie in database...');

        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Movie not found' });
        }

        const movie = result.rows[0];
        
        // Clear caches
        try {
            const keys = await redis.keys('movies:*');
            if (keys.length > 0) {
                await redis.del(keys);
            }
            await redis.del(`movie:${id}`); // Clear specific movie cache
            await redis.del('movies:genres');
            await redis.del('movies:stats');
            console.log('✅ Redis caches cleared');
        } catch (redisError) {
            console.warn('⚠️ Failed to clear Redis caches for PUT:', redisError.message);
        }

        console.log(`✅ Movie updated successfully: "${movie.title}" (ID: ${id})`);
        
        const response = {
            ...movie,
            normalizedGenres: normalizeGenres(movie.genre),
            displayGenres: movie.genre ? formatGenresForDisplay(normalizeGenres(movie.genre)) : null,
            hasValidMagnet: validateMagnetLink(movie.magnet)
        };

        res.json(response);

    } catch (error) {
        console.error('❌ Error updating movie:', error);
        res.status(500).json({ 
            error: 'Failed to update movie',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Delete movie (admin only) - keep your existing delete route as it works
router.delete('/:id', writeLimiter, auth, async (req, res) => {
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    console.log('🎬 DELETE /api/movies/:id - Delete movie request received');
    console.log('Movie ID:', req.params.id);
    console.log('Auth user:', req.user ? req.user.username : 'NO USER');

    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const { id } = req.params;
        
        if (!id || (isNaN(parseInt(id)) && !validator.isUUID(id))) {
            return res.status(400).json({ error: 'Invalid movie ID format' }); // This line needs to be fixed too
        }

        const movieResult = await pool.query('SELECT * FROM movies WHERE id = $1', [id]);
        
        if (movieResult.rows.length === 0) {
            return res.status(404).json({ error: 'Movie not found' });
        }

        const movie = movieResult.rows[0];

        await pool.query('DELETE FROM streaming_sessions WHERE movie_id = $1', [id]);
        await pool.query('DELETE FROM movies WHERE id = $1', [id]);

        // Clear caches
        try {
            const keys = await redis.keys('movies:*');
            if (keys.length > 0) {
                await redis.del(keys);
            }
            await redis.del(`movie:${id}`); // Clear specific movie cache
            await redis.del('movies:genres');
            await redis.del('movies:stats');
            console.log('✅ Redis caches cleared');
        } catch (redisError) {
            console.warn('⚠️ Failed to clear Redis caches for DELETE:', redisError.message);
        }

        console.log(`✅ Movie deleted successfully: "${movie.title}" (ID: ${id})`);
        
        res.json({ 
            message: 'Movie deleted successfully',
            deleted_movie: {
                id: movie.id,
                title: movie.title
            }
        });

    } catch (error) {
        console.error('❌ Error deleting movie:', error);
        res.status(500).json({ 
            error: 'Failed to delete movie',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Normalize genres (admin only)
router.post('/admin/normalize-genres', writeLimiter, auth, async (req, res) => {
    // Check if user is admin
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    console.log('🔄 POST /api/movies/admin/normalize-genres - Normalize genres request received');
    console.log('Auth user:', req.user ? req.user.username : 'NO USER');

    try {
        console.log('🔄 Starting bulk genre normalization...');
        
        const result = await pool.query('SELECT id, genre FROM movies WHERE genre IS NOT NULL AND genre != \'\'');
        
        let updated = 0;
        
        for (const movie of result.rows) {
            const normalizedGenres = normalizeGenres(movie.genre);
            const normalizedGenreString = normalizedGenres.join(', ');
            
            if (normalizedGenreString !== movie.genre) {
                await pool.query(
                    'UPDATE movies SET genre = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                    [normalizedGenreString, movie.id]
                );
                updated++;
            }
        }
        
        // Clear caches
        try {
            const keys = await redis.keys('movies:*');
            if (keys.length > 0) {
                await redis.del(keys);
            }
            await redis.del('movies:genres');
            await redis.del('movies:stats');
            console.log('✅ Redis caches cleared');
        } catch (redisError) {
            console.warn('⚠️ Failed to clear Redis caches for genre normalization:', redisError.message);
        }
        
        console.log(`✅ Genre normalization complete: ${updated}/${result.rows.length} movies updated`);
        res.json({ 
            message: `Successfully normalized genres for ${updated} movies`,
            updated: updated,
            total: result.rows.length,
            skipped: result.rows.length - updated
        });
        
    } catch (error) {
        console.error('❌ Error normalizing genres:', error);
        res.status(500).json({ 
            error: 'Failed to normalize genres',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// PUBLIC READ ROUTES (require user authentication)

// Get all movies with pagination (requires user auth)
router.get('/', readLimiter, userAuth, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            genre,
            year,
            search,
            sort = 'created_at',
            order = 'DESC'
        } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        const allowedSortFields = ['created_at', 'updated_at', 'title', 'year'];
        const allowedOrder = ['ASC', 'DESC'];
        const sortField = allowedSortFields.includes(sort) ? sort : 'created_at';
        const sortOrder = allowedOrder.includes(order.toUpperCase()) ? order.toUpperCase() : 'DESC';

        const userId = req.user.id;
        const cacheKey = `movies:${userId}:${pageNum}:${limitNum}:${genre || 'all'}:${year || 'all'}:${search || 'none'}:${sortField}:${sortOrder}`;
        
        const cached = await redis.get(cacheKey);
        if (cached) {
            console.log('📦 Serving movies from cache');
            return res.json(JSON.parse(cached));
        }
        let query = `
            SELECT m.*, 
                   wt.watch_time_seconds,
                   wt.total_duration_seconds,
                   wt.is_completed,
                   wt.last_watched_at
            FROM movies m
            LEFT JOIN user_watch_time wt ON m.id = wt.movie_id AND wt.user_id = $1
            WHERE 1=1
        `;
        const params = [userId];
        let paramCount = 1;

        if (genre && genre !== 'all') {
            paramCount++;
            query += ` AND LOWER(genre) LIKE $${paramCount}`;
            params.push(`%${genre.toLowerCase()}%`);
        }

        if (year) {
            paramCount++;
            query += ` AND year = $${paramCount}`;
            params.push(parseInt(year));
        }

        if (search) {
            paramCount++;
            query += ` AND (LOWER(title) LIKE $${paramCount} OR LOWER(description) LIKE $${paramCount})`;
            params.push(`%${search.toLowerCase()}%`);
        }

        query += ` ORDER BY ${sortField} ${sortOrder} LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limitNum, offset);

        let countQuery = 'SELECT COUNT(*) FROM movies WHERE 1=1';
        const countParams = [];
        let countParamCount = 0;

        if (genre && genre !== 'all') {
            countParamCount++;
            countQuery += ` AND LOWER(genre) LIKE $${countParamCount}`;
            countParams.push(`%${genre.toLowerCase()}%`);
        }

        if (year) {
            countParamCount++;
            countQuery += ` AND year = $${countParamCount}`;
            countParams.push(parseInt(year));
        }

        if (search) {
            countParamCount++;
            countQuery += ` AND (LOWER(title) LIKE $${countParamCount} OR LOWER(description) LIKE $${countParamCount})`;
            countParams.push(`%${search.toLowerCase()}%`);
        }

        const [result, countResult] = await Promise.all([
            pool.query(query, params),
            pool.query(countQuery, countParams)
        ]);

        const movies = result.rows.map(movie => ({
            ...movie,
            normalizedGenres: normalizeGenres(movie.genre),
            displayGenres: movie.genre ? formatGenresForDisplay(normalizeGenres(movie.genre)) : null,
            hasValidMagnet: validateMagnetLink(movie.magnet),
            infoHash: movie.info_hash || extractInfoHash(movie.magnet),
            watchProgress: movie.watch_time_seconds ? {
                watchTimeSeconds: movie.watch_time_seconds,
                totalDurationSeconds: movie.total_duration_seconds,
                isCompleted: movie.is_completed,
                lastWatchedAt: movie.last_watched_at,
                progress: movie.total_duration_seconds ? 
                    Math.round((movie.watch_time_seconds / movie.total_duration_seconds) * 100) : 0
            } : null
        }));

        const totalCount = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(totalCount / limitNum);

        const response = {
            movies,
            pagination: {
                current_page: pageNum,
                total_pages: totalPages,
                total_count: totalCount,
                per_page: limitNum,
                has_next: pageNum < totalPages,
                has_prev: pageNum > 1
            },
            filters: {
                genre: genre || null,
                year: year || null,
                search: search || null
            }
        };

        await redis.setEx(cacheKey, 300, JSON.stringify(response));
        
        console.log(`📚 Served ${movies.length} movies (page ${pageNum}/${totalPages})`);
        res.json(response);

    } catch (error) {
        console.error('❌ Error fetching movies:', error);
        res.status(500).json({ 
            error: 'Failed to fetch movies',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Get single movie (requires user auth)
router.get('/:id', readLimiter, userAuth, async (req, res) => {
    try {
        const { id } = req.params;

        if (!id || (isNaN(parseInt(id)) && !validator.isUUID(id))) {
            return res.status(400).json({ error: 'Invalid movie ID format' }); // This line needs to be fixed too
        }

        const cacheKey = `movie:${id}`;
        const cached = await redis.get(cacheKey);
        if (cached) {
            return res.json(JSON.parse(cached));
        }

        const userId = req.user.id;
        const result = await pool.query(`
            SELECT m.*, 
                   COALESCE(COUNT(s.id), 0) as play_count,
                   wt.watch_time_seconds,
                   wt.total_duration_seconds,
                   wt.is_completed,
                   wt.last_watched_at
            FROM movies m
            LEFT JOIN streaming_sessions s ON m.id = s.movie_id
            LEFT JOIN user_watch_time wt ON m.id = wt.movie_id AND wt.user_id = $2
            WHERE m.id = $1
            GROUP BY m.id, wt.watch_time_seconds, wt.total_duration_seconds, wt.is_completed, wt.last_watched_at
        `, [id, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Movie not found' });
        }

        const movie = result.rows[0];
        
        const enhancedMovie = {
            ...movie,
            normalizedGenres: normalizeGenres(movie.genre),
            displayGenres: movie.genre ? formatGenresForDisplay(normalizeGenres(movie.genre)) : null,
            hasValidMagnet: validateMagnetLink(movie.magnet),
            play_count: parseInt(movie.play_count) || 0,
            watchProgress: movie.watch_time_seconds ? {
                watchTimeSeconds: movie.watch_time_seconds,
                totalDurationSeconds: movie.total_duration_seconds,
                isCompleted: movie.is_completed,
                lastWatchedAt: movie.last_watched_at,
                progress: movie.total_duration_seconds ? 
                    Math.round((movie.watch_time_seconds / movie.total_duration_seconds) * 100) : 0
            } : null
        };

        await redis.setEx(cacheKey, 600, JSON.stringify(enhancedMovie));
        res.json(enhancedMovie);
    } catch (error) {
        console.error('❌ Error fetching movie:', error);
        res.status(500).json({ 
            error: 'Failed to fetch movie',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Get genres (requires user auth)
router.get('/meta/genres', readLimiter, userAuth, async (req, res) => {
    try {
        const cacheKey = 'movies:genres';
        const cached = await redis.get(cacheKey);
        
        if (cached) {
            return res.json(JSON.parse(cached));
        }

        const result = await pool.query(`
            SELECT DISTINCT genre FROM movies 
            WHERE genre IS NOT NULL AND genre != ''
        `);
        
        const allGenres = new Set();
        
        result.rows.forEach(row => {
            const normalizedGenres = normalizeGenres(row.genre);
            normalizedGenres.forEach(genre => allGenres.add(genre));
        });
        
        const genres = Array.from(allGenres)
            .sort()
            .map(genre => ({
                value: genre,
                label: formatGenresForDisplay([genre])
            }));
        
        const response = { genres, total_count: genres.length };

        await redis.setEx(cacheKey, 3600, JSON.stringify(response));
        res.json(response);
    } catch (error) {
        console.error('❌ Error fetching genres:', error);
        res.status(500).json({ 
            error: 'Failed to fetch genres',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Get stats (requires user auth)
router.get('/meta/stats', readLimiter, userAuth, async (req, res) => {
    try {
        const cacheKey = 'movies:stats';
        const cached = await redis.get(cacheKey);
        
        if (cached) {
            return res.json(JSON.parse(cached));
        }

        const statsQuery = `
            SELECT 
                COUNT(*) as total_movies,
                COUNT(DISTINCT genre) as unique_genres,
                MIN(year) as oldest_year,
                MAX(year) as newest_year,
                AVG(year) as average_year,
                COUNT(CASE WHEN poster_url IS NOT NULL THEN 1 END) as movies_with_posters,
                COUNT(CASE WHEN imdb_id IS NOT NULL THEN 1 END) as movies_with_imdb
            FROM movies
        `;

        const result = await pool.query(statsQuery);
        const stats = result.rows[0];

        const genreQuery = `
            SELECT genre, COUNT(*) as count
            FROM movies 
            WHERE genre IS NOT NULL AND genre != ''
            GROUP BY genre
            ORDER BY count DESC
            LIMIT 10
        `;

        const genreResult = await pool.query(genreQuery);
        
        const response = {
            ...stats,
            total_movies: parseInt(stats.total_movies),
            unique_genres: parseInt(stats.unique_genres),
            oldest_year: parseInt(stats.oldest_year),
            newest_year: parseInt(stats.newest_year),
            average_year: Math.round(parseFloat(stats.average_year)),
            movies_with_posters: parseInt(stats.movies_with_posters),
            movies_with_imdb: parseInt(stats.movies_with_imdb),
            top_genres: genreResult.rows.map(row => ({
                genre: row.genre,
                count: parseInt(row.count)
            }))
        };

        await redis.setEx(cacheKey, 1800, JSON.stringify(response));
        res.json(response);
    } catch (error) {
        console.error('❌ Error fetching stats:', error);
        res.status(500).json({ 
            error: 'Failed to fetch statistics',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

module.exports = router;
