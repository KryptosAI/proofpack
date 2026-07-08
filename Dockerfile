FROM node:20-slim

WORKDIR /app

# Install build tools for better-sqlite3 native module
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy workspace config and all package.json files
COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/
COPY packages/sdk/package.json packages/sdk/
COPY packages/sdk-react/package.json packages/sdk-react/
COPY packages/frontend/package.json packages/frontend/

# Install all dependencies (need tsx & typescript for runtime)
RUN npm ci

# Copy source code
COPY packages/backend/src packages/backend/src
COPY packages/backend/tsconfig.json packages/backend/
COPY packages/backend/public packages/backend/public
COPY packages/sdk/src packages/sdk/src
COPY packages/sdk/tsconfig.json packages/sdk/
# Build SDK
RUN npx tsc -p packages/sdk/tsconfig.json

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

CMD ["npx", "tsx", "packages/backend/src/server.ts"]
