#!/usr/bin/env sh
# Restores contracts/lib, which is gitignored (13MB of third-party Solidity).
# Run once after cloning, before `forge build` / `forge test`.
#
#   cd contracts && ./install-deps.sh
#
# Versions are pinned so builds match what the deployed contract was compiled against.
set -e
cd "$(dirname "$0")"

FORGE="${FORGE:-forge}"
command -v "$FORGE" >/dev/null 2>&1 || FORGE="$HOME/.foundry/bin/forge"
command -v "$FORGE" >/dev/null 2>&1 || {
  echo "forge not found. Install Foundry: https://getfoundry.sh" >&2
  exit 1
}

# --no-git keeps these as plain files rather than submodules, matching foundry.toml's remappings.
"$FORGE" install --no-git OpenZeppelin/openzeppelin-contracts@v5.1.0
"$FORGE" install --no-git foundry-rs/forge-std@v1.16.2

echo "Dependencies installed. Run: $FORGE test"
