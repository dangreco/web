FROM denoland/deno:2.5.6 AS build
WORKDIR /app

COPY src ./src
COPY _config.ts deno.json ./
RUN deno task build

FROM nginx:alpine
WORKDIR /usr/share/nginx/html

COPY --from=build /app/_site ./
EXPOSE 80
