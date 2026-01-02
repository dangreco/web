# ========== Source Stage ==========
FROM scratch as src
COPY . /app

# ========== Build Stage ==========
FROM nixos/nix:latest as build
ENV NIX_CONFIG="experimental-features = nix-command flakes"
WORKDIR /tmp

COPY --from=src /app ./

# Install dependencies
RUN nix develop .#ci --command true

# Build the project
RUN nix develop .#ci --command task build

# ========== Final Stage ==========
FROM nginx:alpine

# Copy files from build stage
COPY --from=build /tmp/_build /usr/share/nginx/html

EXPOSE 80
ENTRYPOINT ["nginx", "-g", "daemon off;"]
