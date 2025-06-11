{
  description = "dangre.co development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        overlays = [ ];
        pkgs = (import nixpkgs) {
          inherit system overlays;
        };

        buildInputs = with pkgs; [
          openssl
          pkg-config
        ];

        nativeBuildInputs = with pkgs; [
        ];
      in
      {
        devShell = pkgs.mkShell {
          nativeBuildInputs =
            with pkgs;
            [
              git
              just
              nixd
              nixfmt-rfc-style
              act
              nodejs_24
              corepack_24
            ]
            ++ buildInputs
            ++ nativeBuildInputs;
        };
      }
    );
}
