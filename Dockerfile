FROM node:20-alpine AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN npm ci --legacy-peer-deps

FROM node:20-alpine AS production-dependencies-env
COPY ./package.json package-lock.json prisma.config.ts /app/
COPY ./prisma /app/prisma
WORKDIR /app
RUN npm ci --omit=dev --legacy-peer-deps
RUN npx prisma generate

FROM node:20-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
COPY ./package.json package-lock.json prisma.config.ts server.js /app/
COPY ./prisma /app/prisma
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
WORKDIR /app
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]