#!/usr/bin/env bash
set -euo pipefail

# pnpm via corepack — bundled with Node itself (ships in the Playwright base image),
# so this activates an existing capability rather than installing a new dependency.
# `corepack enable` symlinks into /usr/bin, which the non-root ubuntu user can't
# write to directly — common-utils gives it passwordless sudo for this.
sudo corepack enable
corepack prepare pnpm@9.15.0 --activate

# No devcontainer feature exists yet for the Azure Static Web Apps CLI (tracked
# upstream, still open: https://github.com/Azure/static-web-apps-cli/issues/602).
# Azure Functions Core Tools comes from the feature in devcontainer.json instead —
# this is the one unavoidable manual install.
sudo npm install -g @azure/static-web-apps-cli

pnpm install

# Bootstrap local.settings.json from the committed example if it doesn't exist yet.
# Real COSMOS_ENDPOINT/COSMOS_KEY values come from the devcontainer's passed-through
# host env vars (see devcontainer.json "remoteEnv") — fill them in on the host before
# opening the container, or edit apps/api/local.settings.json directly afterwards.
# That file is gitignored; never commit real values.
if [ ! -f apps/api/local.settings.json ]; then
  cp apps/api/local.settings.json.example apps/api/local.settings.json
fi

echo "SkyDispatch devcontainer ready. Run 'pnpm dev' to start web + api via the SWA CLI proxy on :4280."
