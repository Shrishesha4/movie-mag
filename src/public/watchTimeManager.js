class WatchTimeManager {
    constructor() {
        this.userToken = localStorage.getItem('userToken');
        this.saveInterval = null;
        this.currentMovieId = null;
        this.currentVideo = null;
        this.lastSaveTime = 0;
        this.saveThreshold = 5; // Save every 5 seconds
    }

    // Initialize watch time tracking for a movie
    initWatchTimeTracking(movieId, videoElement) {
        this.currentMovieId = movieId;
        this.currentVideo = videoElement;
        this.lastSaveTime = 0;

        // Load existing watch time and resume if available
        this.loadAndResume(movieId, videoElement);

        // Set up periodic saving
        this.startPeriodicSaving();

        // Set up event listeners for video events
        this.setupVideoEventListeners(videoElement);

        console.log(`🎬 Watch time tracking initialized for movie ${movieId}`);
    }

    // Load watch time and resume from last position
    async loadAndResume(movieId, videoElement) {
        try {
            const response = await fetch(`/api/watch-time/movie/${movieId}`, {
                headers: {
                    'Authorization': `Bearer ${this.userToken}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                
                if (data.watchTime && data.watchTime.watchTimeSeconds > 0) {
                    const resumeTime = data.watchTime.watchTimeSeconds;
                    
                    // Don't resume if movie is completed or if we're very close to the end
                    if (!data.watchTime.isCompleted && data.watchTime.progress < 95) {
                        videoElement.currentTime = resumeTime;
                        
                        // Show resume notification
                        this.showResumeNotification(resumeTime, data.watchTime.progress);
                        
                        console.log(`⏰ Resuming movie from ${this.formatTime(resumeTime)} (${data.watchTime.progress}% complete)`);
                    } else if (data.watchTime.isCompleted) {
                        console.log(`✅ Movie already completed`);
                        this.showCompletedNotification();
                    }
                }
            }
        } catch (error) {
            console.error('Error loading watch time:', error);
        }
    }

    // Set up video event listeners
    setupVideoEventListeners(videoElement) {
        // Save on pause
        videoElement.addEventListener('pause', () => {
            this.saveWatchTime();
        });

        // Save on seeking
        videoElement.addEventListener('seeked', () => {
            this.saveWatchTime();
        });

        // Save on video end
        videoElement.addEventListener('ended', () => {
            this.markAsCompleted();
        });

        // Save on page unload
        window.addEventListener('beforeunload', () => {
            this.saveWatchTime();
        });

        // Save on visibility change (tab switch)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.saveWatchTime();
            }
        });
    }

    // Start periodic saving
    startPeriodicSaving() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }

        this.saveInterval = setInterval(() => {
            if (this.currentVideo && !this.currentVideo.paused) {
                const currentTime = this.currentVideo.currentTime;
                const timeDiff = Math.abs(currentTime - this.lastSaveTime);
                
                if (timeDiff >= this.saveThreshold) {
                    this.saveWatchTime();
                }
            }
        }, 1000); // Check every second
    }

    // Stop periodic saving
    stopPeriodicSaving() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
            this.saveInterval = null;
        }
    }

    // Save current watch time
    async saveWatchTime() {
        if (!this.currentVideo || !this.currentMovieId) return;

        const currentTime = this.currentVideo.currentTime;
        const duration = this.currentVideo.duration;

        // Don't save if time hasn't changed significantly
        if (Math.abs(currentTime - this.lastSaveTime) < this.saveThreshold) {
            return;
        }

        this.lastSaveTime = currentTime;

        try {
            const response = await fetch('/api/watch-time/save', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.userToken}`
                },
                body: JSON.stringify({
                    movieId: this.currentMovieId,
                    watchTimeSeconds: Math.floor(currentTime),
                    totalDurationSeconds: Math.floor(duration),
                    isCompleted: false
                })
            });

            if (response.ok) {
                console.log(`💾 Watch time saved: ${this.formatTime(currentTime)}`);
            }
        } catch (error) {
            console.error('Error saving watch time:', error);
        }
    }

    // Mark movie as completed
    async markAsCompleted() {
        if (!this.currentVideo || !this.currentMovieId) return;

        const duration = this.currentVideo.duration;

        try {
            const response = await fetch(`/api/watch-time/complete/${this.currentMovieId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.userToken}`
                },
                body: JSON.stringify({
                    totalDurationSeconds: Math.floor(duration)
                })
            });

            if (response.ok) {
                console.log(`✅ Movie marked as completed`);
                this.showCompletedNotification();
            }
        } catch (error) {
            console.error('Error marking movie as completed:', error);
        }
    }

    // Reset watch time for a movie
    async resetWatchTime(movieId) {
        try {
            const response = await fetch(`/api/watch-time/movie/${movieId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.userToken}`
                }
            });

            if (response.ok) {
                console.log(`🔄 Watch time reset for movie ${movieId}`);
                return true;
            }
        } catch (error) {
            console.error('Error resetting watch time:', error);
        }
        return false;
    }

    // Get user's watch time statistics
    async getWatchTimeStats() {
        try {
            const response = await fetch('/api/watch-time/stats', {
                headers: {
                    'Authorization': `Bearer ${this.userToken}`
                }
            });

            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error('Error getting watch time stats:', error);
        }
        return null;
    }

    // Get user's watch history
    async getWatchHistory(limit = 20, offset = 0) {
        try {
            const response = await fetch(`/api/watch-time/user?limit=${limit}&offset=${offset}`, {
                headers: {
                    'Authorization': `Bearer ${this.userToken}`
                }
            });

            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error('Error getting watch history:', error);
        }
        return null;
    }

    // Clean up when stopping watch time tracking
    cleanup() {
        this.saveWatchTime(); // Final save
        this.stopPeriodicSaving();
        this.currentMovieId = null;
        this.currentVideo = null;
        this.lastSaveTime = 0;
    }

    // Utility function to format time
    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        }
    }

    // Show resume notification
    showResumeNotification(resumeTime, progress) {
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
        notification.innerHTML = `
            <div class="flex items-center space-x-2">
                <span>⏰</span>
                <span>Resuming from ${this.formatTime(resumeTime)} (${progress}%)</span>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    // Show completed notification
    showCompletedNotification() {
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
        notification.innerHTML = `
            <div class="flex items-center space-x-2">
                <span>✅</span>
                <span>Movie completed!</span>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    // Get watch progress for a movie
    async getWatchProgress(movieId) {
        try {
            const response = await fetch(`/api/watch-time/movie/${movieId}`, {
                headers: {
                    'Authorization': `Bearer ${this.userToken}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                return data.watchTime;
            }
        } catch (error) {
            console.error('Error getting watch progress:', error);
        }
        return null;
    }
}

// Export for use in other files
window.WatchTimeManager = WatchTimeManager;
