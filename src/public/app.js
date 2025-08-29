class MovieApp {
    constructor() {
        this.movies = [];
        this.filteredMovies = [];
        this.currentSearch = '';
        this.currentGenre = 'all';
        this.isLoading = false;
        this.searchTimeout = null;
        this.loadingTimeout = null;
        
        // Authentication
        this.userToken = localStorage.getItem('userToken');
        this.username = localStorage.getItem('username');
        
        // Animation and UI state
        this.animationQueue = [];
        this.isAnimating = false;
        
        // Cache for performance
        this.genresCache = new Set();
        this.searchCache = new Map();
        
        this.init();
    }

    async init() {
        try {
            // Check authentication first
            if (!this.userToken) {
                window.location.href = '/login';
                return;
            }
            
            // Verify token is still valid
            const isValid = await this.verifyToken();
            if (!isValid) {
                localStorage.removeItem('userToken');
                localStorage.removeItem('username');
                window.location.href = '/login';
                return;
            }
            
            this.setupEventListeners();
            this.hideLoadingScreen();
            await this.loadMovies();
            this.setupGenreFilter();
            this.initializeAnimations();
            this.setupUserInterface();
        } catch (error) {
            console.error('Failed to initialize app:', error);
            this.showToast('Failed to initialize application', 'error');
        }
    }

    async verifyToken() {
        try {
            const response = await fetch('/api/auth/user-verify', {
                headers: { 'Authorization': `Bearer ${this.userToken}` }
            });
            return response.ok;
        } catch (error) {
            console.error('Token verification failed:', error);
            return false;
        }
    }
    
    setupUserInterface() {
        // Update user welcome message if username is available
        if (this.username) {
            const userWelcome = document.getElementById('userWelcome');
            if (userWelcome) {
                userWelcome.textContent = `Welcome, ${this.username}`;
            }
        }
        
        // Add logout functionality
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                localStorage.removeItem('userToken');
                localStorage.removeItem('username');
                window.location.href = '/login';
            });
        }
    }
    
    hideLoadingScreen() {
        setTimeout(() => {
            const loadingScreen = document.getElementById('loadingScreen');
            if (loadingScreen) {
                loadingScreen.classList.add('opacity-0');
                setTimeout(() => {
                    loadingScreen.style.display = 'none';
                }, 500);
            }
        }, 1500);
    }

    setupEventListeners() {
        // Search functionality with debouncing
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', this.handleSearchInput.bind(this));
            searchInput.addEventListener('focus', this.showSearchSuggestions.bind(this));
            searchInput.addEventListener('blur', this.hideSearchSuggestions.bind(this));
        }

        // Refresh button
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', this.handleRefresh.bind(this));
        }

        // Watch history button
        const showWatchHistoryBtn = document.getElementById('showWatchHistory');
        if (showWatchHistoryBtn) {
            showWatchHistoryBtn.addEventListener('click', this.showWatchHistory.bind(this));
        }

        // Hide watch history button
        const hideWatchHistoryBtn = document.getElementById('hideWatchHistory');
        if (hideWatchHistoryBtn) {
            hideWatchHistoryBtn.addEventListener('click', this.hideWatchHistory.bind(this));
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyboardShortcuts.bind(this));

        // Scroll event for navbar
        window.addEventListener('scroll', this.handleScroll.bind(this));

        // Resize event for responsive updates
        window.addEventListener('resize', this.handleResize.bind(this));

        // Visibility change for performance
        document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    }

    handleSearchInput(event) {
        const query = event.target.value.trim();
        
        // Clear previous timeout
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }

        // Debounce search to improve performance
        this.searchTimeout = setTimeout(() => {
            this.performSearch(query);
        }, 300);
    }

    performSearch(query) {
        this.currentSearch = query.toLowerCase();
        
        // Update search suggestions
        if (query.length > 0) {
            this.updateSearchSuggestions(query);
        } else {
            this.hideSearchSuggestions();
        }
        
        this.filterAndRenderMovies();
    }

    updateSearchSuggestions(query) {
        const suggestions = this.movies
            .filter(movie => 
                movie.title.toLowerCase().includes(query.toLowerCase()) ||
                (movie.description && movie.description.toLowerCase().includes(query.toLowerCase()))
            )
            .slice(0, 5) // Limit to 5 suggestions
            .map(movie => movie.title);

        const suggestionsContainer = document.getElementById('searchSuggestions');
        if (suggestionsContainer && suggestions.length > 0) {
            suggestionsContainer.innerHTML = suggestions
                .map(suggestion => `
                    <div class="px-4 py-2 hover:bg-gray-700 cursor-pointer text-white suggestion-item"
                         data-suggestion="${suggestion}">
                        ${this.highlightSearchTerm(suggestion, query)}
                    </div>
                `).join('');
            
            suggestionsContainer.classList.remove('hidden');
            
            // Add click listeners to suggestions
            suggestionsContainer.querySelectorAll('.suggestion-item').forEach(item => {
                item.addEventListener('mousedown', () => {
                    const searchInput = document.getElementById('searchInput');
                    searchInput.value = item.dataset.suggestion;
                    this.performSearch(item.dataset.suggestion);
                    this.hideSearchSuggestions();
                });
            });
        }
    }

    showSearchSuggestions() {
        const query = document.getElementById('searchInput').value.trim();
        if (query.length > 0) {
            this.updateSearchSuggestions(query);
        }
    }

    hideSearchSuggestions() {
        setTimeout(() => {
            const suggestionsContainer = document.getElementById('searchSuggestions');
            if (suggestionsContainer) {
                suggestionsContainer.classList.add('hidden');
            }
        }, 150);
    }

    highlightSearchTerm(text, term) {
        const regex = new RegExp(`(${term})`, 'gi');
        return text.replace(regex, '<span class="text-netflix-red font-semibold">$1</span>');
    }

    handleKeyboardShortcuts(event) {
        // Ctrl/Cmd + K for search focus
        if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
            event.preventDefault();
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.focus();
            }
        }

        // Escape to close search suggestions
        if (event.key === 'Escape') {
            this.hideSearchSuggestions();
        }

        // Enter in search to focus first result
        if (event.key === 'Enter' && event.target.id === 'searchInput') {
            event.preventDefault();
            const firstMovie = this.filteredMovies[0];
            if (firstMovie) {
                this.playMovie(firstMovie.id);
            }
        }
    }

    handleScroll() {
        const navbar = document.getElementById('navbar');
        if (navbar) {
            if (window.scrollY > 50) {
                navbar.classList.add('bg-black', 'bg-opacity-90');
                navbar.classList.remove('glass-morphism');
            } else {
                navbar.classList.remove('bg-black', 'bg-opacity-90');
                navbar.classList.add('glass-morphism');
            }
        }
    }

    handleResize() {
        // Responsive updates if needed
        this.updateLayout();
    }

    handleVisibilityChange() {
        if (document.hidden) {
            // Pause any ongoing operations when tab is hidden
            this.pauseOperations();
        } else {
            // Resume operations when tab is visible
            this.resumeOperations();
        }
    }

    async handleRefresh() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.classList.add('animate-spin');
        }

        try {
            await this.loadMovies();
            this.showToast('Movies refreshed successfully!', 'success');
        } catch (error) {
            this.showToast('Failed to refresh movies', 'error');
        } finally {
            if (refreshBtn) {
                refreshBtn.classList.remove('animate-spin');
            }
        }
    }

    async loadMovies() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoadingState(true);

        try {
            console.log('🎬 Loading movies from API...');
            
            const response = await fetch('/api/movies', {
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache',
                    'Authorization': `Bearer ${this.userToken}`
                }
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    // Token expired or invalid
                    localStorage.removeItem('userToken');
                    localStorage.removeItem('username');
                    window.location.href = '/login';
                    return;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('Raw API response:', data); // Debug log
            
            // Handle different response structures from your enhanced movies API
            if (Array.isArray(data)) {
                this.movies = data;
            } else if (data.movies && Array.isArray(data.movies)) {
                this.movies = data.movies; // Paginated response
            } else {
                console.warn('Unexpected API response structure:', data);
                this.movies = [];
            }
            
            console.log(`✅ Loaded ${this.movies.length} movies`);
            
            // Cache the movies
            this.cacheMovies(this.movies);
            
            // Process the data
            this.processMoviesData();
            
        } catch (error) {
            console.error('❌ Error loading movies:', error);
            this.showError('Failed to load movies. Please check your connection and try again.');
            this.movies = []; // Ensure it's always an array
        } finally {
            this.isLoading = false;
            this.showLoadingState(false);
        }
    }


    processMoviesData() {
        // Normalize genres and collect unique ones
        this.genresCache.clear();
        this.movies.forEach(movie => {
            if (movie.genre) {
                // Normalize genres: split, trim, lowercase
                const normalizedGenres = movie.genre
                    .split(',')
                    .map(g => g.trim().toLowerCase())
                    .filter(g => g.length > 0);
                
                movie.normalizedGenres = normalizedGenres;
                normalizedGenres.forEach(genre => this.genresCache.add(genre));
            } else {
                movie.normalizedGenres = [];
            }
        });

        this.filteredMovies = [...this.movies];
        this.setupGenreFilter();
        this.renderMovies();
        this.updateStats();
        
        // Initialize animations
        this.initializeAnimations();
    }

    setupGenreFilter() {
        const genreContainer = document.getElementById('genreFilter');
        if (!genreContainer) return;

        // Add click event listener to the "All Movies" button
        const allMoviesButton = document.querySelector('[data-genre="all"]');
        if (allMoviesButton) {
            // Remove any existing event listeners to prevent duplicates
            const newButton = allMoviesButton.cloneNode(true);
            allMoviesButton.parentNode.replaceChild(newButton, allMoviesButton);
            
            // Add click event listener to the new button
            newButton.addEventListener('click', () => {
                this.setActiveGenre('all');
            });
        }

        const sortedGenres = Array.from(this.genresCache).sort();
        
        // Clear existing genre buttons (except "All Movies")
        const existingTags = genreContainer.querySelectorAll('.genre-tag:not([data-genre="all"])');
        existingTags.forEach(tag => tag.remove());
        
        // Add genre buttons
        sortedGenres.forEach(genre => {
            const button = document.createElement('button');
            button.className = 'genre-tag bg-gray-700 hover:bg-netflix-red text-white px-6 py-3 rounded-full text-sm font-medium transition-all duration-200 relative overflow-hidden';
            button.textContent = this.capitalizeGenre(genre);
            button.setAttribute('data-genre', genre);
            
            // Add genre icon
            const icon = this.getGenreIcon(genre);
            if (icon) {
                button.textContent = `${icon} ${button.textContent}`;
            }
            
            button.addEventListener('click', () => {
                this.setActiveGenre(genre);
            });
            
            genreContainer.appendChild(button);
        });
    }

    capitalizeGenre(genre) {
        return genre.split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    getGenreIcon(genre) {
        const iconMap = {
            'action': '💥',
            'adventure': '🗺️',
            'animation': '🎨',
            'comedy': '😂',
            'crime': '🔫',
            'documentary': '📹',
            'drama': '🎭',
            'family': '👨‍👩‍👧‍👦',
            'fantasy': '🧙‍♂️',
            'horror': '👻',
            'music': '🎵',
            'mystery': '🔍',
            'romance': '💕',
            'sci-fi': '🚀',
            'thriller': '😨',
            'war': '⚔️',
            'western': '🤠',
            'kids': '👶'
        };
        return iconMap[genre.toLowerCase()] || '🎬';
    }

    setActiveGenre(genre) {
        this.currentGenre = genre;
        
        // Update active state with animation
        const genreTags = document.querySelectorAll('.genre-tag');
        genreTags.forEach(tag => {
            tag.classList.remove('bg-netflix-red');
            tag.classList.add('bg-gray-700');
        });
        
        const activeTag = document.querySelector(`[data-genre="${genre}"]`);
        if (activeTag) {
            activeTag.classList.remove('bg-gray-700');
            activeTag.classList.add('bg-netflix-red');
        }
        
        this.filterAndRenderMovies();
    }

    filterAndRenderMovies() {
        // Apply filters
        this.filteredMovies = this.movies.filter(movie => {
            const matchesSearch = this.matchesSearch(movie);
            const matchesGenre = this.matchesGenre(movie);
            return matchesSearch && matchesGenre;
        });

        // Sort movies by relevance if there's a search term
        if (this.currentSearch) {
            this.filteredMovies.sort((a, b) => {
                const aRelevance = this.calculateRelevance(a, this.currentSearch);
                const bRelevance = this.calculateRelevance(b, this.currentSearch);
                return bRelevance - aRelevance;
            });
        }

        this.renderMovies();
        this.updateStats();
        this.showSearchResults();
    }

    matchesSearch(movie) {
        if (!this.currentSearch) return true;
        
        const searchLower = this.currentSearch.toLowerCase();
        return (
            movie.title.toLowerCase().includes(searchLower) ||
            (movie.description && movie.description.toLowerCase().includes(searchLower)) ||
            (movie.normalizedGenres && movie.normalizedGenres.some(genre => genre.includes(searchLower)))
        );
    }

    matchesGenre(movie) {
        if (this.currentGenre === 'all') return true;
        return movie.normalizedGenres && movie.normalizedGenres.includes(this.currentGenre);
    }

    calculateRelevance(movie, searchTerm) {
        let relevance = 0;
        const searchLower = searchTerm.toLowerCase();
        
        // Title matches are most relevant
        if (movie.title.toLowerCase().includes(searchLower)) {
            relevance += 10;
            if (movie.title.toLowerCase().startsWith(searchLower)) {
                relevance += 5; // Boost for title starting with search term
            }
        }
        
        // Description matches
        if (movie.description && movie.description.toLowerCase().includes(searchLower)) {
            relevance += 3;
        }
        
        // Genre matches
        if (movie.normalizedGenres && movie.normalizedGenres.some(genre => genre.includes(searchLower))) {
            relevance += 2;
        }
        
        return relevance;
    }

    renderMovies() {
        const movieGrid = document.getElementById('movieGrid');
        const loading = document.getElementById('loading');
        const noResults = document.getElementById('noResults');
        
        if (!movieGrid) return;

        // Hide loading and show grid
        if (loading) loading.classList.add('hidden');
        movieGrid.classList.remove('hidden');

        if (this.filteredMovies.length === 0) {
            movieGrid.classList.add('hidden');
            if (noResults) noResults.classList.remove('hidden');
            return;
        }

        if (noResults) noResults.classList.add('hidden');

        // Create movie cards with staggered animation
        movieGrid.innerHTML = this.filteredMovies.map((movie, index) => `
            <div class="movie-card bg-gray-800 rounded-2xl overflow-hidden cursor-pointer group relative transform transition-all duration-300 hover:scale-105 hover:-translate-y-2" 
                 data-movie-id="${movie.id}" 
                 style="animation-delay: ${index * 50}ms">
                
                <div class="relative overflow-hidden">
                    <img 
                        src="${movie.poster_url || 'https://dummyimage.com/400x600/1f2937/ffffff&text=🎬'}" 
                        alt="${movie.title}"
                        class="w-full h-72 object-cover transition-transform duration-500 group-hover:scale-110"
                        loading="lazy"
                        onerror="this.src='https://dummyimage.com/400x600/1f2937/ffffff&text=🎬'"
                    >
                    
                    <!-- Overlay -->
                    <div class="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    
                    <!-- Play Button -->
                    <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-50 group-hover:scale-100">
                        <div class="w-16 h-16 bg-netflix-red rounded-full flex items-center justify-center shadow-2xl">
                            <svg class="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path>
                            </svg>
                        </div>
                    </div>
                    
                    <!-- Genre Tags -->
                    <div class="absolute top-2 left-2 flex flex-wrap gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        ${movie.normalizedGenres ? movie.normalizedGenres.slice(0, 2).map(genre => `
                            <span class="bg-netflix-red text-white text-xs px-2 py-1 rounded-full font-medium">
                                ${this.capitalizeGenre(genre)}
                            </span>
                        `).join('') : ''}
                    </div>
                    
                    <!-- Year Badge -->
                    ${movie.year ? `
                        <div class="absolute top-2 right-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded-full">
                            ${movie.year}
                        </div>
                    ` : ''}
                    
                    <!-- Watch Progress Indicator -->
                    ${movie.watchProgress ? `
                        <div class="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50">
                            <div class="w-full bg-gray-700 h-1">
                                <div class="bg-netflix-red h-1 transition-all duration-300" style="width: ${movie.watchProgress.progress}%"></div>
                            </div>
                            <div class="px-2 py-1 text-xs text-white">
                                ${movie.watchProgress.isCompleted ? '✅ Completed' : `${movie.watchProgress.progress}% watched`}
                            </div>
                        </div>
                    ` : ''}
                </div>
                
                <!-- Movie Info -->
                <div class="p-4">
                    <h3 class="font-bold text-lg text-white mb-2 line-clamp-1 group-hover:text-netflix-red transition-colors duration-200" title="${movie.title}">
                        ${this.highlightSearchText(movie.title)}
                    </h3>
                    
                    <div class="flex items-center justify-between text-sm text-gray-400 mb-3">
                        <span>${movie.year || 'Unknown'}</span>
                        <div class="flex items-center space-x-1">
                            <svg class="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path>
                            </svg>
                            <span class="text-yellow-400 font-medium">${(Math.random() * 5 + 5).toFixed(1)}</span>
                        </div>
                    </div>
                    
                    ${movie.description ? `
                        <p class="text-gray-400 text-sm line-clamp-2 leading-relaxed" title="${movie.description}">
                            ${this.highlightSearchText(this.truncateText(movie.description, 100))}
                        </p>
                    ` : ''}
                </div>
                
                <!-- Loading State -->
                <div class="movie-loading absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center hidden">
                    <div class="w-8 h-8 border-4 border-netflix-red border-t-transparent rounded-full animate-spin"></div>
                </div>
            </div>
        `).join('');

        // Add click event listeners
        this.attachMovieCardListeners();
        
        // Trigger entrance animations
        this.animateMovieCards();
    }

    attachMovieCardListeners() {
        const movieCards = document.querySelectorAll('.movie-card');
        movieCards.forEach(card => {
            card.addEventListener('click', () => {
                const movieId = parseInt(card.dataset.movieId);
                this.playMovie(movieId, card);
            });

            // Add right-click context menu for additional options
            card.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showMovieContextMenu(e, parseInt(card.dataset.movieId));
            });
        });
    }

    animateMovieCards() {
        const movieCards = document.querySelectorAll('.movie-card');
        movieCards.forEach((card, index) => {
            card.classList.add('animate-slide-up');
            card.style.animationDelay = `${index * 50}ms`;
        });
    }

    highlightSearchText(text) {
        if (!this.currentSearch || !text) return text;
        
        const regex = new RegExp(`(${this.currentSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<span class="bg-netflix-red bg-opacity-20 text-netflix-red font-semibold rounded px-1">$1</span>');
    }

    async playMovie(movieId, cardElement = null) {
        console.log('🎬 Playing movie:', movieId);
        
        // Show loading state on card
        if (cardElement) {
            const loadingElement = cardElement.querySelector('.movie-loading');
            if (loadingElement) {
                loadingElement.classList.remove('hidden');
            }
        }

        try {
            // Open the embedded player
            if (window.embeddedPlayer) {
                await window.embeddedPlayer.openPlayer(movieId);
                
                // Track the play
                await this.trackMoviePlay(movieId);
                
                this.showToast('Starting movie...', 'info');
            } else {
                throw new Error('Video player not available');
            }
        } catch (error) {
            console.error('❌ Failed to play movie:', error);
            this.showToast('Failed to start movie. Please try again.', 'error');
        } finally {
            // Hide loading state
            if (cardElement) {
                const loadingElement = cardElement.querySelector('.movie-loading');
                if (loadingElement) {
                    loadingElement.classList.add('hidden');
                }
            }
        }
    }

    showMovieContextMenu(event, movieId) {
        const movie = this.movies.find(m => m.id === movieId);
        if (!movie) return;

        // Create context menu
        const contextMenu = document.createElement('div');
        contextMenu.className = 'fixed bg-gray-800 rounded-lg shadow-xl border border-gray-700 py-2 z-50';
        contextMenu.style.left = `${event.clientX}px`;
        contextMenu.style.top = `${event.clientY}px`;
        
        contextMenu.innerHTML = `
            <div class="px-4 py-2 hover:bg-gray-700 cursor-pointer text-white" onclick="window.movieApp.playMovie(${movieId})">
                ▶ Play Movie
            </div>
            ${movie.watchProgress ? `
                <div class="px-4 py-2 hover:bg-gray-700 cursor-pointer text-white" onclick="window.movieApp.resetWatchTime(${movieId})">
                    🔄 Reset Progress
                </div>
            ` : ''}
            <div class="px-4 py-2 hover:bg-gray-700 cursor-pointer text-white" onclick="window.movieUtils.copyMagnetLink('${movie.magnet}')">
                🔗 Copy Magnet Link
            </div>
            <div class="px-4 py-2 hover:bg-gray-700 cursor-pointer text-white" onclick="window.movieUtils.shareMovie(${JSON.stringify(movie).replace(/"/g, '&quot;')})">
                📤 Share Movie
            </div>
        `;
        
        document.body.appendChild(contextMenu);
        
        // Remove menu after delay or click outside
        setTimeout(() => {
            if (contextMenu.parentNode) {
                contextMenu.remove();
            }
        }, 5000);
        
        document.addEventListener('click', () => {
            if (contextMenu.parentNode) {
                contextMenu.remove();
            }
        }, { once: true });
    }

    async trackMoviePlay(movieId) {
        try {
            const response = await fetch('/api/stream/session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.userToken}`
                },
                body: JSON.stringify({
                    movieId,
                    sessionId: this.generateSessionId(),
                    timestamp: new Date().toISOString(),
                    userAgent: navigator.userAgent
                })
            });

            if (!response.ok) {
                console.warn('⚠️ Failed to track movie play');
            }
        } catch (error) {
            console.error('❌ Error tracking movie play:', error);
        }
    }

    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async showWatchHistory() {
        try {
            if (!window.WatchTimeManager) {
                this.showToast('Watch time tracking not available', 'error');
                return;
            }

            const watchTimeManager = new WatchTimeManager();
            const history = await watchTimeManager.getWatchHistory(10, 0);

            if (history && history.watchTimes && history.watchTimes.length > 0) {
                this.renderWatchHistory(history.watchTimes);
                document.getElementById('watchHistorySection').style.display = 'block';
                document.getElementById('movieGrid').style.display = 'none';
            } else {
                this.showToast('No watch history found', 'info');
            }
        } catch (error) {
            console.error('Error loading watch history:', error);
            this.showToast('Failed to load watch history', 'error');
        }
    }

    hideWatchHistory() {
        document.getElementById('watchHistorySection').style.display = 'none';
        document.getElementById('movieGrid').style.display = 'grid';
    }

    renderWatchHistory(watchTimes) {
        const watchHistoryGrid = document.getElementById('watchHistoryGrid');
        if (!watchHistoryGrid) return;

        watchHistoryGrid.innerHTML = watchTimes.map(watchTime => `
            <div class="movie-card bg-gray-800 rounded-2xl overflow-hidden cursor-pointer group relative transform transition-all duration-300 hover:scale-105 hover:-translate-y-2" 
                 data-movie-id="${watchTime.movieId}" 
                 data-watch-time-id="${watchTime.id}">
                
                <div class="relative overflow-hidden">
                    <img 
                        src="${watchTime.posterUrl || 'https://dummyimage.com/400x600/1f2937/ffffff&text=🎬'}" 
                        alt="${watchTime.movieTitle}"
                        class="w-full h-48 object-cover transition-transform duration-500 group-hover:scale-110"
                        loading="lazy"
                        onerror="this.src='https://dummyimage.com/400x600/1f2937/ffffff&text=🎬'"
                    >
                    
                    <!-- Overlay -->
                    <div class="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    
                    <!-- Play Button -->
                    <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform scale-50 group-hover:scale-100">
                        <div class="w-12 h-12 bg-netflix-red rounded-full flex items-center justify-center shadow-2xl">
                            <svg class="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path>
                            </svg>
                        </div>
                    </div>
                    
                    <!-- Watch Progress Indicator -->
                    <div class="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50">
                        <div class="w-full bg-gray-700 h-1">
                            <div class="bg-netflix-red h-1 transition-all duration-300" style="width: ${watchTime.progress}%"></div>
                        </div>
                        <div class="px-2 py-1 text-xs text-white">
                            ${watchTime.isCompleted ? '✅ Completed' : `${watchTime.progress}% watched`}
                        </div>
                    </div>
                </div>
                
                <!-- Movie Info -->
                <div class="p-3">
                    <h3 class="font-bold text-sm text-white mb-1 line-clamp-1 group-hover:text-netflix-red transition-colors duration-200" title="${watchTime.movieTitle}">
                        ${watchTime.movieTitle}
                    </h3>
                    
                    <div class="flex items-center justify-between text-xs text-gray-400">
                        <span>${watchTime.year || 'Unknown'}</span>
                        <span>${this.formatTime(watchTime.watchTimeSeconds)}</span>
                    </div>
                </div>
            </div>
        `).join('');

        // Add click event listeners for watch history cards
        const watchHistoryCards = document.querySelectorAll('#watchHistoryGrid .movie-card');
        watchHistoryCards.forEach(card => {
            card.addEventListener('click', () => {
                const movieId = parseInt(card.dataset.movieId);
                this.playMovie(movieId, card);
            });
        });
    }

    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }

    async resetWatchTime(movieId) {
        try {
            if (!window.WatchTimeManager) {
                this.showToast('Watch time tracking not available', 'error');
                return;
            }

            const watchTimeManager = new WatchTimeManager();
            const success = await watchTimeManager.resetWatchTime(movieId);

            if (success) {
                this.showToast('Watch progress reset successfully', 'success');
                // Refresh the movies to update the UI
                await this.loadMovies();
            } else {
                this.showToast('Failed to reset watch progress', 'error');
            }
        } catch (error) {
            console.error('Error resetting watch time:', error);
            this.showToast('Failed to reset watch progress', 'error');
        }
    }

    updateStats() {
        // Update stats with smooth counter animation
        this.animateCounter('totalMovies', this.movies.length);
        this.animateCounter('filteredCount', this.filteredMovies.length);
        this.animateCounter('genreCount', this.genresCache.size);
    }

    animateCounter(elementId, targetValue) {
        const element = document.getElementById(elementId);
        if (!element) return;

        const startValue = parseInt(element.textContent) || 0;
        const increment = Math.ceil((targetValue - startValue) / 20);
        let currentValue = startValue;

        const updateCounter = () => {
            currentValue += increment;
            if ((increment > 0 && currentValue >= targetValue) || 
                (increment < 0 && currentValue <= targetValue)) {
                element.textContent = targetValue;
                return;
            }
            element.textContent = currentValue;
            requestAnimationFrame(updateCounter);
        };

        if (startValue !== targetValue) {
            updateCounter();
        }
    }

    showLoadingState(show) {
        const loading = document.getElementById('loading');
        const movieGrid = document.getElementById('movieGrid');
        
        if (loading && movieGrid) {
            if (show) {
                loading.classList.remove('hidden');
                movieGrid.classList.add('hidden');
            } else {
                loading.classList.add('hidden');
                movieGrid.classList.remove('hidden');
            }
        }
    }

    showSearchResults() {
        const resultsText = this.currentSearch || this.currentGenre !== 'all' ? 
            `Found ${this.filteredMovies.length} result${this.filteredMovies.length !== 1 ? 's' : ''}` : 
            `Showing all ${this.filteredMovies.length} movies`;
        
        // Show results count briefly
        this.showToast(resultsText, 'info', 2000);
    }

    showError(message) {
        const errorElement = document.getElementById('errorMessage');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.remove('hidden');
            
            setTimeout(() => {
                errorElement.classList.add('hidden');
            }, 10000);
        }
        
        this.showToast(message, 'error');
    }

    showToast(message, type = 'info', duration = 5000) {
        const toast = document.createElement('div');
        const typeClasses = {
            info: 'bg-blue-600',
            success: 'bg-green-600',
            error: 'bg-red-600',
            warning: 'bg-yellow-600'
        };
        
        const icons = {
            info: 'ℹ️',
            success: '✅',
            error: '❌',
            warning: '⚠️'
        };

        toast.className = `toast ${typeClasses[type]} text-white px-6 py-3 rounded-lg shadow-lg z-50 mb-2 transform translate-x-full transition-transform duration-300`;
        toast.innerHTML = `
            <div class="flex items-center space-x-2">
                <span>${icons[type]}</span>
                <span>${message}</span>
            </div>
        `;

        const container = document.getElementById('toastContainer');
        if (container) {
            container.appendChild(toast);
            
            // Show toast
            setTimeout(() => toast.classList.remove('translate-x-full'), 100);
            
            // Hide and remove toast
            setTimeout(() => {
                toast.classList.add('translate-x-full');
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.remove();
                    }
                }, 300);
            }, duration);
        }
    }

    // Utility methods
    truncateText(text, maxLength) {
        if (!text || text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    // Cache management
    getCachedMovies() {
        try {
            const cached = localStorage.getItem('movies_cache');
            const timestamp = localStorage.getItem('movies_cache_timestamp');
            
            if (cached && timestamp) {
                const age = Date.now() - parseInt(timestamp);
                const maxAge = 5 * 60 * 1000; // 5 minutes
                
                if (age < maxAge) {
                    return JSON.parse(cached);
                }
            }
        } catch (error) {
            console.warn('Failed to retrieve cached movies:', error);
        }
        return null;
    }

    cacheMovies(movies) {
        try {
            localStorage.setItem('movies_cache', JSON.stringify(movies));
            localStorage.setItem('movies_cache_timestamp', Date.now().toString());
        } catch (error) {
            console.warn('Failed to cache movies:', error);
        }
    }

    // Animation and UI helpers
    initializeAnimations() {
        // Add intersection observer for scroll animations
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('animate-fade-in');
                    }
                });
            }, { threshold: 0.1 });

            // Observe elements that should animate on scroll
            document.querySelectorAll('.stat-card, .movie-card').forEach(el => {
                observer.observe(el);
            });
        }
    }

    updateLayout() {
        // Handle responsive layout updates
        const movieGrid = document.getElementById('movieGrid');
        if (movieGrid) {
            // Trigger reflow for masonry-like layouts if needed
            movieGrid.style.height = 'auto';
        }
    }

    pauseOperations() {
        // Clear any ongoing timeouts
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
        if (this.loadingTimeout) {
            clearTimeout(this.loadingTimeout);
        }
    }

    resumeOperations() {
        // Resume any paused operations if needed
        console.log('🔄 App operations resumed');
    }

    // Clear all filters
    clearAllFilters() {
        document.getElementById('searchInput').value = '';
        this.currentSearch = '';
        this.setActiveGenre('all');
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🎬 Initializing MovieMag...');
    window.movieApp = new MovieApp();
});

