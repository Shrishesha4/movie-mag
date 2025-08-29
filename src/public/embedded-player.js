class EmbeddedPlayer {
  constructor() {
    this.client = null;
    this.currentMovie = null;
    this.video = null;
    this.isPlaying = false;
    this.skipTime = 5; 
    this.seekTime = 10; 
    this.volumeStep = 0.05; 
    this.streamMode = "server";
    this.controlsTimeout = null;
    this.controlsVisible = true;
    this.isDraggingProgress = false;
    this.isMouseOverControls = false;

    this.setupEventListeners();
        
    // Ensure player is hidden on page load
    this.ensurePlayerHidden();
  }

  ensurePlayerHidden() {
    const embeddedPlayer = document.getElementById("embeddedPlayer");
    if (embeddedPlayer) {
        embeddedPlayer.style.display = "none";
    }
    
    // Ensure body scroll is enabled
    document.body.classList.remove('player-open');
    document.body.style.overflow = "auto";
    document.body.style.height = "auto";
    }

  setupEventListeners() {
    document.getElementById("closePlayer").addEventListener("click", () => {
        this.closePlayer();
    });

    // Enhanced keyboard controls
    document.addEventListener("keydown", (e) => {
        if (document.getElementById("embeddedPlayer").style.display !== "flex") return;
        
        switch (e.key) {
            case "Escape":
                this.closePlayer();
                break;
            case " ": // Space bar to play/pause
                e.preventDefault();
                this.togglePlayPause();
                break;
            case "ArrowLeft": // Left arrow = 10s back
                e.preventDefault();
                this.seek(-this.seekTime);
                this.showSeekFeedback(`-${this.seekTime}s`);
                break;
            case "ArrowRight": // Right arrow = 10s forward
                e.preventDefault();
                this.seek(this.seekTime);
                this.showSeekFeedback(`+${this.seekTime}s`);
                break;
            case "ArrowUp": // Up arrow = volume up
                e.preventDefault();
                this.changeVolume(this.volumeStep);
                break;
            case "ArrowDown": // Down arrow = volume down
                e.preventDefault();
                this.changeVolume(-this.volumeStep);
                break;
            case "f": // F key for fullscreen
            case "F":
                e.preventDefault();
                this.toggleFullscreen();
                break;
            case "m": // M key to mute/unmute
            case "M":
                e.preventDefault();
                this.toggleMute();
                break;
        }
    });

    // Control buttons
    document.getElementById("playPauseBtn").addEventListener("click", () => this.togglePlayPause());
    document.getElementById("skipBackBtn").addEventListener("click", () => this.skip(-this.skipTime));
    document.getElementById("skipForwardBtn").addEventListener("click", () => this.skip(this.skipTime));
    document.getElementById("volumeSlider").addEventListener("input", (e) => this.setVolume(e.target.value));
    document.getElementById("speedSelect").addEventListener("change", (e) => this.setPlaybackRate(e.target.value));
    document.getElementById("fullscreenBtn").addEventListener("click", () => this.toggleFullscreen());

    // Enhanced progress bar events with YouTube-style interaction
    const progressBar = document.getElementById("progressSlider");
    if (progressBar) {
        // Input event for continuous seeking while dragging
        progressBar.addEventListener("input", (e) => {
            if (this.video && this.video.duration) {
                const progress = parseFloat(e.target.value);
                const seekTime = (progress / 100) * this.video.duration;
                
                // Update video time immediately for smooth scrubbing
                this.video.currentTime = seekTime;
                
                // Update visual feedback
                this.updateProgressSliderStyle(e.target);
                this.updateTimeDisplays();
            }
        });
        
        // Mouse down - start dragging
        progressBar.addEventListener("mousedown", () => {
            this.isDraggingProgress = true;
            this.clearControlsTimeout();
        });
        
        // Mouse up - end dragging 
        progressBar.addEventListener("mouseup", () => {
            this.isDraggingProgress = false;
            this.startControlsAutoHide();
        });
        
        // Touch events for mobile
        progressBar.addEventListener("touchstart", () => {
            this.isDraggingProgress = true;
            this.clearControlsTimeout();
        });
        
        progressBar.addEventListener("touchend", () => {
            this.isDraggingProgress = false;
            this.startControlsAutoHide();
        });

        // Hover effects for time preview
        progressBar.addEventListener("mousemove", (e) => this.updateProgressHover(e));
        progressBar.addEventListener("mouseleave", () => this.clearProgressHover());
    }

  }

  async openPlayer(movieId) {
    console.log("Opening embedded player for movie:", movieId);

    // Show player and prevent body scroll
    const embeddedPlayer = document.getElementById("embeddedPlayer");
    embeddedPlayer.style.display = "flex";
    embeddedPlayer.style.overflow = "hidden";
    
    // Add class to body to prevent scrolling
    document.body.classList.add('player-open');
    document.body.style.overflow = "hidden";
    document.body.style.height = "100vh";

    // Load movie data
    try {
        const userToken = localStorage.getItem('userToken');
        const response = await fetch(`/api/movies/${movieId}`, {
            headers: {
                'Authorization': `Bearer ${userToken}`
            }
        });
        if (!response.ok) throw new Error("Movie not found");

        this.currentMovie = await response.json();
        document.getElementById("currentMovieTitle").textContent = this.currentMovie.title;

        this.startStreaming();
        
    } catch (error) {
        console.error("Error loading movie:", error);
        this.showError("Failed to load movie: " + error.message);
    }
  }

  closePlayer() {
    console.log("Closing embedded player");

    // Clear any timeouts
    if (this.controlsTimeout) {
        clearTimeout(this.controlsTimeout);
    }
    
    if (this.progressUpdateTimeout) {
        clearTimeout(this.progressUpdateTimeout);
    }

    // Cleanup watch time tracking
    if (this.watchTimeManager) {
      this.watchTimeManager.cleanup();
      this.watchTimeManager = null;
    }

    // Hide player and restore body scroll
    const embeddedPlayer = document.getElementById("embeddedPlayer");
    embeddedPlayer.style.display = "none";
    
    // Remove class from body to restore scrolling
    document.body.classList.remove('player-open');
    document.body.style.overflow = "auto";
    document.body.style.height = "auto";

    // Cleanup
    if (this.video) {
      this.video.pause();
      this.video.remove();
      this.video = null;
    }

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }

    // Reset UI
    document.getElementById("loadingOverlay").style.display = "block";
    document.getElementById("customControls").style.display = "none";
    document.getElementById("videoElement").innerHTML = "";
    document.getElementById("loadingText").textContent = "Loading...";
    document.getElementById("torrentProgress").style.display = "none";

    // Reset state
    this.controlsVisible = true;
    this.isDraggingProgress = false;
    this.isMouseOverControls = false;
  }

  async startStreaming() {
    if (!this.currentMovie.magnet) {
      this.showError("No magnet link available");
      return;
    }

    console.log("🚀 Starting streaming...");
    this.updateLoadingText("Analyzing torrent...");

    const torrentProgress = document.getElementById("torrentProgress");
    if (torrentProgress) {
      torrentProgress.style.display = "block";
    }

    try {
      await this.tryServerSideStreaming();
    } catch (error) {
      console.log("Server-side streaming failed, trying WebTorrent...", error.message);
      this.tryWebTorrentStreaming();
    }
  }

  async tryServerSideStreaming() {
    const magnetEncoded = encodeURIComponent(this.currentMovie.magnet);

    console.log("📡 Trying server-side streaming...");
    this.updateLoadingText("Connecting to server...");

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const userToken = localStorage.getItem('userToken');
      const infoResponse = await fetch(`/api/torrent/info/${magnetEncoded}`, {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${userToken}`
        }
      });

      clearTimeout(timeoutId);

      if (!infoResponse.ok) {
        throw new Error(`Server returned ${infoResponse.status}`);
      }

      const torrentInfo = await infoResponse.json();
      console.log("✅ Server torrent info received:", torrentInfo);

      if (torrentInfo.files.length === 0) {
        throw new Error("No video files found in torrent");
      }

      const largestFile = torrentInfo.files.reduce((prev, current) =>
        prev.length > current.length ? prev : current
      );

      console.log("🎥 Selected video file:", largestFile.name);
      this.streamMode = "server";
      this.setupServerStream(magnetEncoded, largestFile.index);
    } catch (error) {
      console.error("Server-side streaming failed:", error);
      throw error;
    }
  }

  updateLoadingText(text) {
    const element = document.getElementById("loadingText");
    if (element) {
      element.textContent = text;
    }
    console.log("Loading status:", text);
  }

  setupServerStream(magnetEncoded, fileIndex) {
    const streamUrl = `/api/torrent/stream/${magnetEncoded}/${fileIndex}`;

    console.log("🎬 Setting up server stream:", streamUrl);
    document.getElementById("loadingText").textContent = "Starting video stream...";

    this.video = document.createElement("video");
    this.video.controls = false; // Disable default controls - we'll use custom ones
    this.video.style.width = "100%";
    this.video.style.height = "100%";
    this.video.style.objectFit = "contain";
    
    // AGGRESSIVE PRELOADING SETTINGS
    this.video.preload = "auto"; // Preload entire video aggressively
    this.video.preload = "metadata"; // Start with metadata, then switch to auto
    
    // Enhanced buffering settings (buffered is read-only, managed by browser)
    // this.video.buffered is read-only and managed by the browser
    // this.video.readyState is read-only and managed by the browser
    
    // Set aggressive buffer settings
    this.video.addEventListener('loadedmetadata', () => {
        // Switch to aggressive preloading after metadata is loaded
        this.video.preload = "auto";
        
        // Set custom buffer settings if supported
        if (this.video.buffered && this.video.buffered.length > 0) {
            console.log("🎬 Initial buffer loaded:", this.video.buffered.end(0));
        }
    });
    
    // Monitor buffering progress
    this.video.addEventListener('progress', () => {
        if (this.video.buffered && this.video.buffered.length > 0) {
            const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
            const duration = this.video.duration || 0;
            const bufferPercentage = (bufferedEnd / duration) * 100;
            console.log(`🎬 Buffer progress: ${bufferPercentage.toFixed(1)}% (${this.formatTime(bufferedEnd)})`);
            
            // Show buffer progress in UI
            this.updateBufferProgress(bufferPercentage);
        }
    });
    
    // Enhanced error handling for buffering
    this.video.addEventListener('stalled', () => {
        console.warn("⚠️ Video stalled, attempting to resume...");
        this.showToast("Buffering...", "info");
    });
    
    this.video.addEventListener('waiting', () => {
        console.log("⏳ Video waiting for data...");
        this.showToast("Loading more data...", "info");
    });
    
    this.video.addEventListener('canplay', () => {
        console.log("✅ Video can start playing");
        this.hideToast();
    });
    
    this.video.addEventListener('canplaythrough', () => {
        console.log("✅ Video can play through without interruption");
        this.hideToast();
        
        // Start aggressive preloading once video is ready
        this.startAggressivePreloading();
    });
    
    this.video.src = streamUrl;

    const container = document.getElementById("videoElement");
    container.appendChild(this.video);

    document.getElementById("loadingOverlay").style.display = "none";
    document.getElementById("customControls").style.display = "flex";

    this.setupVideoEvents();
    this.setupMouseEvents();
    this.initializeCustomControls();

    // Initialize watch time tracking
    if (window.WatchTimeManager && this.currentMovie) {
      this.watchTimeManager = new WatchTimeManager();
      this.watchTimeManager.initWatchTimeTracking(this.currentMovie.id, this.video);
    }

    // Auto-play
    this.video.play().then(() => {
      console.log("🎬 Server stream started playing");
      this.isPlaying = true;
      this.updatePlayButton();
      this.startControlsAutoHide();
    }).catch((error) => {
      console.warn("Autoplay failed:", error);
      this.showClickToPlayMessage();
    });
  }

  tryWebTorrentStreaming() {
    console.log("🌐 Starting WebTorrent streaming...");
    this.updateLoadingText("Connecting to torrent network...");

    // Enhanced WebTorrent configuration for better streaming
    this.client = new WebTorrent({
        maxConns: 100,        // Reduce connections to prevent stalling
        downloadLimit: -1,   // No download limit
        uploadLimit: -1,   // Limit upload to focus on download
        dht: true,
        lsd: false,          // Disable Local Service Discovery in browser
        webSeeds: true,
        utp: false,          // Disable uTP for browser compatibility
        tracker: {
            announce: [
                'wss://tracker.openwebtorrent.com',
                'wss://tracker.btorrent.xyz',
                'wss://tracker.webtorrent.dev',
                'udp://tracker.opentrackr.org:1337/announce',
                'udp://explodie.org:6969/announce',
                'udp://tracker.openbittorrent.com:80/announce',
                'udp://tracker.internetwarriors.net:1337/announce',
                'udp://open.demonii.com:1337/announce',
                'udp://open.stealth.si:80/announce',
                'udp://exodus.desync.com:6969/announce',
                'udp://tracker.bittor.pw:1337/announce',
                 // Keep some WSS trackers but don't rely on them entirely
                 'wss://tracker.openwebtorrent.com',
                 'wss://tracker.btorrent.xyz',
                 
                 // Add reliable UDP trackers
                 'udp://tracker.openbittorrent.com:80/announce',
                 'udp://tracker.opentrackr.org:1337/announce',
                 'udp://explodie.org:6969/announce',
                 'udp://tracker.internetwarriors.net:1337/announce',
                 'udp://tracker.opentrackr.org:1337/announce',
                 'udp://open.demonii.com:1337/announce',
                 'udp://open.stealth.si:80/announce',
                 'udp://explodie.org:6969/announce',
                 'udp://exodus.desync.com:6969/announce',
                 'udp://tracker.bittor.pw:1337/announce',
                 'udp://open.free-tracker.ga:6969/announce',
                 'udp://leet-tracker.moe:1337/announce',
                 'udp://isk.richardsw.club:6969/announce',
                 'udp://hificode.in:6969/announce',
                 'udp://discord.heihachi.pw:6969/announce',
                 'udp://tracker.opentrackr.org:1337/announce',
                 'udp://open.demonii.com:1337/announce',
                 'udp://open.stealth.si:80/announce',
                 'udp://explodie.org:6969/announce',
                 'udp://exodus.desync.com:6969/announce',
                 'udp://tracker.bittor.pw:1337/announce',
                 'udp://open.free-tracker.ga:6969/announce',
                 'udp://leet-tracker.moe:1337/announce',
                 'udp://isk.richardsw.club:6969/announce',
                 'udp://hificode.in:6969/announce',
                 'udp://discord.heihachi.pw:6969/announce',
                 'udp://udp.tracker.projectk.org:23333/announce',
                 'udp://ttk2.nbaonlineservice.com:6969/announce',
                 'udp://tracker2.dler.org:80/announce',
                 'udp://tracker.zupix.online:6969/announce',
                 'udp://tracker.valete.tf:9999/announce',
                 'udp://tracker.torrust-demo.com:6969/announce',
                 'udp://tracker.therarbg.to:6969/announce',
                 'udp://tracker.theoks.net:6969/announce',
                 'udp://tracker.srv00.com:6969/announce',
                 'udp://tracker.skillindia.site:6969/announce',
                 'udp://tracker.plx.im:6969/announce',
                 'udp://tracker.kmzs123.cn:17272/announce',
                 'udp://tracker.hifitechindia.com:6969/announce',
                 'udp://tracker.hifimarket.in:2710/announce',
                 'udp://tracker.healthcareindia.store:1337/announce',
                 'udp://tracker.gmi.gd:6969/announce',
                 'udp://tracker.gigantino.net:6969/announce',
                 'udp://tracker.fnix.net:6969/announce',
                 'udp://tracker.filemail.com:6969/announce',
                 'udp://tracker.dler.org:6969/announce',
                 'udp://tracker.bitcoinindia.space:6969/announce',
                 'udp://tracker-udp.gbitt.info:80/announce',
                 'udp://tr4ck3r.duckdns.org:6969/announce',
                 'udp://t.overflow.biz:6969/announce',
                 'udp://retracker01-msk-virt.corbina.net:80/announce',
                 'udp://retracker.lanta.me:2710/announce',
                 'udp://public.tracker.vraphim.com:6969/announce',
                 'udp://p4p.arenabg.com:1337/announce',
                 'udp://opentracker.io:6969/announce',
                 'udp://open.dstud.io:6969/announce',
                 'udp://martin-gebhardt.eu:25/announce',
                 'udp://ipv4announce.sktorrent.eu:6969/announce',
                 'udp://evan.im:6969/announce',
                 'udp://d40969.acod.regrucolo.ru:6969/announce',
                 'udp://bittorrent-tracker.e-n-c-r-y-p-t.net:1337/announce',
                 'udp://bandito.byterunner.io:6969/announce',
                 'udp://6ahddutb1ucc3cp.ru:6969/announce',
                 'udp://1c.premierzal.ru:6969/announce',
                 'udp://tracker.yume-hatsuyuki.moe:6969/announce',
                 'udp://ipv4.rer.lol:2710/announce',
                 'udp://concen.org:6969/announce',
                 'udp://bt.rer.lol:6969/announce',
                 'udp://bt.rer.lol:2710/announce',
                 'http://www.torrentsnipe.info:2701/announce',
                 'http://www.genesis-sp.org:2710/announce',
                 'http://tracker810.xyz:11450/announce',
                 'http://tracker.xiaoduola.xyz:6969/announce',
                 'http://tracker.vanitycore.co:6969/announce',
                 'http://tracker.sbsub.com:2710/announce',
                 'http://tracker.moxing.party:6969/announce',
                 'http://tracker.lintk.me:2710/announce',
                 'http://tracker.ipv6tracker.org:80/announce',
                 'wss://tracker.btorrent.xyz:443/announce',
                 'wss://tracker.webtorrent.dev:443/announce',
                 'wss://tracker.ghostchu-services.top:443/announce',
                 'wss://tracker.files.fm:7073/announce',
                 'ws://tracker.ghostchu-services.top:80/announce',
                 'ws://tracker.files.fm:7072/announce',
                 'udp://tracker.opentrackr.org:1337/announce',
                  'udp://p4p.arenabg.com:1337/announce',
                  'udp://d40969.acod.regrucolo.ru:6969/announce',
                  'udp://evan.im:6969/announce',
                  'https://tracker.jdx3.org:443/announce',
                  'udp://retracker.lanta.me:2710/announce',
                  'http://lucke.fenesisu.moe:6969/announce',
                  'http://tracker.renfei.net:8080/announce',
                  'https://tracker.expli.top:443/announce',
                  'https://tr.nyacat.pw:443/announce',
                  'udp://tracker.ducks.party:1984/announce',
                  'udp://extracker.dahrkael.net:6969/announce',
                  'http://ipv4.rer.lol:2710/announce',
                  'udp://tracker.tvunderground.org.ru:3218/announce',
                  'udp://tracker.kmzs123.cn:17272/announce',
                  'https://tracker.alaskantf.com:443/announce',
                  'udp://tracker.dler.com:6969/announce',
                  'http://bt.okmp3.ru:2710/announce',
                  'udp://tracker.torrent.eu.org:451/announce',
                  'http://tracker.mywaifu.best:6969/announce',
                  'udp://bandito.byterunner.io:6969/announce',
                  'udp://tracker.plx.im:6969/announce',
                  'udp://open.stealth.si:80/announce',
                  'https://tracker.moeblog.cn:443/announce',
                  'https://tracker.yemekyedim.com:443/announce',
                  'udp://tracker.fnix.net:6969/announce',
                  'udp://martin-gebhardt.eu:25/announce',
                  'udp://tracker.valete.tf:9999/announce',
                  'http://tracker.bt4g.com:2095/announce',
                  'udp://retracker01-msk-virt.corbina.net:80/announce',
                  'udp://tracker.srv00.com:6969/announce',
                  'udp://open.demonii.com:1337/announce',
                  'udp://tracker.torrust-demo.com:6969/announce',
                  'udp://www.torrent.eu.org:451/announce',
                  'udp://bt.bontal.net:6969/announce',
                  'http://open.trackerlist.xyz:80/announce',
                  'udp://tracker.gigantino.net:6969/announce',
                  'http://0123456789nonexistent.com:80/announce',
                  'udp://opentracker.io:6969/announce',
                  'http://torrent.hificode.in:6969/announce',
                  'udp://tracker.therarbg.to:6969/announce',
                  'udp://1c.premierzal.ru:6969/announce',
                  'udp://tracker.cloudbase.store:1333/announce',
                  'http://shubt.net:2710/announce',
                  'udp://tracker.zupix.online:1333/announce',
                  'udp://tracker.rescuecrew7.com:1337/announce',
                  'udp://tracker.startwork.cv:1337/announce',
                  'udp://tracker.skillindia.site:6969/announce',
                  'udp://tracker.hifitechindia.com:6969/announce',
                  'udp://tracker.bitcoinindia.space:6969/announce',
                  'udp://ttk2.nbaonlineservice.com:6969/announce',
                  'https://tracker.zhuqiy.top:443/announce',
                  'https://2.tracker.eu.org:443/announce',
                  'udp://tracker.hifimarket.in:2710/announce',
                  'https://4.tracker.eu.org:443/announce',
                  'https://3.tracker.eu.org:443/announce',
                  'udp://tr4ck3r.duckdns.org:6969/announce',
                  'https://shahidrazi.online:443/announce',
                  'udp://6ahddutb1ucc3cp.ru:6969/announce',
                  'udp://public.popcorn-tracker.org:6969/announce',
                  'http://104.28.1.30:8080/announce',
                  'http://104.28.16.69/announce',
                  'http://107.150.14.110:6969/announce',
                  'http://109.121.134.121:1337/announce',
                  'http://114.55.113.60:6969/announce',
                  'http://125.227.35.196:6969/announce',
                  'http://128.199.70.66:5944/announce',
                  'http://157.7.202.64:8080/announce',
                  'http://158.69.146.212:7777/announce',
                  'http://173.254.204.71:1096/announce',
                  'http://178.175.143.27/announce',
                  'http://178.33.73.26:2710/announce',
                  'http://182.176.139.129:6969/announce',
                  'http://185.5.97.139:8089/announce',
                  'http://188.165.253.109:1337/announce',
                  'http://194.106.216.222/announce',
                  'http://195.123.209.37:1337/announce',
                  'http://210.244.71.25:6969/announce',
                  'http://210.244.71.26:6969/announce',
                  'http://213.159.215.198:6970/announce',
                  'http://213.163.67.56:1337/announce',
                  'http://37.19.5.139:6969/announce',
                  'http://37.19.5.155:6881/announce',
                  'http://46.4.109.148:6969/announce',
                  'http://5.79.249.77:6969/announce',
                  'http://5.79.83.193:2710/announce',
                  'http://51.254.244.161:6969/announce',
                  'http://59.36.96.77:6969/announce',
                  'http://74.82.52.209:6969/announce',
                  'http://80.246.243.18:6969/announce',
                  'http://81.200.2.231/announce',
                  'http://85.17.19.180/announce',
                  'http://87.248.186.252:8080/announce',
                  'http://87.253.152.137/announce',
                  'http://91.216.110.47/announce',
                  'http://91.217.91.21:3218/announce',
                  'http://91.218.230.81:6969/announce',
                  'http://93.92.64.5/announce',
                  'http://atrack.pow7.com/announce',
                  'http://bt.henbt.com:2710/announce',
                  'http://bt.pusacg.org:8080/announce',
                  'http://bt2.careland.com.cn:6969/announce',
                  'http://explodie.org:6969/announce',
                  'http://mgtracker.org:2710/announce',
                  'http://mgtracker.org:6969/announce',
                  'http://open.acgtracker.com:1096/announce',
                  'http://open.lolicon.eu:7777/announce',
                  'http://open.touki.ru/announce.php',
                  'http://p4p.arenabg.ch:1337/announce',
                  'http://p4p.arenabg.com:1337/announce',
                  'http://pow7.com:80/announce',
                  'http://retracker.gorcomnet.ru/announce',
                  'http://retracker.krs-ix.ru/announce',
                  'http://retracker.krs-ix.ru:80/announce',
                  'http://secure.pow7.com/announce',
                  'http://t1.pow7.com/announce',
                  'http://t2.pow7.com/announce',
                  'http://thetracker.org:80/announce',
                  'http://torrent.gresille.org/announce',
                  'http://torrentsmd.com:8080/announce',
                  'http://tracker.aletorrenty.pl:2710/announce',
                  'http://tracker.baravik.org:6970/announce',
                  'http://tracker.bittor.pw:1337/announce',
                  'http://tracker.bittorrent.am/announce',
                  'http://tracker.calculate.ru:6969/announce',
                  'http://tracker.dler.org:6969/announce',
                  'http://tracker.dutchtracking.com/announce',
                  'http://tracker.dutchtracking.com:80/announce',
                  'http://tracker.dutchtracking.nl/announce',
                  'http://tracker.dutchtracking.nl:80/announce',
                  'http://tracker.edoardocolombo.eu:6969/announce',
                  'http://tracker.ex.ua/announce',
                  'http://tracker.ex.ua:80/announce',
                  'http://tracker.filetracker.pl:8089/announce',
                  'http://tracker.flashtorrents.org:6969/announce',
                  'http://tracker.grepler.com:6969/announce',
                  'http://tracker.internetwarriors.net:1337/announce',
                  'http://tracker.kicks-ass.net/announce',
                  'http://tracker.kicks-ass.net:80/announce',
                  'http://tracker.kuroy.me:5944/announce',
                  'http://tracker.mg64.net:6881/announce',
                  'http://tracker.opentrackr.org:1337/announce',
                  'http://tracker.skyts.net:6969/announce',
                  'http://tracker.tfile.me/announce',
                  'http://tracker.tiny-vps.com:6969/announce',
                  'http://tracker.tvunderground.org.ru:3218/announce',
                  'http://tracker.yoshi210.com:6969/announce',
                  'http://tracker1.wasabii.com.tw:6969/announce',
                  'http://tracker2.itzmx.com:6961/announce',
                  'http://tracker2.wasabii.com.tw:6969/announce',
                  'http://www.wareztorrent.com/announce',
                  'http://www.wareztorrent.com:80/announce',
                  'https://104.28.17.69/announce',
                  'https://www.wareztorrent.com/announce',
                  'udp://107.150.14.110:6969/announce',
                  'udp://109.121.134.121:1337/announce',
                  'udp://114.55.113.60:6969/announce',
                  'udp://128.199.70.66:5944/announce',
                  'udp://151.80.120.114:2710/announce',
                  'udp://168.235.67.63:6969/announce',
                  'udp://178.33.73.26:2710/announce',
                  'udp://182.176.139.129:6969/announce',
                  'udp://185.5.97.139:8089/announce',
                  'udp://185.86.149.205:1337/announce',
                  'udp://188.165.253.109:1337/announce',
                  'udp://191.101.229.236:1337/announce',
                  'udp://194.106.216.222:80/announce',
                  'udp://195.123.209.37:1337/announce',
                  'udp://195.123.209.40:80/announce',
                  'udp://208.67.16.113:8000/announce',
                  'udp://213.163.67.56:1337/announce',
                  'udp://37.19.5.155:2710/announce',
                  'udp://46.4.109.148:6969/announce',
                  'udp://5.79.249.77:6969/announce',
                  'udp://5.79.83.193:6969/announce',
                  'udp://51.254.244.161:6969/announce',
                  'udp://62.138.0.158:6969/announce',
                  'udp://62.212.85.66:2710/announce',
                  'udp://74.82.52.209:6969/announce',
                  'udp://85.17.19.180:80/announce',
                  'udp://89.234.156.205:80/announce',
                  'udp://9.rarbg.com:2710/announce',
                  'udp://9.rarbg.me:2780/announce',
                  'udp://9.rarbg.to:2730/announce',
                  'udp://91.218.230.81:6969/announce',
                  'udp://94.23.183.33:6969/announce',
                  'udp://bt.xxx-tracker.com:2710/announce',
                  'udp://eddie4.nl:6969/announce',
                  'udp://explodie.org:6969/announce',
                  'udp://mgtracker.org:2710/announce',
                  'udp://open.stealth.si:80/announce',
                  'udp://p4p.arenabg.com:1337/announce',
                  'udp://shadowshq.eddie4.nl:6969/announce',
                  'udp://shadowshq.yi.org:6969/announce',
                  'udp://torrent.gresille.org:80/announce',
                  'udp://tracker.aletorrenty.pl:2710/announce',
                  'udp://tracker.bittor.pw:1337/announce',
                  'udp://tracker.coppersurfer.tk:6969/announce',
                  'udp://tracker.eddie4.nl:6969/announce',
                  'udp://tracker.ex.ua:80/announce',
                  'udp://tracker.filetracker.pl:8089/announce',
                  'udp://tracker.flashtorrents.org:6969/announce',
                  'udp://tracker.grepler.com:6969/announce',
                  'udp://tracker.ilibr.org:80/announce',
                  'udp://tracker.internetwarriors.net:1337/announce',
                  'udp://tracker.kicks-ass.net:80/announce',
                  'udp://tracker.kuroy.me:5944/announce',
                  'udp://tracker.leechers-paradise.org:6969/announce',
                  'udp://tracker.mg64.net:2710/announce',
                  'udp://tracker.mg64.net:6969/announce',
                  'udp://tracker.opentrackr.org:1337/announce',
                  'udp://tracker.piratepublic.com:1337/announce',
                  'udp://tracker.sktorrent.net:6969/announce',
                  'udp://tracker.skyts.net:6969/announce',
                  'udp://tracker.tiny-vps.com:6969/announce',
                  'udp://tracker.yoshi210.com:6969/announce',
                  'udp://tracker2.indowebster.com:6969/announce',
                  'udp://tracker4.piratux.com:6969/announce',
                  'udp://zer0day.ch:1337/announce',
                  'udp://zer0day.to:1337/announce'
            ]
        }
    });

    // Add error handling for WebTorrent client
    this.client.on('error', (err) => {
        console.error("❌ WebTorrent client error:", err);
        this.showError("Torrent client error: " + err.message);
    });

    // Add the torrent with proper timeout
    const torrent = this.client.add(this.currentMovie.magnet);

    // Set up torrent event handlers
    torrent.on('error', (err) => {
        console.error("❌ Torrent error:", err);
        this.showError("Torrent error: " + err.message);
    });

    torrent.on('warning', (warn) => {
        console.warn("⚠️ Torrent warning:", warn);
    });

    // Handle torrent ready state
    const handleTorrentReady = () => {
        try {
            console.log("✅ Torrent ready! Files:", torrent.files.length);

            // Find video files
            const videoFiles = torrent.files.filter(file => 
                /\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(file.name)
            );

            if (videoFiles.length === 0) {
                throw new Error("No video files found in torrent");
            }

            // Select the largest video file
            const videoFile = videoFiles.reduce((prev, current) =>
                prev.length > current.length ? prev : current
            );

            console.log("🎬 Selected video:", videoFile.name);
            this.setupWebTorrentVideo(videoFile);

        } catch (error) {
            console.error("❌ Error processing torrent files:", error);
            this.showError("Failed to process video files: " + error.message);
        }
    };

    // Handle torrent events
    if (torrent.ready) {
        handleTorrentReady();
    } else {
        torrent.on('ready', handleTorrentReady);
        
        // Add timeout for torrent ready
        setTimeout(() => {
            if (!torrent.ready) {
                console.error("❌ Torrent ready timeout");
                this.showError("Torrent loading timeout. Please try a different movie or check your connection.");
            }
        }, 30000); // 30 second timeout
    }

    // Progress monitoring
    const progressInterval = setInterval(() => {
        if (torrent.progress > 0) {
            const progress = Math.round(torrent.progress * 100);
            this.updateLoadingText(`Downloading... ${progress}%`);
            
            // Update progress bar
            const progressBar = document.getElementById("progressBar");
            const progressText = document.getElementById("progressText");
            const downloadSpeed = document.getElementById("downloadSpeed");
            const peersCount = document.getElementById("peersCount");

            if (progressBar) progressBar.style.width = progress + "%";
            if (progressText) progressText.textContent = progress + "%";
            if (downloadSpeed) downloadSpeed.textContent = this.formatBytes(torrent.downloadSpeed) + "/s";
            if (peersCount) peersCount.textContent = torrent.numPeers;

            if (torrent.progress >= 0.05) { // Start playing at 5% download
                clearInterval(progressInterval);
            }
        }
    }, 1000);
  }

  setupWebTorrentVideo(file) {
    console.log("🎥 Setting up video element...");
    
    this.video = document.createElement("video");
    this.video.controls = false;
    this.video.style.width = "100%";
    this.video.style.height = "100%";
    this.video.style.objectFit = "contain";
    this.video.preload = "metadata";
    this.video.autoplay = false; // Don't autoplay to prevent issues

    const container = document.getElementById("videoElement");
    container.innerHTML = ""; // Clear any existing content
    container.appendChild(this.video);

    // Use renderTo for better compatibility
    file.renderTo(this.video, (err) => {
        if (err) {
            console.error("❌ Video render error:", err);
            this.showError("Video setup failed: " + err.message);
            return;
        }

        console.log("✅ Video ready for playback");

        // Hide loading overlay and show controls
        document.getElementById("loadingOverlay").style.display = "none";
        document.getElementById("customControls").style.display = "flex";

        // Setup video events
        this.setupVideoEvents();
        this.setupMouseEvents();
        this.initializeCustomControls();

        // Try to start playback
        this.video.play().then(() => {
            console.log("🎬 Video started playing");
            this.isPlaying = true;
            this.updatePlayButton();
            this.startControlsAutoHide();
        }).catch((error) => {
            console.warn("Autoplay prevented:", error);
            this.showClickToPlayMessage();
        });
    });
  }

  setupVideoEvents() {
    this.video.addEventListener("play", () => {
      this.isPlaying = true;
      this.updatePlayButton();
      this.startControlsAutoHide();
    });

    this.video.addEventListener("pause", () => {
      this.isPlaying = false;
      this.updatePlayButton();
      this.showControls(); // Show controls when paused
      this.clearControlsTimeout();
    });

    this.video.addEventListener("timeupdate", () => {
      this.updateProgressBar();
      this.updateTimeDisplays();
      
      // Send watch progress to server for caching (debounced)
      if (this.currentMovie && this.currentMovie.magnet) {
        const progress = this.video.currentTime / this.video.duration;
        if (!isNaN(progress) && progress > 0) {
          this.sendWatchProgressDebounced(progress);
        }
      }
    });

    this.video.addEventListener("loadedmetadata", () => {
      this.updateProgressBar();
      this.updateTimeDisplays();
    });

    this.video.addEventListener("durationchange", () => {
      this.updateProgressBar();
      this.updateTimeDisplays();
    });

    this.video.addEventListener("volumechange", () => {
      const volumeSlider = document.getElementById("volumeSlider");
      if (volumeSlider) {
        volumeSlider.value = this.video.volume * 100;
      }
    });

    this.video.addEventListener("error", (e) => {
      console.error("Video playback error:", e);
      this.showError("Video playback error: " + (e.message || "Unknown error"));
    });

    // Click video to toggle play/pause or show controls (disabled on mobile)
    this.video.addEventListener("click", () => {
      // Disable tap to pause on mobile devices (including landscape)
      const isMobile = window.innerWidth <= 768 || 
                      window.innerHeight <= 768 || 
                      ('ontouchstart' in window) || 
                      (navigator.maxTouchPoints > 0);
      
      if (isMobile) {
        // On mobile, only show/hide controls, don't toggle play/pause
        if (!this.controlsVisible) {
          this.showControls();
        }
        return;
      }
      
      // Desktop behavior: toggle play/pause or show controls
      if (this.controlsVisible) {
        this.togglePlayPause();
      } else {
        this.showControls();
      }
    });
  }

  setupMouseEvents() {
    const player = document.getElementById("embeddedPlayer");
    const controls = document.getElementById("customControls");

    // Mouse movement over player
    player.addEventListener("mousemove", () => {
      this.showControls();
      if (this.isPlaying) {
        this.startControlsAutoHide();
      }
    });

    // Mouse leave player
    player.addEventListener("mouseleave", () => {
      if (this.isPlaying && !this.isMouseOverControls) {
        this.hideControls();
      }
    });

    // Mouse over/out of controls
    controls.addEventListener("mouseenter", () => {
      this.isMouseOverControls = true;
      this.clearControlsTimeout();
    });

    controls.addEventListener("mouseleave", () => {
      this.isMouseOverControls = false;
      if (this.isPlaying) {
        this.startControlsAutoHide();
      }
    });
  }

  initializeCustomControls() {
    // Initialize progress slider with YouTube-style styling
    const progressSlider = document.getElementById("progressSlider");
    if (progressSlider) {
      progressSlider.value = 0;
      this.updateProgressSliderStyle(progressSlider);
    }

    // Initialize time displays
    this.updateTimeDisplays();
  }

  startControlsAutoHide() {
    this.clearControlsTimeout();
    if (this.isPlaying && !this.isMouseOverControls) {
      this.controlsTimeout = setTimeout(() => {
        this.hideControls();
      }, 3000); // Hide after 3 seconds of inactivity
    }
  }

  clearControlsTimeout() {
    if (this.controlsTimeout) {
      clearTimeout(this.controlsTimeout);
      this.controlsTimeout = null;
    }
  }

  showControls() {
    const controls = document.getElementById("customControls");
    const header = document.querySelector("#embeddedPlayer .absolute.top-0");

    if (controls) {
      controls.style.opacity = "1";
      controls.style.visibility = "visible";
      controls.style.transform = "translateY(0)";
    }
    if (header) {
      header.style.opacity = "1";
      header.style.visibility = "visible";
    }

    this.controlsVisible = true;
    document.body.style.cursor = "default";
  }

  hideControls() {
    const controls = document.getElementById("customControls");
    const header = document.querySelector("#embeddedPlayer .absolute.top-0");

    if (controls) {
      controls.style.opacity = "0";
      controls.style.visibility = "hidden";
      controls.style.transform = "translateY(20px)";
    }
    if (header) {
      header.style.opacity = "0";
      header.style.visibility = "hidden";
    }

    this.controlsVisible = false;
    document.body.style.cursor = "none";
  }

  updateProgressBar() {
    if (!this.video || this.isDraggingProgress) return;

    const progressSlider = document.getElementById("progressSlider");
    if (progressSlider && this.video.duration) {
      const progress = (this.video.currentTime / this.video.duration) * 100;
      progressSlider.value = progress;
      this.updateProgressSliderStyle(progressSlider);
    }
  }

  updateProgressSliderStyle(slider) {
    if (!slider || !this.video) return;
    
    const value = slider.value;
    const max = slider.max || 100;
    const percentage = (value / max) * 100;
    
    // Set CSS custom property for gradient
    slider.style.setProperty('--progress', `${percentage}%`);
    
    // YouTube-style progress bar styling with better visibility
    slider.style.background = `linear-gradient(to right, 
      #ff0000 0%, 
      #ff0000 ${percentage}%, 
      rgba(255,255,255,0.3) ${percentage}%, 
      rgba(255,255,255,0.3) 100%)`;
    
    // Make the slider more visible
    slider.style.height = "4px";
    slider.style.borderRadius = "2px";
    slider.style.outline = "none";
    slider.style.cursor = "pointer";
    
    // Custom thumb styling
    const style = `
      #progressSlider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ff0000;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
        opacity: ${this.controlsVisible ? '1' : '0'};
        transition: opacity 0.2s ease;
      }
      
      #progressSlider::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ff0000;
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      }
      
      #progressSlider:hover::-webkit-slider-thumb {
        width: 16px;
        height: 16px;
        opacity: 1;
      }
      
      #progressSlider:hover {
        height: 6px;
      }
    `;
    
    // Add the style to document head if not already present
    if (!document.getElementById('progress-slider-style')) {
      const styleElement = document.createElement('style');
      styleElement.id = 'progress-slider-style';
      styleElement.textContent = style;
      document.head.appendChild(styleElement);
    }
  }

  updateProgressHover(e) {
    if (!this.video || !this.video.duration) return;
    
    const progressSlider = document.getElementById("progressSlider");
    const rect = progressSlider.getBoundingClientRect();
    const percentage = (e.clientX - rect.left) / rect.width;
    const hoverTime = Math.max(0, Math.min(this.video.duration, percentage * this.video.duration));
    
    // Show time tooltip on hover
    progressSlider.title = this.formatTime(hoverTime);
    
    // Optional: Add visual hover indicator
    const hoverPosition = Math.max(0, Math.min(100, percentage * 100));
    progressSlider.style.background = `linear-gradient(to right, 
      #ff0000 0%, 
      #ff0000 ${progressSlider.value}%, 
      rgba(255,255,255,0.5) ${hoverPosition - 1}%,
      rgba(255,255,255,0.7) ${hoverPosition}%,
      rgba(255,255,255,0.5) ${hoverPosition + 1}%,
      rgba(255,255,255,0.3) ${hoverPosition + 1}%, 
      rgba(255,255,255,0.3) 100%)`;
  }

  clearProgressHover() {
    const progressSlider = document.getElementById("progressSlider");
    if (progressSlider) {
      progressSlider.title = "";
      this.updateProgressSliderStyle(progressSlider);
    }
  }

  handleProgressChange(e) {
    if (!this.video || !this.video.duration) return;

    const progress = parseFloat(e.target.value);
    const newTime = (progress / 100) * this.video.duration;
    
    // Only update visual slider style during drag, not video time
    this.updateProgressSliderStyle(e.target);
    
    // Always update time displays for immediate feedback
    this.updateTimeDisplays();
}


  updateTimeDisplays() {
    const currentTimeEl = document.getElementById("currentTime");
    const totalTimeEl = document.getElementById("totalTime");

    if (this.video && currentTimeEl && totalTimeEl) {
      currentTimeEl.textContent = this.formatTime(this.video.currentTime || 0);
      totalTimeEl.textContent = this.formatTime(this.video.duration || 0);
    }
  }

  formatTime(seconds) {
    if (isNaN(seconds) || seconds === undefined) return "0:00";
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }

  togglePlayPause() {
    if (!this.video) return;

    if (this.video.paused) {
      if (this.video.muted && this.streamMode === "webtorrent") {
        this.video.muted = false;
      }
      this.video.play();
    } else {
      this.video.pause();
    }
  }

  // Enhanced skip function (existing buttons)
  skip(seconds) {
    if (!this.video) return;
    this.video.currentTime = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
  }

  // New seek function for keyboard arrows
  seek(seconds) {
    if (!this.video) return;
    this.video.currentTime = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
    this.showControls(); // Show controls when seeking
    this.startControlsAutoHide();
  }

  // New volume change function for keyboard
  changeVolume(delta) {
    if (!this.video) return;
    
    let newVolume = this.video.volume + delta;
    newVolume = Math.max(0, Math.min(1, newVolume));
    this.video.volume = newVolume;
    
    // Update volume slider
    const volumeSlider = document.getElementById("volumeSlider");
    if (volumeSlider) {
      volumeSlider.value = newVolume * 100;
    }
    
    // Show volume feedback
    this.showVolumeFeedback(Math.round(newVolume * 100));
  }

  setVolume(volume) {
    if (!this.video) return;
    this.video.volume = volume / 100;
  }

  toggleMute() {
    if (!this.video) return;
    this.video.muted = !this.video.muted;
    this.showControls();
    this.startControlsAutoHide();
  }

  setPlaybackRate(rate) {
    if (!this.video) return;
    this.video.playbackRate = parseFloat(rate);
  }

  toggleFullscreen() {
    const container = document.getElementById("embeddedPlayer");

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  }

  updatePlayButton() {
    const btn = document.getElementById("playPauseBtn");
    if (btn) {
      btn.innerHTML = this.isPlaying ? "⏸️ Pause" : "▶️ Play";
    }
  }

  // Visual feedback functions
  showSeekFeedback(text) {
    this.showFeedback(text, "⏩");
  }

  showVolumeFeedback(volume) {
    const icon = volume === 0 ? "🔇" : volume < 50 ? "🔉" : "🔊";
    this.showFeedback(`${volume}%`, icon);
  }

  showFeedback(text, icon) {
    // Remove any existing feedback
    const existingFeedback = document.querySelector(".player-feedback");
    if (existingFeedback) {
      existingFeedback.remove();
    }

    const feedback = document.createElement("div");
    feedback.className = "player-feedback";
    feedback.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 15px 25px;
      border-radius: 25px;
      font-size: 18px;
      font-weight: bold;
      z-index: 1001;
      pointer-events: none;
      backdrop-filter: blur(10px);
      border: 2px solid rgba(255, 0, 0, 0.5);
    `;
    feedback.innerHTML = `${icon} ${text}`;

    document.getElementById("embeddedPlayer").appendChild(feedback);

    // Animate and remove
    setTimeout(() => {
      feedback.style.opacity = "0";
      feedback.style.transform = "translate(-50%, -60%) scale(0.8)";
      feedback.style.transition = "all 0.3s ease-out";
      setTimeout(() => feedback.remove(), 300);
    }, 1000);
  }

  showError(message) {
    console.error("Player Error:", message);
    const loadingText = document.getElementById("loadingText");
    const loadingOverlay = document.getElementById("loadingOverlay");
    
    if (loadingText) {
        loadingText.innerHTML = `<div class="text-red-400">❌ ${message}</div>
                                <button onclick="window.embeddedPlayer.closePlayer()" 
                                        class="mt-4 bg-netflix-red px-4 py-2 rounded text-white">
                                    Close Player
                                </button>`;
    }
    
    // Hide progress elements on error
    const torrentProgress = document.getElementById("torrentProgress");
    if (torrentProgress) {
        torrentProgress.style.display = "none";
    }
  }

  showClickToPlayMessage() {
    const playMessage = document.createElement("div");
    playMessage.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(255, 0, 0, 0.9);
      color: white;
      padding: 15px 30px;
      border-radius: 25px;
      font-size: 16px;
      cursor: pointer;
      z-index: 100;
      backdrop-filter: blur(10px);
    `;
    playMessage.textContent = "▶️ Click to Play";

    const videoContainer = document.getElementById("embeddedPlayer");
    videoContainer.appendChild(playMessage);

    playMessage.addEventListener("click", () => {
      this.video.play();
      playMessage.remove();
    });
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  // Buffer progress display
  updateBufferProgress(percentage) {
    const bufferProgress = document.getElementById("bufferProgress");
    if (bufferProgress) {
      bufferProgress.style.width = percentage + "%";
      bufferProgress.style.display = percentage > 0 ? "block" : "none";
    }
    
    // Update buffer text if element exists
    const bufferText = document.getElementById("bufferText");
    if (bufferText) {
      bufferText.textContent = `Buffer: ${percentage.toFixed(1)}%`;
    }
  }

  // Toast notification system
  showToast(message, type = "info") {
    // Remove existing toast
    this.hideToast();
    
    const toast = document.createElement("div");
    toast.id = "playerToast";
    toast.className = `player-toast player-toast-${type}`;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      transform: translateX(100%);
      transition: transform 0.3s ease;
      max-width: 300px;
      word-wrap: break-word;
    `;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
      toast.style.transform = "translateX(0)";
    }, 100);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
      this.hideToast();
    }, 3000);
  }

  hideToast() {
    const existingToast = document.getElementById("playerToast");
    if (existingToast) {
      existingToast.style.transform = "translateX(100%)";
      setTimeout(() => {
        if (existingToast.parentNode) {
          existingToast.parentNode.removeChild(existingToast);
        }
      }, 300);
    }
  }

  // Enhanced preloading management
  startAggressivePreloading() {
    if (!this.video) return;
    
    console.log("🚀 Starting aggressive preloading...");
    
    // Force preload to auto
    this.video.preload = "auto";
    
    // Monitor and maintain buffer without affecting playback
    this.bufferMonitor = setInterval(() => {
      try {
        if (this.video && this.video.buffered && this.video.buffered.length > 0) {
          const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
          const currentTime = this.video.currentTime || 0;
          const duration = this.video.duration || 0;
          
          // If buffer is less than 10 minutes ahead, trigger aggressive background preloading
          if (bufferedEnd - currentTime < 600 && duration > 0) {
            console.log("🔄 Buffer running low, triggering aggressive background preloading...");
            this.triggerBackgroundPreloading();
          }
        }
      } catch (error) {
        console.warn('Buffer monitoring error:', error);
      }
    }, 30000); // Check every 30 seconds to reduce frequency
  }

  triggerBackgroundPreloading() {
    if (!this.video || !this.video.duration) return;
    
    // Add cooldown to prevent excessive preloading
    if (this.preloadCooldown) {
      console.log("⏳ Preloading in cooldown, skipping...");
      return;
    }
    
    const currentTime = this.video.currentTime || 0;
    const duration = this.video.duration || 0;
    
    // Only preload if we're not near the end
    if (currentTime < duration - 60) {
      // Set cooldown for 30 seconds
      this.preloadCooldown = true;
      setTimeout(() => {
        this.preloadCooldown = false;
      }, 30000);
      
      // Create multiple hidden video elements for aggressive preloading
      this.createAggressiveBackgroundPreloader(currentTime, duration);
    }
  }

  createAggressiveBackgroundPreloader(currentTime, duration) {
    // Calculate 10% of the video duration for larger chunks
    const tenPercentDuration = duration * 0.10;
    const preloadChunks = 2; // Load 2 chunks of 10% each = 20% total
    
    console.log(`🚀 Starting aggressive preloading: ${Math.round(tenPercentDuration)}s per chunk (10% each)`);
    
    // Clean up any existing background videos first
    this.cleanupBackgroundVideos();
    
    for (let i = 1; i <= preloadChunks; i++) {
      const preloadTime = Math.min(currentTime + (tenPercentDuration * i), duration - 1);
      
      // Create a hidden video element for each chunk
      const backgroundVideo = document.createElement('video');
      backgroundVideo.className = 'background-preloader';
      backgroundVideo.style.display = 'none';
      backgroundVideo.style.position = 'absolute';
      backgroundVideo.style.left = '-9999px';
      backgroundVideo.style.top = '-9999px';
      backgroundVideo.preload = 'auto';
      backgroundVideo.muted = true;
      backgroundVideo.volume = 0;
      
      // Use the same source as the main video
      backgroundVideo.src = this.video.src;
      
      // Add to DOM temporarily
      document.body.appendChild(backgroundVideo);
      
      backgroundVideo.addEventListener('loadedmetadata', () => {
        backgroundVideo.currentTime = preloadTime;
        
        // Let it load for a longer time to ensure more data is cached
        setTimeout(() => {
          if (backgroundVideo.parentNode) {
            backgroundVideo.parentNode.removeChild(backgroundVideo);
          }
          console.log(`✅ Background preloading chunk ${i} completed for position ${Math.round(preloadTime)}s (${Math.round((preloadTime/duration)*100)}%)`);
        }, 15000); // 15 seconds per chunk for better caching
      });
      
      backgroundVideo.addEventListener('error', () => {
        if (backgroundVideo.parentNode) {
          backgroundVideo.parentNode.removeChild(backgroundVideo);
        }
        console.warn(`❌ Background preloading chunk ${i} failed for position ${Math.round(preloadTime)}s`);
      });
      
      // Stagger the start times to avoid overwhelming the server
      setTimeout(() => {
        if (backgroundVideo.parentNode) {
          backgroundVideo.currentTime = preloadTime;
        }
      }, i * 2000); // Start each chunk 2 seconds apart
    }
  }

  cleanupBackgroundVideos() {
    // Remove any existing background preloader videos
    const existingVideos = document.querySelectorAll('.background-preloader');
    existingVideos.forEach(video => {
      if (video.parentNode) {
        video.parentNode.removeChild(video);
      }
    });
  }

  stopAggressivePreloading() {
    if (this.bufferMonitor) {
      clearInterval(this.bufferMonitor);
      this.bufferMonitor = null;
    }
  }

  // Send watch progress to server for persistent caching (debounced)
  sendWatchProgressDebounced(progress) {
    if (!this.currentMovie || !this.currentMovie.magnet) return;
    
    // Clear existing timeout
    if (this.progressUpdateTimeout) {
      clearTimeout(this.progressUpdateTimeout);
    }
    
    // Set new timeout for debounced update
    this.progressUpdateTimeout = setTimeout(async () => {
      try {
        const userToken = localStorage.getItem('userToken');
        const response = await fetch('/api/torrent/progress', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`
          },
          body: JSON.stringify({
            magnetHash: this.currentMovie.magnet,
            progress: progress
          })
        });
        
        if (response.ok) {
          console.log(`📊 Watch progress sent: ${Math.round(progress * 100)}%`);
        }
      } catch (error) {
        console.warn('Failed to send watch progress:', error);
      }
    }, 5000); // Send updates every 5 seconds instead of 2
  }

  // Legacy method for backward compatibility
  async sendWatchProgress(progress) {
    this.sendWatchProgressDebounced(progress);
  }
}

// Initialize embedded player
window.embeddedPlayer = new EmbeddedPlayer();
document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if not already initialized
    if (!window.embeddedPlayer) {
        window.embeddedPlayer = new EmbeddedPlayer();
        console.log("🎬 EmbeddedPlayer initialized");
    }
});

// Auto-update progress every 500ms for smooth scrubber movement
setInterval(() => {
    const player = window.embeddedPlayer;
    if (player && player.video && !player.isDraggingProgress && player.video.duration) {
        player.updateProgressBar();
        player.updateTimeDisplays();
    }
}, 100);

console.log("🎬 Enhanced embedded player loaded with YouTube-style progress scrubber and improved UI");
