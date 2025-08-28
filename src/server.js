const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const db = require('./db/db');
const authRoutes = require('./routes/auth');
const movieRoutes = require('./routes/movies');
const streamRoutes = require('./routes/stream');
const userRoutes = require('./routes/users');
const watchTimeRoutes = require('./routes/watchTime');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip}`);
  next();
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.jsdelivr.net",
        "https://cdn.tailwindcss.com"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'", 
        "'unsafe-inline'",
        "https://fonts.googleapis.com"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com"
      ],
      connectSrc: ["'self'", "ws:", "wss:", "blob:"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      mediaSrc: ["'self'", "blob:", "data:"],
      objectSrc: ["'none'"]
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: NODE_ENV === 'production' ? false : '*',
  credentials: true
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: NODE_ENV === 'production' ? 100 : 1000,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Proxy torrent requests to the torrent streaming service
app.use('/api/torrent', createProxyMiddleware({
    target: 'http://localhost:7000',
    changeOrigin: true,
    pathRewrite: {
        '^/api/torrent': '/api/torrent'
    },
    onError: (err, req, res) => {
        console.error('❌ Torrent proxy error:', err.message);
        res.status(503).json({ 
            error: 'Torrent streaming service unavailable',
            message: 'Server-side streaming is currently disabled. Using WebTorrent fallback.'
        });
    },
    onProxyReq: (proxyReq, req, res) => {
        console.log(`🔄 Proxying ${req.method} ${req.url} to torrent service`);
        // Forward authorization header if present
        if (req.headers.authorization) {
            proxyReq.setHeader('Authorization', req.headers.authorization);
        }
    }
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/movies', movieRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/users', userRoutes);
app.use('/api/watch-time', watchTimeRoutes);


// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await db.pool.query('SELECT 1');
    await db.redis.ping();
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: NODE_ENV
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Serve static pages
app.get('/', async (req, res) => {
  // Check if any users exist to determine if app is locked down
  try {
    const usersExist = await fetch('http://localhost:3000/api/auth/users-exist');
    const data = await usersExist.json();
    
    if (!data.exists) {
      // No users exist, redirect to admin setup
      return res.redirect('/admin');
    }
    
    // Users exist, serve the main app (which will handle auth on frontend)
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (error) {
    console.error('Error checking users:', error);
    // Fallback to serving main app
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/player/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  if (NODE_ENV === 'production') {
    res.status(500).json({ error: 'Internal server error' });
  } else {
    res.status(500).json({ 
      error: 'Internal server error',
      message: err.message,
      stack: err.stack 
    });
  }
});

// Graceful shutdown handling
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown(signal) {
  console.log(`Received ${signal}. Starting graceful shutdown...`);
  
  server.close(async (err) => {
    if (err) {
      console.error('Error during server shutdown:', err);
      process.exit(1);
    }
    
    try {
      await db.pool.end();
      await db.redis.disconnect();
      console.log('Database connections closed');
      
      console.log('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('Error closing database connections:', error);
      process.exit(1);
    }
  });
}

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (NODE_ENV === 'production') {
    process.exit(1);
  }
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

let server;

// Async startup function with proper error handling
async function startServer() {
  try {
    // Initialize database first
    await db.init();
    console.log('✅ Database initialized successfully');
    
    // Start main Express server
    server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🎬 Movie Streamer running on port ${PORT}`);
      console.log(`🌍 Environment: ${NODE_ENV}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    });
    
    // Handle server errors
    server.on('error', (error) => {
      console.error('Server error:', error);
      process.exit(1);
    });

    // Start torrent proxy service (non-blocking)
    startTorrentProxy().catch(err => {
      console.error('⚠️ Torrent streaming service failed to start:', err.message);
      console.log('🔄 App will continue without server-side torrent streaming');
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Async function to start torrent proxy
async function startTorrentProxy() {
  try {
    console.log('🚀 Starting torrent streaming service...');
    
    const TorrentStreamingProxy = require('./torrent-streaming/torrent-proxy');
    const torrentProxy = new TorrentStreamingProxy();
    
    // Wait for initialization (this handles the async WebTorrent import)
    await torrentProxy.start(7000);
    console.log('✅ Torrent streaming proxy started successfully');
    
  } catch (error) {
    console.error('❌ Failed to start torrent proxy:', error);
    throw error;
  }
}

// Start everything
startServer();
