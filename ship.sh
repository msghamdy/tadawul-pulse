#!/usr/bin/env bash
# Ship Tadawul Pulse to GitHub in one go:
#   1. create the repo (or reuse it), 2. push, 3. set Pages to "GitHub Actions",
#   4. start the first "Update data" run, which then triggers "Deploy site".
#
# Usage:
#   read -s "GITHUB_TOKEN?Paste token: " && export GITHUB_TOKEN   # zsh (macOS)
#   bash ship.sh [repo-name]                                     # default: tadawul-pulse
#
# Token permissions
#   Classic token:      "repo" AND "workflow" scopes.
#   Fine-grained token: Contents, Workflows, Pages, Actions = Read and write
#                       (+ Administration = Read and write if the repo doesn't exist yet).
#   Without "workflow"/"Workflows", GitHub rejects the push because it contains
#   files under .github/workflows/.
set -euo pipefail

REPO="${1:-tadawul-pulse}"
DESC="Systematic research dashboard for the Saudi stock market (TASI)"
API="https://api.github.com"
: "${GITHUB_TOKEN:?Set it first:  read -s \"GITHUB_TOKEN?Paste token: \" && export GITHUB_TOKEN}"

cd "$(dirname "$0")"
RESP="$(mktemp)"; trap 'rm -f "$RESP"' EXIT

api() { # api METHOD PATH [JSON] -> prints HTTP status; body in $RESP
  local args=(-sS -o "$RESP" -w '%{http_code}' -X "$1"
    -H "Authorization: Bearer $GITHUB_TOKEN"
    -H "Accept: application/vnd.github+json"
    -H "X-GitHub-Api-Version: 2022-11-28")
  [ -n "${3:-}" ] && args+=(-d "$3")
  curl "${args[@]}" "$API$2"
}

# 1. Who am I, and does the repo exist?
code=$(api GET /user)
[ "$code" = 200 ] || { echo "✗ Token rejected (HTTP $code)"; cat "$RESP"; exit 1; }
OWNER=$(grep -m1 '"login"' "$RESP" | sed -E 's/.*"login": *"([^"]+)".*/\1/')
SITE="https://$OWNER.github.io/$REPO/"
echo "→ Signed in as $OWNER"

code=$(api GET "/repos/$OWNER/$REPO")
if [ "$code" = 200 ]; then
  echo "→ Found github.com/$OWNER/$REPO"
else
  code=$(api POST /user/repos "{\"name\":\"$REPO\",\"description\":\"$DESC\",\"homepage\":\"$SITE\"}")
  [ "$code" = 201 ] || { echo "✗ Could not create the repo (HTTP $code). Create it on github.com (empty, no README), then rerun."; cat "$RESP"; exit 1; }
  echo "→ Created github.com/$OWNER/$REPO"
fi

# 2. Commit and push. The token is sent as a one-off header, never saved in .git/config.
[ -d .git ] || git init -q
git add -A
git diff --cached --quiet || git commit -qm "${COMMIT_MSG:-Update Tadawul Pulse}"
git branch -M main
REMOTE="https://github.com/$OWNER/$REPO.git"
if git remote get-url origin >/dev/null 2>&1; then git remote set-url origin "$REMOTE"; else git remote add origin "$REMOTE"; fi
AUTH=$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')
if ! git -c http.https://github.com/.extraheader="AUTHORIZATION: basic $AUTH" push -u origin main; then
  echo "✗ Push failed. If the message mentions 'workflow', your token needs the workflow scope (classic)"
  echo "  or Workflows: Read and write (fine-grained). If it says 'rejected', the repo already has other commits."
  exit 1
fi
echo "→ Pushed to $REMOTE"

# 3. GitHub Pages, built by GitHub Actions
code=$(api POST "/repos/$OWNER/$REPO/pages" '{"build_type":"workflow"}')
case "$code" in
  201) echo "→ GitHub Pages enabled (source: GitHub Actions)" ;;
  409) code=$(api PUT "/repos/$OWNER/$REPO/pages" '{"build_type":"workflow"}')
       if [ "$code" = 204 ]; then echo "→ GitHub Pages switched to GitHub Actions"; else echo "! Set Settings → Pages → Source to 'GitHub Actions' by hand (HTTP $code)"; fi ;;
  *)   echo "! Couldn't enable Pages (HTTP $code). Set Settings → Pages → Source to 'GitHub Actions' by hand." ;;
esac

# 4. First data run. When it succeeds, "Deploy site" starts on its own.
sleep 3  # give GitHub a moment to register the new workflows
code=$(api POST "/repos/$OWNER/$REPO/actions/workflows/update-data.yml/dispatches" '{"ref":"main"}')
if [ "$code" = 204 ]; then
  echo "→ Started the first 'Update data' run"
else
  echo "! Couldn't start 'Update data' (HTTP $code). Run it from the Actions tab: Update data → Run workflow."
fi

echo ""
echo "✓ Shipped. Follow progress at https://github.com/$OWNER/$REPO/actions"
echo "  Update data (~3–5 min) → Deploy site (~1 min) → live at:"
echo "  $SITE"
