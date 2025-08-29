#!/bin/bash

echo "🔄 Resetting Movie Streamer database..."

# Stop the stack
echo "📦 Stopping containers..."
docker-compose down

# Remove the PostgreSQL volume
echo "🗑️ Removing PostgreSQL volume..."
docker volume rm movie-streamer_postgres_data 2>/dev/null || echo "Volume already removed or doesn't exist"

# Remove Redis volume (optional, uncomment if needed)
# echo "🗑️ Removing Redis volume..."
# docker volume rm movie-streamer_redis_data 2>/dev/null || echo "Volume already removed or doesn't exist"

# Start the stack
echo "🚀 Starting containers..."
docker-compose up -d

echo "✅ Database reset completed!"
echo "📊 Monitor logs with: docker-compose logs -f"
