FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm run build

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production

# Start the server
CMD ["node", "dist/index.mjs"]
