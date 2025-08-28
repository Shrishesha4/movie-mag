const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/db');
const auth = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiting for user operations
const userLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { error: 'Too many user operations, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Admin middleware - ensure user is admin
const adminAuth = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

// Get all users (admin only)
router.get('/', userLimiter, auth, adminAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, username, email, is_active, created_at, updated_at 
            FROM users 
            ORDER BY created_at DESC
        `);
        
        res.json({ users: result.rows });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// Create new user (admin only)
router.post('/', userLimiter, auth, adminAuth, async (req, res) => {
    try {
        const { username, password, email } = req.body;
        
        // Validation
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        
        if (username.length < 3) {
            return res.status(400).json({ error: 'Username must be at least 3 characters long' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters long' });
        }
        
        // Check if username already exists
        const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Username already exists' });
        }
        
        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);
        
        // Create user
        const result = await pool.query(`
            INSERT INTO users (username, password_hash, email) 
            VALUES ($1, $2, $3) 
            RETURNING id, username, email, is_active, created_at
        `, [username, passwordHash, email || null]);
        
        const user = result.rows[0];
        
        console.log(`✅ User '${username}' created successfully by admin`);
        res.status(201).json({ 
            message: 'User created successfully',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                is_active: user.is_active,
                created_at: user.created_at
            }
        });
        
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// Update user (admin only)
router.put('/:id', userLimiter, auth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { username, email, is_active, password } = req.body;
        
        // Check if user exists
        const existingUser = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        if (existingUser.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const updates = [];
        const values = [];
        let paramCount = 0;
        
        if (username !== undefined) {
            if (username.length < 3) {
                return res.status(400).json({ error: 'Username must be at least 3 characters long' });
            }
            
            // Check if new username conflicts with existing user
            const usernameCheck = await pool.query(
                'SELECT id FROM users WHERE username = $1 AND id != $2', 
                [username, id]
            );
            if (usernameCheck.rows.length > 0) {
                return res.status(409).json({ error: 'Username already exists' });
            }
            
            paramCount++;
            updates.push(`username = $${paramCount}`);
            values.push(username);
        }
        
        if (email !== undefined) {
            paramCount++;
            updates.push(`email = $${paramCount}`);
            values.push(email || null);
        }
        
        if (is_active !== undefined) {
            paramCount++;
            updates.push(`is_active = $${paramCount}`);
            values.push(is_active);
        }
        
        if (password !== undefined) {
            if (password.length < 6) {
                return res.status(400).json({ error: 'Password must be at least 6 characters long' });
            }
            
            const passwordHash = await bcrypt.hash(password, 12);
            paramCount++;
            updates.push(`password_hash = $${paramCount}`);
            values.push(passwordHash);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }
        
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);
        
        const query = `
            UPDATE users 
            SET ${updates.join(', ')} 
            WHERE id = $${paramCount + 1} 
            RETURNING id, username, email, is_active, created_at, updated_at
        `;
        
        const result = await pool.query(query, values);
        const user = result.rows[0];
        
        console.log(`✅ User '${user.username}' updated successfully by admin`);
        res.json({ 
            message: 'User updated successfully',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                is_active: user.is_active,
                created_at: user.created_at,
                updated_at: user.updated_at
            }
        });
        
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

// Delete user (admin only)
router.delete('/:id', userLimiter, auth, adminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if user exists
        const existingUser = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
        if (existingUser.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const username = existingUser.rows[0].username;
        
        // Delete user
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        
        console.log(`✅ User '${username}' deleted successfully by admin`);
        res.json({ 
            message: 'User deleted successfully',
            deleted_user: { id, username }
        });
        
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// Get user statistics (admin only)
router.get('/stats', userLimiter, auth, adminAuth, async (req, res) => {
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN is_active = true THEN 1 END) as active_users,
                COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_users,
                COUNT(CASE WHEN email IS NOT NULL THEN 1 END) as users_with_email,
                MIN(created_at) as oldest_user,
                MAX(created_at) as newest_user
            FROM users
        `;
        
        const result = await pool.query(statsQuery);
        const stats = result.rows[0];
        
        res.json({
            total_users: parseInt(stats.total_users),
            active_users: parseInt(stats.active_users),
            inactive_users: parseInt(stats.inactive_users),
            users_with_email: parseInt(stats.users_with_email),
            oldest_user: stats.oldest_user,
            newest_user: stats.newest_user
        });
        
    } catch (error) {
        console.error('Error fetching user stats:', error);
        res.status(500).json({ error: 'Failed to fetch user statistics' });
    }
});

module.exports = router;
