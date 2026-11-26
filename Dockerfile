FROM node:24 AS build


WORKDIR /tmp/buildApp

COPY ./package*.json ./
COPY .husky/ .husky/
COPY patches/ patches/

RUN npm install
COPY . .
RUN npm run build

# Standalone basemap migration utility: built separately from the service and outside dist/, shipped in the image
# only so it reaches every environment with the matching BMM version. The service never loads it.
RUN npm run build:migration -- --output /tmp/basemap-migration/migrateBasemaps.js \
  && chmod 0755 /tmp/basemap-migration /tmp/basemap-migration/migrateBasemaps.js \
  && chmod 0644 /tmp/basemap-migration/migrateBasemaps.js.sha256

FROM node:24.10.0-alpine3.22 AS production

RUN apk add dumb-init

ENV NODE_ENV=production
ENV SERVER_PORT=8080


WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./
COPY --chown=node:node .husky/ .husky/
COPY --chown=node:node patches/ patches/

RUN npm ci --only=production

COPY --chown=node:node --from=build /tmp/buildApp/dist .
COPY --chown=node:node ./config ./config

# Owned by root (no --chown) and world-readable/executable: any runtime UID, including OpenShift's arbitrary
# UIDs, can run or copy the bundle but not modify it.
COPY --from=build /tmp/basemap-migration/ /opt/basemap-migration/


USER node
EXPOSE 8080
CMD ["dumb-init", "node", "--import", "./instrumentation.mjs", "./index.js"]
