# Deployment Guide

This guide covers deploying the Card Vault Tracker application to production.

## Prerequisites

- Node.js 22+
- pnpm package manager
- PostgreSQL database
- Clerk account (for authentication)
- OpenAI API key (for card scanner)
- Vercel account (for frontend)
- Railway or Render account (for backend API)

## Environment Variables

### Frontend (Vercel)
- `VITE_CLERK_PUBLISHABLE_KEY` - Clerk publishable key
- `VITE_CLERK_PROXY_URL` - Clerk proxy URL (optional, for custom domains)
- `VITE_API_BASE_URL` - Backend API URL

### Backend (Railway/Render)
- `DATABASE_URL` - PostgreSQL connection string
- `CLERK_PUBLISHABLE_KEY` - Clerk publishable key
- `CLERK_SECRET_KEY` - Clerk secret key
- `OPENAI_API_KEY` - OpenAI API key for card scanner
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Set to `production`

## Deployment Options

### Option 1: Vercel (Frontend) + Railway (Backend) - Recommended

#### Step 1: Deploy Backend to Railway

1. Create a new Railway project
2. Connect your GitHub repository
3. Select the `artifacts/api-server` directory as the root directory
4. Add environment variables:
   - `DATABASE_URL` - Create a PostgreSQL database in Railway and use its connection string
   - `CLERK_PUBLISHABLE_KEY` - Your Clerk publishable key
   - `CLERK_SECRET_KEY` - Your Clerk secret key
   - `OPENAI_API_KEY` - Your OpenAI API key
   - `PORT` - `3000`
   - `NODE_ENV` - `production`
5. Deploy

#### Step 2: Deploy Frontend to Vercel

1. Create a new Vercel project
2. Connect your GitHub repository
3. Set the root directory to `artifacts/pokedex-vault`
4. Add environment variables:
   - `VITE_CLERK_PUBLISHABLE_KEY` - Your Clerk publishable key
   - `VITE_API_BASE_URL` - Your Railway backend URL (e.g., `https://your-app.railway.app`)
5. Deploy

#### Step 3: Configure Clerk

1. Go to your Clerk Dashboard
2. Add your Vercel frontend URL to "Allowed Origins"
3. Add your Railway backend URL to "Allowed Origins" for API calls
4. If using custom domains, configure the Clerk proxy URL

### Option 2: Vercel (Frontend) + Render (Backend)

#### Step 1: Deploy Backend to Render

1. Create a new Render web service
2. Connect your GitHub repository
3. Set build command: `cd artifacts/api-server && pnpm install && pnpm run build`
4. Set start command: `cd artifacts/api-server && node dist/index.mjs`
5. Add environment variables (same as Railway)
6. Deploy

#### Step 2: Deploy Frontend to Vercel

Same as Option 1, but use your Render backend URL for `VITE_API_BASE_URL`.

### Option 3: Single Platform (Railway)

You can deploy both frontend and backend on Railway:

1. Create two Railway services:
   - Backend: `artifacts/api-server` (web service)
   - Frontend: `artifacts/pokedex-vault` (static site)
2. Configure environment variables for each
3. Set up Railway's networking to allow communication between services

## Database Setup

### Using Railway PostgreSQL

1. Create a PostgreSQL database in Railway
2. Copy the connection string
3. Use it as `DATABASE_URL` in your backend environment variables
4. Run database migrations:
   ```bash
   pnpm --filter @workspace/db run push
   ```

### Using External PostgreSQL

1. Create a PostgreSQL database (Supabase, Neon, etc.)
2. Get the connection string
3. Add it as `DATABASE_URL` environment variable
4. Run migrations

## Clerk Configuration

1. Create a Clerk account at https://dashboard.clerk.com
2. Create a new application
3. Copy the publishable key and secret key
4. Add your frontend and backend URLs to "Allowed Origins"
5. Configure sign-in/sign-up methods as needed

## OpenAI Configuration

1. Create an OpenAI account at https://platform.openai.com
2. Generate an API key
3. Add it as `OPENAI_API_KEY` environment variable
4. Ensure you have credits for GPT-4o vision API calls

## Post-Deployment Checklist

- [ ] Frontend is accessible and loads
- [ ] Backend health check returns 200 OK
- [ ] Clerk authentication works
- [ ] Database connection is successful
- [ ] Card scanner can identify cards (requires HTTPS)
- [ ] Card creation and listing works
- [ ] Binder management works
- [ ] Price lookup works

## Troubleshooting

### Frontend Issues

- **Build fails**: Check that all dependencies are installed and pnpm is available
- **Environment variables not loading**: Verify variable names in Vercel dashboard
- **API calls failing**: Check CORS configuration and API base URL

### Backend Issues

- **Build fails**: Check Node.js version and pnpm installation
- **Database connection fails**: Verify DATABASE_URL format and database accessibility
- **Authentication fails**: Verify Clerk keys are correct and origins are configured
- **Scanner not working**: Verify OPENAI_API_KEY is valid and has sufficient credits

### Database Issues

- **Connection refused**: Check database is running and accessible
- **Migration fails**: Run `pnpm --filter @workspace/db run push` manually
- **Schema mismatch**: Ensure database schema matches code

## Local Development vs Production

### Local Development
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- Database: Local PostgreSQL

### Production
- Frontend: Your Vercel domain
- Backend: Your Railway/Render domain
- Database: Managed PostgreSQL (Railway/Supabase/Neon)

## Monitoring

- **Frontend**: Vercel Analytics
- **Backend**: Railway metrics / Render logs
- **Database**: Railway PostgreSQL metrics / Supabase dashboard
- **Errors**: Sentry (optional, recommended for production)

## Security Notes

- Never commit API keys to git
- Use environment variables for all sensitive data
- Enable HTTPS in production
- Configure CORS properly
- Rate limit API endpoints
- Regularly update dependencies
