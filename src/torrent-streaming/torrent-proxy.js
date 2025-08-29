const express = require('express');
const path = require('path');

// Use torrent-stream for server-side torrenting (more reliable than WebTorrent for servers)
let torrentStream;
try {
    torrentStream = require('torrent-stream');
} catch (err) {
    console.warn('torrent-stream not installed, server-side streaming disabled');
}

class TorrentStreamingProxy {
    constructor() {
        this.app = express();
        this.activeEngines = new Map();
        this.persistentEngines = new Map(); // For 24-hour caching
        this.watchProgress = new Map(); // Track watch progress per movie
        this.setupMiddleware();
        this.setupRoutes();
        this.setupCleanup();
        this.startPersistentCacheManager();
    }

    setupMiddleware() {
        // CORS headers for cross-origin requests
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            if (req.method === 'OPTIONS') {
                res.sendStatus(200);
            } else {
                next();
            }
        });

        // JSON parsing
        this.app.use(express.json());
    }

    setupRoutes() {
        // Root route to prevent 403 on direct access
        this.app.get('/', (req, res) => {
            res.json({ 
                status: 'Torrent Streaming Service',
                version: '1.0.0',
                endpoints: [
                    'GET /api/torrent/health',
                    'GET /api/torrent/info/:magnetHash',
                    'GET /api/torrent/stream/:magnetHash/:fileIndex'
                ]
            });
        });

        // Health check
        this.app.get('/api/torrent/health', (req, res) => {
            res.json({
                status: 'ready',
                activeStreams: this.activeEngines.size,
                persistentStreams: this.persistentEngines.size,
                timestamp: new Date().toISOString(),
                available: !!torrentStream
            });
        });

        // Update watch progress endpoint
        this.app.post('/api/torrent/progress', (req, res) => {
            const { magnetHash, progress } = req.body;
            
            if (!magnetHash || progress === undefined) {
                return res.status(400).json({ error: 'magnetHash and progress are required' });
            }
            
            this.updateWatchProgress(magnetHash, progress);
            res.json({ success: true, progress });
        });

        if (!torrentStream) {
            // If torrent-stream isn't available, return appropriate errors
            this.app.use('/api/torrent/*', (req, res) => {
                res.status(503).json({
                    error: 'Server-side torrent streaming not available',
                    message: 'Please install torrent-stream: npm install torrent-stream'
                });
            });
            return;
        }

        // Get torrent info
        this.app.get('/api/torrent/info/:magnetHash', (req, res) => {
            const magnetHash = decodeURIComponent(req.params.magnetHash);
            console.log('🔍 Getting torrent info for:', magnetHash);

            const engine = torrentStream(magnetHash, {
                tmp: '/tmp',
                verify: false,
                dht: true,
                tracker: true
            });

            const timeout = setTimeout(() => {
                if (!res.headersSent) {
                    res.status(408).json({ error: 'Torrent info timeout' });
                    engine.destroy();
                }
            }, 30000);

            engine.on('ready', () => {
                clearTimeout(timeout);
                
                const videoFiles = engine.files.filter(file => 
                    /\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(file.name)
                );

                res.json({
                    name: engine.torrent.name || 'Unknown',
                    infoHash: engine.infoHash,
                    length: engine.torrent.length,
                    files: videoFiles.map((file, index) => ({
                        name: file.name,
                        length: file.length,
                        index: engine.files.indexOf(file)
                    }))
                });

                // Keep engine alive for a bit, then clean up
                setTimeout(() => {
                    engine.destroy();
                }, 10000);
            });

            engine.on('error', (err) => {
                clearTimeout(timeout);
                console.error('Torrent error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: err.message });
                }
            });
        });

        // Stream video file
        this.app.get('/api/torrent/stream/:magnetHash/:fileIndex', (req, res) => {
            const magnetHash = decodeURIComponent(req.params.magnetHash);
            const fileIndex = parseInt(req.params.fileIndex);
            
            console.log(`🎬 Streaming file ${fileIndex} from torrent`);

            // Use persistent engine for better caching
            const engine = this.getOrCreatePersistentEngine(magnetHash);

            engine.on('ready', () => {
                const file = engine.files[fileIndex];
                if (!file) {
                    res.status(404).send('File not found');
                    engine.destroy();
                    return;
                }

                console.log(`📡 Streaming: ${file.name} (${file.length} bytes)`);
                
                const range = req.headers.range;
                const fileSize = file.length;
                
                // Set content type based on file extension
                const ext = path.extname(file.name).toLowerCase();
                const contentTypes = {
                    '.mp4': 'video/mp4',
                    '.mkv': 'video/x-matroska',
                    '.webm': 'video/webm',
                    '.avi': 'video/x-msvideo',
                    '.mov': 'video/quicktime'
                };
                
                const contentType = contentTypes[ext] || 'video/mp4';
                
                if (range) {
                    // Handle range requests (for seeking)
                    const parts = range.replace(/bytes=/, '').split('-');
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                    const chunkSize = (end - start) + 1;

                    res.writeHead(206, {
                        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                        'Accept-Ranges': 'bytes',
                        'Content-Length': chunkSize,
                        'Content-Type': contentType,
                        'Cache-Control': 'no-cache'
                    });

                    const stream = file.createReadStream({ start, end });
                    stream.pipe(res);

                    stream.on('error', (err) => {
                        console.error('Stream error:', err);
                        if (!res.headersSent) res.status(500).end();
                    });
                } else {
                    // Stream entire file
                    res.writeHead(200, {
                        'Content-Length': fileSize,
                        'Content-Type': contentType,
                        'Accept-Ranges': 'bytes',
                        'Cache-Control': 'no-cache'
                    });

                    const stream = file.createReadStream();
                    stream.pipe(res);

                    stream.on('error', (err) => {
                        console.error('Stream error:', err);
                        if (!res.headersSent) res.status(500).end();
                    });
                }

                // Store engine for cleanup
                const streamId = `${magnetHash}-${fileIndex}`;
                this.activeEngines.set(streamId, { engine, lastAccess: Date.now() });

                // Cleanup on disconnect
                req.on('close', () => {
                    console.log('Client disconnected');
                    this.activeEngines.delete(streamId);
                    engine.destroy();
                });
            });

            engine.on('error', (err) => {
                console.error('Engine error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: err.message });
                }
            });
        });
    }

    setupCleanup() {
        // Clean up inactive engines every 5 minutes
        setInterval(() => {
            const now = Date.now();
            const maxAge = 10 * 60 * 1000; // 10 minutes

            for (const [streamId, { engine, lastAccess }] of this.activeEngines) {
                if (now - lastAccess > maxAge) {
                    console.log('🧹 Cleaning up inactive stream:', streamId);
                    engine.destroy();
                    this.activeEngines.delete(streamId);
                }
            }
        }, 5 * 60 * 1000);
    }

    startPersistentCacheManager() {
        // Manage persistent cache every hour
        setInterval(() => {
            this.cleanupPersistentCache();
        }, 3600000); // 1 hour
    }

    cleanupPersistentCache() {
        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
        
        for (const [magnetHash, { engine, lastAccess, watchProgress }] of this.persistentEngines) {
            const timeSinceLastAccess = now - lastAccess;
            
            // If watched completely (90% or more), remove immediately
            if (watchProgress >= 0.9) {
                console.log(`🗑️ Removing completed movie from cache: ${magnetHash}`);
                engine.destroy();
                this.persistentEngines.delete(magnetHash);
                this.watchProgress.delete(magnetHash);
            }
            // If not watched completely and older than 24 hours, remove
            else if (timeSinceLastAccess > twentyFourHours) {
                console.log(`🗑️ Removing old incomplete movie from cache: ${magnetHash} (${Math.round(timeSinceLastAccess / 3600000)}h old)`);
                engine.destroy();
                this.persistentEngines.delete(magnetHash);
                this.watchProgress.delete(magnetHash);
            }
            // Keep in cache if watched partially and less than 24 hours old
            else {
                console.log(`💾 Keeping movie in cache: ${magnetHash} (${Math.round(timeSinceLastAccess / 3600000)}h old, ${Math.round(watchProgress * 100)}% watched)`);
            }
        }
    }

    updateWatchProgress(magnetHash, progress) {
        // progress should be between 0 and 1 (0% to 100%)
        this.watchProgress.set(magnetHash, Math.max(0, Math.min(1, progress)));
        
        // Update last access time for persistent engines
        if (this.persistentEngines.has(magnetHash)) {
            const engineData = this.persistentEngines.get(magnetHash);
            engineData.lastAccess = Date.now();
            engineData.watchProgress = this.watchProgress.get(magnetHash);
            this.persistentEngines.set(magnetHash, engineData);
        }
        
        console.log(`📊 Watch progress updated for ${magnetHash}: ${Math.round(progress * 100)}%`);
    }

    getOrCreatePersistentEngine(magnetHash) {
        // Check if we already have a persistent engine for this magnet
        if (this.persistentEngines.has(magnetHash)) {
            const engineData = this.persistentEngines.get(magnetHash);
            engineData.lastAccess = Date.now();
            this.persistentEngines.set(magnetHash, engineData);
            console.log(`♻️ Reusing persistent engine for: ${magnetHash}`);
            return engineData.engine;
        }

        // Create new persistent engine with aggressive settings
        console.log(`🚀 Creating new persistent engine for: ${magnetHash}`);
        const engine = torrentStream(magnetHash, {
            tmp: '/tmp/torrents',
            verify: false,
            dht: true,
            tracker: true,
            // Aggressive preloading settings
            preload: true,
            preloadSize: 50 * 1024 * 1024, // 50MB preload buffer
            // Enhanced connection settings
            maxConns: 20,
            downloadLimit: -1, // No download limit
            uploadLimit: 2000, // 2MB/s upload limit
            // Keep alive settings
            keepAlive: true,
            keepAliveInterval: 30000 // 30 seconds
        });

        // Store in persistent cache
        this.persistentEngines.set(magnetHash, {
            engine,
            lastAccess: Date.now(),
            watchProgress: 0
        });

        // Add periodic status monitoring
        const statusInterval = setInterval(() => {
            try {
                if (engine && !engine.destroyed) {
                    const progress = engine.progress || 0;
                    const downloadSpeed = engine.downloadSpeed || 0;
                    const numPeers = engine.numPeers || 0;
                    const numSeeds = engine.numSeeds || 0;
                    
                    console.log(`📊 Status for ${magnetHash.substring(0, 20)}...: ${Math.round(progress * 100)}% | ${this.formatBytes(downloadSpeed)}/s | Peers: ${numPeers} | Seeds: ${numSeeds}`);
                    
                    // If no peers and no download for 30 seconds, log warning
                    if (numPeers === 0 && downloadSpeed === 0) {
                        console.warn(`⚠️ No peers available for ${magnetHash.substring(0, 20)}...`);
                    }
                } else {
                    clearInterval(statusInterval);
                }
            } catch (error) {
                console.warn('Error in status monitoring:', error);
            }
        }, 10000); // Check every 10 seconds

        // Set up engine event handlers
        engine.on('ready', () => {
            console.log(`✅ Persistent engine ready for: ${magnetHash}`);
            console.log(`📊 Torrent info: ${engine.torrent.name}`);
            console.log(`📁 Files: ${engine.files.length}`);
            console.log(`📦 Total size: ${this.formatBytes(engine.torrent.length)}`);
        });

        engine.on('download', () => {
            // Update progress periodically
            try {
                const progress = engine.progress || 0;
                const downloadSpeed = engine.downloadSpeed || 0;
                const uploadSpeed = engine.uploadSpeed || 0;
                const numPeers = engine.numPeers || 0;
                const numSeeds = engine.numSeeds || 0;
                
                if (progress > 0) {
                    this.updateWatchProgress(magnetHash, progress);
                    console.log(`📥 Download progress: ${Math.round(progress * 100)}% | Speed: ${this.formatBytes(downloadSpeed)}/s | Peers: ${numPeers} | Seeds: ${numSeeds}`);
                }
            } catch (error) {
                console.warn('Error in download event handler:', error);
            }
        });

        engine.on('wire', (wire) => {
            console.log(`🔗 New peer connected: ${wire.peerAddress}`);
        });

        engine.on('error', (err) => {
            console.error(`❌ Persistent engine error for ${magnetHash}:`, err);
        });

        return engine;
    }

    formatBytes(bytes) {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    start(port = 7000) {
        return new Promise((resolve, reject) => {
            try {
                this.app.listen(port, () => {
                    console.log(`🎬 Torrent streaming proxy running on port ${port}`);
                    resolve();
                });
            } catch (error) {
                reject(error);
            }
        });
    }
}

module.exports = TorrentStreamingProxy;
