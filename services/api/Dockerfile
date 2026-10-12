# Build context is the repository root: the API imports the @mosae/contracts workspace.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY services/api/package.json services/api/
RUN npm ci --workspace services/api --workspace packages/contracts --include-workspace-root
COPY packages/contracts packages/contracts
COPY services/api services/api
RUN npm run build -w services/api
RUN npx tsc -p packages/contracts/tsconfig.json --noEmit false --outDir packages/contracts/generated

FROM node:22-slim AS runtime
# ffmpeg and ffprobe are used by ingest for probing, proxies and shot detection.
# exiftool-vendored does not provide a Linux executable on PATH, so use Debian's
# Perl package for the command-line probe and ingest tool.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libheif-examples libimage-exiftool-perl \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY services/api/package.json services/api/
RUN npm ci --omit=dev --workspace services/api --workspace packages/contracts --include-workspace-root
COPY packages/contracts packages/contracts
COPY --from=build /app/packages/contracts/generated packages/contracts/src
COPY --from=build /app/services/api/dist services/api/dist
COPY services/api/fixtures services/api/fixtures
COPY docs/design/collage-review.json docs/design/collage-review.json
EXPOSE 8080
CMD ["node", "services/api/dist/index.js"]
