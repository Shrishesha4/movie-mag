// const express = require('express');
// const path = require('path');

// class TorrentStreamingProxy {
//     constructor() {
//         this.app = express();
//         this.client = null;
//         this.WebTorrent = null;
//         this.activeStreams = new Map();
        
//         this.initializeWebTorrent();
//         this.setupRoutes();
//         this.setupCleanup();
//     }

//     async initializeWebTorrent() {
//         try {
//             // Use dynamic import for ES modules
//             const { default: WebTorrent } = await import('webtorrent');
//             this.WebTorrent = WebTorrent;
//             this.client = new WebTorrent();
//             console.log('✅ WebTorrent initialized successfully');
//         } catch (error) {
//             console.error('❌ Failed to initialize WebTorrent:', error);
//             throw error;
//         }
//     }

//     setupRoutes() {
//         // Get torrent info (files, metadata)
//         this.app.get('/api/torrent/info/:magnetHash', async (req, res) => {
//             if (!this.client) {
//                 return res.status(503).json({ error: 'WebTorrent not initialized yet' });
//             }

//             try {
//                 const magnetHash = decodeURIComponent(req.params.magnetHash);
//                 console.log('Getting torrent info for:', magnetHash);

//                 const torrent = this.client.add(magnetHash, { 
//                     destroyStoreOnDestroy: true,
//                     skipVerify: false 
//                 });

//                 torrent.on('ready', () => {
//                     const videoFiles = torrent.files.filter(file => 
//                         /\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(file.name)
//                     );

//                     res.json({
//                         name: torrent.name,
//                         infoHash: torrent.infoHash,
//                         length: torrent.length,
//                         files: videoFiles.map(file => ({
//                             name: file.name,
//                             length: file.length,
//                             index: torrent.files.indexOf(file)
//                         }))
//                     });

//                     // Clean up after sending info
//                     setTimeout(() => {
//                         if (this.client) {
//                             this.client.remove(torrent);
//                         }
//                     }, 5000);
//                 });

//                 torrent.on('error', (err) => {
//                     console.error('Torrent error:', err);
//                     res.status(500).json({ error: err.message });
//                 });

//                 // Timeout after 30 seconds
//                 setTimeout(() => {
//                     if (!res.headersSent) {
//                         res.status(408).json({ error: 'Torrent info timeout' });
//                         if (this.client) {
//                             this.client.remove(torrent);
//                         }
//                     }
//                 }, 30000);

//             } catch (error) {
//                 res.status(400).json({ error: 'Invalid magnet link' });
//             }
//         });

//         // Stream video file
//         this.app.get('/api/torrent/stream/:magnetHash/:fileIndex', (req, res) => {
//             if (!this.client) {
//                 return res.status(503).json({ error: 'WebTorrent not initialized yet' });
//             }

//             const magnetHash = decodeURIComponent(req.params.magnetHash);
//             const fileIndex = parseInt(req.params.fileIndex);
            
//             console.log(`🎬 Streaming file ${fileIndex} from torrent:`, magnetHash);

//             const streamId = `${magnetHash}-${fileIndex}`;
            
//             // Check if already streaming
//             if (this.activeStreams.has(streamId)) {
//                 const { torrent } = this.activeStreams.get(streamId);
//                 this.streamFile(torrent, fileIndex, req, res);
//                 return;
//             }

//             const torrent = this.client.add(magnetHash, { 
//                 destroyStoreOnDestroy: true,
//                 strategy: 'sequential' // Better for streaming
//             });

//             torrent.on('ready', () => {
//                 console.log('✅ Torrent ready for streaming');
//                 this.activeStreams.set(streamId, { torrent, lastAccess: Date.now() });
//                 this.streamFile(torrent, fileIndex, req, res);
//             });

//             torrent.on('error', (err) => {
//                 console.error('Streaming error:', err);
//                 res.status(500).json({ error: err.message });
//             });

//             // Cleanup on client disconnect
//             req.on('close', () => {
//                 console.log('Client disconnected, cleaning up stream');
//                 this.activeStreams.delete(streamId);
//                 if (this.client) {
//                     this.client.remove(torrent);
//                 }
//             });
//         });

//         // Health check
//         this.app.get('/api/torrent/health', (req, res) => {
//             res.json({
//                 status: this.client ? 'ready' : 'initializing',
//                 activeStreams: this.activeStreams.size,
//                 activeTorrents: this.client ? this.client.torrents.length : 0,
//                 downloadSpeed: this.client ? this.client.downloadSpeed : 0,
//                 uploadSpeed: this.client ? this.client.uploadSpeed : 0
//             });
//         });
//     }

//     streamFile(torrent, fileIndex, req, res) {
//         const file = torrent.files[fileIndex];
        
//         if (!file) {
//             res.status(404).json({ error: 'File not found' });
//             return;
//         }

//         console.log(`📡 Streaming file: ${file.name} (${file.length} bytes)`);

//         const range = req.headers.range;
//         const fileSize = file.length;

//         // Set appropriate content type
//         const ext = path.extname(file.name).toLowerCase();
//         const contentTypes = {
//             '.mp4': 'video/mp4',
//             '.mkv': 'video/x-matroska',
//             '.webm': 'video/webm',
//             '.avi': 'video/x-msvideo',
//             '.mov': 'video/quicktime'
//         };
        
//         res.setHeader('Content-Type', contentTypes[ext] || 'video/mp4');
//         res.setHeader('Accept-Ranges', 'bytes');
//         res.setHeader('Cache-Control', 'no-cache');