// Global utility functions
window.movieUtils = {
    copyMagnetLink: async (magnetLink) => {
        try {
            await navigator.clipboard.writeText(magnetLink);
            window.movieApp.showToast('Magnet link copied to clipboard!', 'success');
        } catch (err) {
            console.error('Failed to copy:', err);
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = magnetLink;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            window.movieApp.showToast('Magnet link copied to clipboard!', 'success');
        }
    },

    shareMovie: async (movie) => {
        const shareData = {
            title: `${movie.title} - MovieMag`,
            text: `Watch ${movie.title} on MovieMag`,
            url: `${window.location.origin}/player/${movie.id}`
        };

        try {
            if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
                await navigator.share(shareData);
                window.movieApp.showToast('Movie shared successfully!', 'success');
            } else {
                await navigator.clipboard.writeText(shareData.url);
                window.movieApp.showToast('Movie URL copied to clipboard!', 'success');
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Error sharing:', err);
                window.movieApp.showToast('Failed to share movie', 'error');
            }
        }
    },

    downloadPoster: async (movie) => {
        if (!movie.poster_url) {
            window.movieApp.showToast('No poster available', 'warning');
            return;
        }

        try {
            const response = await fetch(movie.poster_url);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `${movie.title}_poster.jpg`;
            
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            window.URL.revokeObjectURL(url);
            window.movieApp.showToast('Poster download started!', 'success');
        } catch (err) {
            console.error('Failed to download poster:', err);
            window.movieApp.showToast('Failed to download poster', 'error');
        }
    }
};

// Global functions for template usage
window.clearFilters = () => {
    if (window.movieApp) {
        window.movieApp.clearAllFilters();
    }
};

// Performance monitoring
if ('performance' in window) {
    window.addEventListener('load', () => {
        setTimeout(() => {
            const timing = performance.timing;
            const loadTime = timing.loadEventEnd - timing.navigationStart;
            console.log(`🚀 App loaded in ${loadTime}ms`);
        }, 0);
    });
}
