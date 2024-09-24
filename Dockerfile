FROM node:alpine as build
RUN corepack enable
ADD . /app
WORKDIR /app
RUN pnpm install
RUN pnpm run build

FROM nginx:stable
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html