//         if (range) {
//             // Handle range requests for seeking
//             const parts = range.replace(/bytes=/, "").split("-");
//             const start = parseInt(parts[0], 10);
//             const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
//             const chunksize = (end - start) + 1;

//             res.status(206);
//             res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
//             res.setHeader('Content-Length', chunksize);

//             const stream = file.createReadStream({ start, end });
//             stream.pipe(res);

//             stream.on('error', (err) => {
//                 console.error('Stream error:', err);
//                 if (!res.headersSent) {
//                     res.status(500).end();
//                 }
//             });
//         } else {
//             // Stream entire file
//             res.setHeader('Content-Length', fileSize);
//             const stream = file.createReadStream();
//             stream.pipe(res);

//             stream.on('error', (err) => {
//                 console.error('Stream error:', err);
//                 if (!res.headersSent) {
//                     res.status(500).end();
//                 }
//             });
//         }
//     }

//     setupCleanup() {
//         // Clean up inactive streams every 5 minutes
//         setInterval(() => {
//             const now = Date.now();
//             const maxAge = 10 * 60 * 1000; // 10 minutes

//             for (const [streamId, { torrent, lastAccess }] of this.activeStreams) {
//                 if (now - lastAccess > maxAge) {
//                     console.log('🧹 Cleaning up inactive stream:', streamId);
//                     if (this.client) {
//                         this.client.remove(torrent);
//                     }
//                     this.activeStreams.delete(streamId);
//                 }
//             }
//         }, 5 * 60 * 1000);
//     }

//     async start(port = 7000) {
//         // Wait for WebTorrent to initialize
//         while (!this.client) {
//             await new Promise(resolve => setTimeout(resolve, 100));
//         }

//         this.app.listen(port, () => {
//             console.log(`🎬 Torrent streaming proxy running on port ${port}`);
//         });
//     }
// }

// module.exports = TorrentStreamingProxy;







// const express = require('express');
// const torrentStream = require('torrent-stream');
// const path = require('path');

// class TorrentStreamingProxy {
//     constructor() {
//         this.app = express();
//         this.activeEngines = new Map();
//         this.setupRoutes();
//         this.setupCleanup();
//     }

//     setupRoutes() {
//         this.app.get('/api/torrent/stream/:magnetHash/:fileIndex', (req, res) => {
//             const magnetHash = decodeURIComponent(req.params.magnetHash);
//             const fileIndex = parseInt(req.params.fileIndex);
            
//             console.log(`🎬 Streaming file ${fileIndex} from torrent`);

//             const engine = torrentStream(magnetHash, {
//                 tmp: '/tmp/torrents',
//                 verify: false
//             });

//             engine.on('ready', () => {
//                 const file = engine.files[fileIndex];
//                 if (!file) {
//                     return res.status(404).json({ error: 'File not found' });
//                 }

//                 console.log(`📡 Streaming: ${file.name}`);
                
//                 const range = req.headers.range;
//                 const fileSize = file.length;
                
//                 res.setHeader('Content-Type', 'video/mp4');
//                 res.setHeader('Accept-Ranges', 'bytes');
                
//                 if (range) {
//                     const parts = range.replace(/bytes=/, "").split("-");
//                     const start = parseInt(parts[0], 10);
//                     const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                    
//                     res.status(206);
//                     res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
//                     res.setHeader('Content-Length', (end - start) + 1);
                    
//                     file.createReadStream({ start, end }).pipe(res);
//                 } else {
//                     res.setHeader('Content-Length', fileSize);
//                     file.createReadStream().pipe(res);
//                 }
//             });

//             engine.on('error', (err) => {
//                 console.error('Engine error:', err);
//                 res.status(500).json({ error: err.message });
//             });

//             req.on('close', () => {
//                 engine.destroy();
//             });
//         });

//         this.app.get('/api/torrent/health', (req, res) => {
//             res.json({ status: 'ready', activeStreams: this.activeEngines.size });
//         });

//         // Add this to your torrent-proxy.js setupRoutes() method

//         // Root route to prevent 403 on direct access
//         this.app.get('/', (req, res) => {
//             res.json({ 
//                 status: 'Torrent Streaming Service',
//                 version: '1.0.0',
//                 endpoints: [
//                     'GET /api/torrent/health',
//                     'GET /api/torrent/info/:magnetHash',
//                     'GET /api/torrent/stream/:magnetHash/:fileIndex'
//                 ]
//             });
//         });

//         // Add CORS headers for cross-origin requests
//         this.app.use((req, res, next) => {
//             res.header('Access-Control-Allow-Origin', '*');
//             res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
//             res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
//             if (req.method === 'OPTIONS') {
//                 res.sendStatus(200);
//             } else {
//                 next();
//             }
//         });

//     }

//     setupCleanup() {
//         // Cleanup logic here
//     }

//     start(port = 7000) {
//         this.app.listen(port, () => {
//             console.log(`🎬 Torrent streaming proxy running on port ${port}`);
//         });
//     }
// }

// module.exports = TorrentStreamingProxy;









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
        this.setupMiddleware();
        this.setupRoutes();
        this.setupCleanup();
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
                timestamp: new Date().toISOString(),
                available: !!torrentStream
            });
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

            const engine = torrentStream(magnetHash, {
                tmp: '/tmp/torrents',
                verify: false,
                dht: true,
                tracker: true
            });

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
