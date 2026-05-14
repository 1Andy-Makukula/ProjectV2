# Stage 1: Build the Vite/React application
FROM node:22-bookworm-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

WORKDIR /app

# Copy package management files
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy application source
COPY . .

# Build the application
# We inject environment variables to a .env file to satisfy Docker security linters
ARG APP_API_URL
ARG APP_API_KEY

RUN echo "VITE_SUPABASE_URL=${APP_API_URL}" > .env && \
    echo "VITE_SUPABASE_ANON_KEY=${APP_API_KEY}" >> .env && \
    pnpm run build

# Stage 2: Serve the application using Nginx
FROM nginx:stable-alpine

# Copy the custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the built assets from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
