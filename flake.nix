{
  description = "Description for the project";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [ inputs.git-hooks.flakeModule ];
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      perSystem =
        {
          config,
          pkgs,
          ...
        }:
        {
          pre-commit.settings.hooks = {
            nixfmt.enable = true;
            yamlfmt.enable = true;
            yamllint.enable = true;
            denolint.enable = true;
            denofmt.enable = true;
          };

          devShells = {
            default =
              let
                __zed =
                  let
                    defaults = {
                      language_servers = [
                        "deno"
                        "!typescript-language-server"
                        "!vtsls"
                        "!eslint"
                      ];
                      formatter = "language_server";
                    };
                  in
                  pkgs.writers.writeJSON "settings.json" {
                    lsp.deno.settings.deno.enable = true;
                    lsp.json-language-server.settings.json.schemas = [
                      {
                        fileMatch = [
                          "deno.json"
                          "deno.jsonc"
                        ];
                        url = "https://raw.githubusercontent.com/denoland/deno/refs/heads/main/cli/schemas/config-file.v1.json";
                      }
                      {
                        fileMatch = [
                          "package.json"
                        ];
                        url = "https://www.schemastore.org/package";
                      }
                    ];
                    languages.JavaScript = defaults;
                    languages.TypeScript = defaults;
                    languages.TSX = defaults;
                  };
              in
              pkgs.mkShell {
                packages =
                  with pkgs;
                  [
                    nil
                    nixd
                    nixfmt

                    go-task

                    act
                    pinact
                  ]
                  ++ config.pre-commit.settings.enabledPackages;

                buildInputs = with pkgs; [ deno ];

                shellHook = ''
                  mkdir -p .zed
                  ln -sf ${__zed} .zed/settings.json
                  ${config.pre-commit.shellHook}
                '';
              };

            ci = pkgs.mkShell {
              packages =
                with pkgs;
                [
                  go-task
                ]
                ++ config.pre-commit.settings.enabledPackages;
              buildInputs = with pkgs; [ deno ];
              shellHook = ''
                ${config.pre-commit.shellHook}
              '';
            };
          };
        };
    };
}
