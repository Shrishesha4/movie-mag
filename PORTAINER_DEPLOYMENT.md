# Movie Streamer - Portainer Deployment Guide

This guide explains how to deploy the Movie Streamer application using Portainer's custom template feature.

## Prerequisites

- Portainer CE or Portainer Business Edition installed
- Docker and Docker Compose available on your system
- At least 2GB of available RAM
- At least 10GB of available disk space

## Quick Deployment

### Option 1: Using Portainer Template (Recommended)

1. **Add Custom Template**
   - In Portainer, go to **Settings** → **Templates**
   - Click **Add template**
   - Copy the contents of `portainer-template.json` into the template field
   - Save the template

2. **Deploy the Stack**
   - Go to **Stacks** → **Add stack**
   - Select the "Movie Streamer" template
   - Configure the environment variables:
     - **APP_PORT**: Port for the application (default: 3000)
     - **DB_PASSWORD**: Change the default database password
     - **JWT_SECRET**: Change the default JWT secret
     - **ADMIN_PASSWORD**: Change the default admin password
     - **DOMAIN**: Your domain name (optional, for Traefik integration)
   - Click **Deploy the stack**

### Option 2: Manual Deployment

1. **Upload Files**
   - Upload the entire project folder to your server
   - Or clone from your Git repository

2. **Create Environment File**
   - Copy `env.example` to `.env`
   - Modify the values as needed

3. **Deploy Stack**
   - In Portainer, go to **Stacks** → **Add stack**
   - Choose **Upload** and select your `docker-compose.yml`
   - Configure environment variables
   - Deploy

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `APP_PORT` | Application port | 3000 | No |
| `DB_NAME` | PostgreSQL database name | moviedb | No |
| `DB_USER` | PostgreSQL username | movieuser | No |
| `DB_PASSWORD` | PostgreSQL password | moviepass | **Yes** |
| `JWT_SECRET` | JWT token secret | your-super-secret-jwt-key-change-this | **Yes** |
| `ADMIN_USERNAME` | Admin username | admin | No |
| `ADMIN_PASSWORD` | Admin password | admin123 | **Yes** |
| `DOMAIN` | Domain for Traefik | localhost | No |

## Security Recommendations

1. **Change Default Passwords**
   - Always change `DB_PASSWORD`, `JWT_SECRET`, and `ADMIN_PASSWORD`
   - Use strong, unique passwords

2. **Network Security**
   - The application uses a custom network (`movie-network`)
   - Only the main app is exposed to external traffic
   - Database and Redis are internal only

3. **SSL/TLS**
   - For production, use a reverse proxy (Traefik, Nginx) with SSL
   - The template includes Traefik labels for easy SSL setup

## Accessing the Application

- **Main Application**: `http://your-server:APP_PORT`
- **Health Check**: `http://your-server:APP_PORT/health`
- **Admin Setup**: `http://your-server:APP_PORT/admin` (first time only)

## Initial Setup

1. **First Access**
   - Navigate to the application URL
   - If no users exist, you'll be redirected to `/admin`
   - Create the initial admin account

2. **Admin Account**
   - Use the credentials specified in environment variables
   - Change the password after first login

3. **Adding Movies**
   - Use the admin interface to add movie torrents
   - Supported formats: magnet links, .torrent files

## Troubleshooting

### Common Issues

1. **Port Already in Use**
   - Change `APP_PORT` to an available port
   - Check if another service is using port 3000

2. **Database Connection Failed**
   - Verify `DB_PASSWORD` is set correctly
   - Check if PostgreSQL container is running
   - Review container logs: `docker logs movie-streamer-postgres`

3. **Redis Connection Failed**
   - Check if Redis container is running
   - Review container logs: `docker logs movie-streamer-redis`

4. **File System Mount Errors**
   - The application no longer requires file system mounts
   - Database schema is initialized programmatically
   - All static files are copied into the container during build

5. **Database Authentication Errors**
   - Ensure `DB_PASSWORD` environment variable is set correctly
   - The application will retry database connections automatically
   - Check that PostgreSQL container is healthy before application starts
   - Verify environment variables are consistent between containers

### Checking Logs

```bash
# Application logs
docker logs movie-streamer

# Database logs
docker logs movie-streamer-postgres

# Redis logs
docker logs movie-streamer-redis
```

### Health Check

The application includes a health check endpoint:
- URL: `http://your-server:APP_PORT/health`
- Returns application status, database connectivity, and system info

## Updating the Application

1. **Pull Latest Changes**
   - Update your source code or Git repository

2. **Rebuild and Deploy**
   - In Portainer, go to your stack
   - Click **Update the stack**
   - Upload the new `docker-compose.yml`
   - Deploy

## Data Persistence

The following data is persisted:
- **PostgreSQL Data**: `postgres_data` volume
- **Redis Data**: `redis_data` volume
- **Application Data**: `movie_data` volume

## Resource Requirements

- **Minimum**: 1GB RAM, 5GB disk
- **Recommended**: 2GB RAM, 10GB disk
- **CPU**: 1-2 cores

## Support

For issues and questions:
- Check the application logs
- Review the health check endpoint
- Ensure all environment variables are set correctly
