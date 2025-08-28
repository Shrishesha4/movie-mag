const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/db');
const auth = require('../middleware/auth');
const userAuth = require('../middleware/userAuth');

const router = express.Router();

// Check if admin exists
router.get('/admin-exists', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM admin_users');
    const exists = parseInt(result.rows[0].count, 10) > 0;
    res.json({ exists });
  } catch (error) {
    console.error('Admin exists check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if any users exist (for determining if app is locked down)
router.get('/users-exist', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM users WHERE is_active = true');
    const exists = parseInt(result.rows[0].count, 10) > 0;
    res.json({ exists });
  } catch (error) {
    console.error('Users exist check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// First-time admin registration
router.post('/register-admin', async (req, res) => {
  try {
    // Check if any admin already exists
    const existingAdmins = await pool.query('SELECT COUNT(*) FROM admin_users');
    if (parseInt(existingAdmins.rows[0].count, 10) > 0) {
      return res.status(403).json({ error: 'Admin user already exists' });
    }

    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Hash password and create admin user
    const passwordHash = await bcrypt.hash(password, 12);
    
    await pool.query(
      'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)',
      [username, passwordHash]
    );
    
    console.log(`✅ Admin user '${username}' created successfully`);
    res.json({ success: true, message: 'Admin user created successfully. Please log in.' });
  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({ error: 'Failed to create admin user' });
  }
});

// Admin login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const result = await pool.query(
      'SELECT * FROM admin_users WHERE username = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log(`✅ Admin '${username}' logged in successfully`);
    res.json({ token, username: user.username, role: 'admin' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User login (for regular users)
router.post('/user-login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials or account disabled' });
    }
    
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    console.log(`✅ User '${username}' logged in successfully`);
    res.json({ token, username: user.username, role: 'user' });
  } catch (error) {
    console.error('User login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin token verification
router.get('/verify', auth, async (req, res) => {
    res.json({ 
        valid: true,
        username: req.user.username,
        role: req.user.role
    });
});

// User token verification
router.get('/user-verify', userAuth, async (req, res) => {
    res.json({ 
        valid: true,
        username: req.user.username,
        role: req.user.role
    });
});

module.exports = router;
