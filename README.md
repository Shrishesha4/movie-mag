# Movie Streamer

A dockerized movie streaming platform using torrent magnet links with PostgreSQL and Redis.

## Features

- 🎬 Stream movies directly from torrent magnets (no downloads)
- 🔐 Admin authentication system
- 📱 Responsive minimal UI
- 🗄️ PostgreSQL database for movie metadata
- ⚡ Redis caching for performance
- 🐳 Full Docker deployment

## Quick Start

1. Clone and setup:
   git clone <repository>
   cd movie-streamer
   cp .env.example .env

text

2. Start with Docker Compose:
   docker-compose up -d

text

3. Access the application:

- Main site: http://localhost:3000
- Admin panel: http://localhost:3000/admin
- Default credentials: admin / admin123

## Usage

### Admin Panel

1. Login with admin credentials
2. Add movies using magnet links
3. Fill in movie metadata (title, description, year, etc.)
4. Movies appear instantly on the main page

### Streaming

1. Click any movie on the main page
2. Player opens with WebTorrent streaming
3. Video starts playing as it downloads
4. Progress shows download speed and peer count

## Configuration

Edit `.env` file to customize:

- Database credentials
- Redis settings
- JWT secret
- Admin credentials

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: PostgreSQL
- **Cache**: Redis
- **Streaming**: WebTorrent
- **Frontend**: Vanilla JS (minimal)
- **Deployment**: Docker + Docker Compose

## Security Features

- JWT authentication
- Rate limiting
- CORS protection
- Helmet security headers
- Input validation
- Admin-only routes

## Development

npm install
npm run dev

text

## Production Deployment

The app is production-ready with:

- Non-root Docker user
- Health checks
- Data persistence
- Automatic restarts
- Security hardening
