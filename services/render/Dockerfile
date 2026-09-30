# Build context is the repository root: the service bundles the @mosae/video
# composition and imports the @mosae/contracts schema.
FROM node:22-slim AS runtime
# Remotion drives headless Chromium. These are the shared libraries it needs,
# plus ffmpeg for muxing. Chromium itself is fetched by @remotion/renderer at
# build time below, so the image does not depend on a distro chromium package.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ffmpeg ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
     libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
     libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libx11-6 \
     libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 \
     libxrandr2 xdg-utils \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV MOSAE_REMOTION_PUBLIC_DIR=/app/apps/client/assets/demo
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/video/package.json packages/video/
COPY services/render/package.json services/render/
RUN npm ci --omit=dev --workspace services/render --workspace packages/video --workspace packages/contracts --include-workspace-root
COPY packages/contracts packages/contracts
COPY packages/video packages/video
COPY apps/client/assets/demo apps/client/assets/demo
COPY services/render/src services/render/src
COPY services/render/scripts services/render/scripts
# Download the browser once at image build time so the first render does not pay for it.
RUN npx remotion browser ensure
RUN node --import tsx services/render/scripts/buildBundle.ts
ENV MOSAE_REMOTION_SERVE_URL=/app/remotion-bundle
EXPOSE 8080
CMD ["node", "--import", "tsx", "services/render/src/index.ts"]
