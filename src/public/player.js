class ModernVideoPlayer {
    constructor() {
        this.client = null;
        this.currentMovie = null;
        this.video = null;
        this.isPlaying = false;
        this.skipTime = 5;
        this.controlsTimeout = null;
        this.subtitles = [];
        this.currentSubtitle = null;
        
        console.log('=== PLAYER INITIALIZATION ===');
        console.log('Current URL:', window.location.href);
        console.log('Pathname:', window.location.pathname);
        
        this.movieId = window.location.pathname.split('/').pop();
        console.log('Extracted Movie ID:', this.movieId);
        
        this.movieId = window.location.pathname.split('/').pop();
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.setupKeyboardShortcuts();
        await this.loadMovie();
    }

    setupEventListeners() {
        // Back button
        document.getElementById('backBtn').addEventListener('click', () => {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.location.href = '/';
            }
        });

        // Play/Pause buttons
        document.getElementById('playPauseBtn').addEventListener('click', () => this.togglePlayPause());
        document.getElementById('centerPlayBtn').addEventListener('click', () => this.togglePlayPause());

        // Skip buttons
        document.getElementById('skipBackBtn').addEventListener('click', () => this.skip(-this.skipTime));
        document.getElementById('skipForwardBtn').addEventListener('click', () => this.skip(this.skipTime));

        // Volume controls
        document.getElementById('volumeBtn').addEventListener('click', () => this.toggleMute());
        document.getElementById('volumeSlider').addEventListener('input', (e) => this.setVolume(e.target.value));

        // Progress bar
        document.getElementById('progressBar').addEventListener('input', (e) => this.seek(e.target.value));

        // Fullscreen
        document.getElementById('fullscreenBtn').addEventListener('click', () => this.toggleFullscreen());

        // Settings
        document.getElementById('settingsBtn').addEventListener('click', () => this.toggleSettings());
        document.getElementById('skipTimeSelect').addEventListener('change', (e) => {
            this.skipTime = parseInt(e.target.value);
            this.updateSkipTimeDisplay();
        });

        // Subtitles
        document.getElementById('subtitlesBtn').addEventListener('click', () => this.toggleSubtitlesPanel());

        // Speed control
        document.getElementById('speedBtn').addEventListener('click', () => this.cyclePlaybackSpeed());

        // Mouse controls for showing/hiding controls
        const player = document.getElementById('videoPlayer');
        player.addEventListener('mousemove', () => this.showControls());
        player.addEventListener('mouseleave', () => this.hideControls());
        player.addEventListener('click', () => this.togglePlayPause());
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName.toLowerCase() === 'input') return;

            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    this.togglePlayPause();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.skip(-this.skipTime);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.skip(this.skipTime);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.adjustVolume(10);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.adjustVolume(-10);
                    break;
                case 'KeyF':
                    e.preventDefault();
                    this.toggleFullscreen();
                    break;
                case 'KeyM':
                    e.preventDefault();
                    this.toggleMute();
                    break;
            }
        });
    }

    async loadMovie() {
    console.log('=== DEBUGGING MOVIE LOAD ===');
    console.log('Movie ID:', this.movieId);
    console.log('API URL:', `/api/movies/${this.movieId}`);
    
    try {
        console.log('Making API request...');
        const response = await fetch(`/api/movies/${this.movieId}`);
        console.log('Response status:', response.status);
        console.log('Response OK:', response.ok);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error response:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const movieData = await response.json();
        console.log('Movie data received:', movieData);
        
        this.currentMovie = movieData;
        this.updateMovieInfo();
        console.log('Movie info updated');
        
        this.loadSubtitles();
        console.log('Starting streaming...');
        this.startStreaming();
    } catch (error) {
        console.error('=== MOVIE LOAD ERROR ===');
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        this.showError(`Error: ${error.message}`);
    }
}


    updateMovieInfo() {
        document.getElementById('movieTitle').textContent = this.currentMovie.title;
        document.getElementById('movieTitleInfo').textContent = this.currentMovie.title;
        document.getElementById('movieYear').textContent = this.currentMovie.year || 'N/A';
        document.getElementById('movieGenre').textContent = this.currentMovie.genre || 'Unknown';
        document.getElementById('movieDescription').textContent = this.currentMovie.description || 'No description available';
        document.title = `${this.currentMovie.title} - Movie Player`;
    }

    async loadSubtitles() {
        const subtitlesList = document.getElementById('subtitlesList');
        const loadingDiv = subtitlesList.querySelector('.subtitle-loading');
        loadingDiv.style.display = 'flex';

        try {
            // Search for subtitles using OpenSubtitles API
            const subtitles = await this.searchOpenSubtitles();
            
            loadingDiv.style.display = 'none';
            
            subtitles.forEach(sub => {
                const subtitleDiv = document.createElement('div');
                subtitleDiv.className = 'subtitle-item';
                subtitleDiv.innerHTML = `
                    <button class="subtitle-btn" data-lang="${sub.language}" data-url="${sub.url}">
                        ${sub.language} - ${sub.release || 'Unknown'}
                    </button>
                `;
                subtitleDiv.querySelector('.subtitle-btn').addEventListener('click', () => {
                    this.loadSubtitle(sub);
                });
                subtitlesList.appendChild(subtitleDiv);
            });
        } catch (error) {
            console.error('Error loading subtitles:', error);
            loadingDiv.innerHTML = '<span>No subtitles found</span>';
        }
    }

    async searchOpenSubtitles() {
        // Mock implementation - in production, you'd use OpenSubtitles API
        // This is a simplified version that returns mock data
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve([
                    { language: 'English', url: 'mock-en.srt', release: 'Web-DL' },
                    { language: 'Spanish', url: 'mock-es.srt', release: 'BluRay' },
                    { language: 'French', url: 'mock-fr.srt', release: 'Web-DL' }
                ]);
            }, 2000);
        });
    }

    loadSubtitle(subtitle) {
        // Remove active class from all subtitle buttons
        document.querySelectorAll('.subtitle-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        if (subtitle.language === 'off') {
            this.removeSubtitles();
            return;
        }

        // Add active class to selected subtitle
        document.querySelector(`[data-lang="${subtitle.language}"]`).classList.add('active');

        // In a real implementation, you would fetch and parse the subtitle file
        console.log('Loading subtitle:', subtitle);
        this.currentSubtitle = subtitle;

        // Mock subtitle loading
        if (this.video && this.video.textTracks) {
            // Remove existing tracks
            Array.from(this.video.textTracks).forEach(track => {
                track.mode = 'disabled';
            });

            // Create new track (mock)
            const track = document.createElement('track');
            track.kind = 'subtitles';
            track.label = subtitle.language;
            track.srclang = subtitle.language.toLowerCase().substring(0, 2);
            track.src = subtitle.url; // In real implementation, this would be a valid subtitle file
            track.default = true;
            
            if (this.video.appendChild) {
                this.video.appendChild(track);
                track.addEventListener('load', () => {
                    track.mode = 'showing';
                });
            }
        }

        this.toggleSubtitlesPanel();
    }

    removeSubtitles() {
        if (this.video && this.video.textTracks) {
            Array.from(this.video.textTracks).forEach(track => {
                track.mode = 'disabled';
            });
        }
        this.currentSubtitle = null;
        document.querySelector('[data-lang="off"]').classList.add('active');
        this.toggleSubtitlesPanel();
    }

    startStreaming() {
        if (!this.currentMovie.magnet) {
            this.showError('No magnet link available');
            return;
        }

        document.getElementById('loadingText').textContent = 'Initializing WebTorrent...';
        document.getElementById('torrentProgress').style.display = 'block';

        this.client = new WebTorrent({
            tracker: {
                rtcConfig: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:global.stun.twilio.com:3478' }
                    ]
                }
            }
        });

        const torrent = this.client.add(this.currentMovie.magnet, (torrent) => {
            const file = torrent.files.find(f => 
                /\.(mp4|mkv|webm|avi)$/i.test(f.name)
            );

            if (file) {
                this.setupVideo(file);
                document.getElementById('loadingOverlay').style.display = 'none';
            } else {
                this.showError('No compatible video file found');
            }
        });

        torrent.on('download', () => {
            this.updateTorrentProgress(torrent);
        });

        torrent.on('error', (err) => {
            this.showError('Torrent Error: ' + err.message);
        });
    }

    setupVideo(file) {
        this.video = document.createElement('video');
        this.video.controls = false;
        this.video.preload = 'metadata';
        
        const playerContainer = document.getElementById('videoPlayer');
        playerContainer.appendChild(this.video);

        file.renderTo(this.video, (err) => {
            if (err) {
                this.showError('Video Error: ' + err.message);
                return;
            }
            
            this.setupVideoEvents();
            document.getElementById('playerControls').style.display = 'flex';
            
            // Auto-play if enabled
            if (document.getElementById('autoplayToggle').checked) {
                this.video.play().then(() => {
                    this.isPlaying = true;
                    this.updatePlayButton();
                }).catch(console.error);
            }
        });
    }

    setupVideoEvents() {
        this.video.addEventListener('loadedmetadata', () => {
            document.getElementById('duration').textContent = this.formatTime(this.video.duration);
            document.getElementById('movieDuration').textContent = this.formatTime(this.video.duration);
        });

        this.video.addEventListener('timeupdate', () => {
            const progress = (this.video.currentTime / this.video.duration) * 100;
            document.getElementById('progressBar').value = progress;
            document.getElementById('currentTime').textContent = this.formatTime(this.video.currentTime);
        });

        this.video.addEventListener('progress', () => {
            if (this.video.buffered.length > 0) {
                const buffered = (this.video.buffered.end(0) / this.video.duration) * 100;
                document.getElementById('bufferProgress').style.width = buffered + '%';
            }
        });

        this.video.addEventListener('play', () => {
            this.isPlaying = true;
            this.updatePlayButton();
        });

        this.video.addEventListener('pause', () => {
            this.isPlaying = false;
            this.updatePlayButton();
        });

        this.video.addEventListener('volumechange', () => {
            document.getElementById('volumeSlider').value = this.video.volume * 100;
            this.updateVolumeIcon();
        });
    }

    togglePlayPause() {
        if (!this.video) return;

        if (this.isPlaying) {
            this.video.pause();
        } else {
            this.video.play();
        }
    }

    skip(seconds) {
        if (!this.video) return;
        this.video.currentTime = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
    }

    seek(percentage) {
        if (!this.video) return;
        this.video.currentTime = (percentage / 100) * this.video.duration;
    }

    setVolume(volume) {
        if (!this.video) return;
        this.video.volume = volume / 100;
    }

    adjustVolume(delta) {
        if (!this.video) return;
        const newVolume = Math.max(0, Math.min(100, this.video.volume * 100 + delta));
        this.setVolume(newVolume);
    }

    toggleMute() {
        if (!this.video) return;
        this.video.muted = !this.video.muted;
        this.updateVolumeIcon();
    }

    toggleFullscreen() {
        const player = document.getElementById('videoPlayer');
        
        if (!document.fullscreenElement) {
            player.requestFullscreen().catch(console.error);
        } else {
            document.exitFullscreen().catch(console.error);
        }
    }

    cyclePlaybackSpeed() {
        if (!this.video) return;
        
        const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
        const currentIndex = speeds.indexOf(this.video.playbackRate);
        const nextIndex = (currentIndex + 1) % speeds.length;
        
        this.video.playbackRate = speeds[nextIndex];
        document.getElementById('speedBtn').querySelector('span').textContent = speeds[nextIndex] + 'x';
    }

    showControls() {
        const controls = document.getElementById('playerControls');
        const player = document.getElementById('videoPlayer');
        
        controls.classList.add('visible');
        player.classList.add('show-cursor');
        
        clearTimeout(this.controlsTimeout);
        this.controlsTimeout = setTimeout(() => {
            if (this.isPlaying) {
                this.hideControls();
            }
        }, 3000);
    }

    hideControls() {
        const controls = document.getElementById('playerControls');
        const player = document.getElementById('videoPlayer');
        
        controls.classList.remove('visible');
        player.classList.remove('show-cursor');
    }

    toggleSettings() {
        const panel = document.getElementById('settingsPanel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    toggleSubtitlesPanel() {
        const panel = document.getElementById('subtitlesPanel');
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }

    updatePlayButton() {
        const playIcon = document.getElementById('playIcon');
        const pauseIcon = document.getElementById('pauseIcon');
        const centerBtn = document.getElementById('centerPlayBtn');
        
        if (this.isPlaying) {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
            centerBtn.style.display = 'none';
        } else {
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
            centerBtn.style.display = 'flex';
        }
    }

    updateVolumeIcon() {
        const icon = document.getElementById('volumeIcon');
        if (this.video.muted || this.video.volume === 0) {
            icon.innerHTML = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
        } else {
            icon.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
        }
    }

    updateSkipTimeDisplay() {
        document.querySelectorAll('.skip-time').forEach(el => {
            el.textContent = this.skipTime;
        });
    }

    updateTorrentProgress(torrent) {
        const progress = Math.round(torrent.progress * 100);
        const speed = this.formatBytes(torrent.downloadSpeed);
        const peers = torrent.numPeers;

        document.getElementById('progressFill').style.width = progress + '%';
        document.getElementById('progress').textContent = progress + '%';
        document.getElementById('downloadSpeed').textContent = speed + '/s';
        document.getElementById('peers').textContent = peers + ' peers';
    }

    formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '0:00';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    showError(message) {
        document.getElementById('loadingOverlay').innerHTML = `
            <div class="loading-content">
                <p style="color: #ff6b6b; margin-bottom: 1rem;">${message}</p>
                <button onclick="window.location.reload()" class="control-btn text-btn" style="background: #ff6b6b;">
                    Try Again
                </button>
            </div>
        `;
    }

    destroy() {
        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
        }
        if (this.client) {
            this.client.destroy();
        }
    }
}

// Initialize player when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.player = new ModernVideoPlayer();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.player) {
        window.player.destroy();
    }
});
