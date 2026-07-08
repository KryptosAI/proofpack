FROM node:20-alpine

WORKDIR /app

# Copy workspace config and all packages
COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/
COPY packages/sdk/package.json packages/sdk/

RUN npm ci --omit=dev

# Copy source code
COPY packages/backend/src packages/backend/src
COPY packages/backend/tsconfig.json packages/backend/
COPY packages/backend/public packages/backend/public
COPY packages/sdk/src packages/sdk/src
COPY packages/sdk/tsconfig.json packages/sdk/
COPY icon.png ./

# Build SDK
RUN npx tsc -p packages/sdk/tsconfig.json

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

CMD ["npx", "tsx", "packages/backend/src/server.ts"]
