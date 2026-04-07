#!/usr/bin/env bash
# verify.sh — pre-push safety check for leassh-web (LEA-63)
# Run manually: ./verify.sh
# Or install as hook: ./verify.sh --install-hook
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0

ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; ERRORS=$((ERRORS + 1)); }

# Install as git pre-push hook
if [[ "${1:-}" == "--install-hook" ]]; then
  HOOK=".git/hooks/pre-push"
  cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
cd "$(git rev-parse --show-toplevel)"
exec ./verify.sh
EOF
  chmod +x "$HOOK"
  echo "Installed pre-push hook at $HOOK"
  exit 0
fi

echo "=== leassh-web pre-push verification ==="
echo ""

# 1. JS syntax check
echo "--- JS syntax ---"
JS_FILES=$(find api -name "*.js" | sort)
JS_OK=0
JS_FAIL=0
for f in $JS_FILES; do
  if node --check "$f" 2>/dev/null; then
    JS_OK=$((JS_OK + 1))
  else
    fail "Syntax error: $f"
    node --check "$f" 2>&1 | sed 's/^/  /'
    JS_FAIL=$((JS_FAIL + 1))
  fi
done
if [[ $JS_FAIL -eq 0 ]]; then
  ok "$JS_OK JS files — all syntax OK"
fi
echo ""

# 2. HTML files not empty
echo "--- HTML integrity ---"
HTML_OK=0
for f in *.html; do
  [[ ! -f "$f" ]] && continue
  SIZE=$(wc -c < "$f")
  if [[ $SIZE -lt 100 ]]; then
    fail "HTML file suspiciously small ($SIZE bytes): $f"
  else
    HTML_OK=$((HTML_OK + 1))
  fi
done
if [[ $HTML_OK -gt 0 ]]; then
  ok "$HTML_OK HTML files — sizes OK"
fi
echo ""

# 3. No accidental debug / test files
echo "--- Stray files ---"
STRAY_PATTERNS=("migrate.js" "test.js" "debug.js" "scratch.js" "tmp.js" "*.test.js" "*.spec.js")
# Only check api/ and root — scripts/ is a legitimate home for test utilities
STRAY_SEARCH_DIRS=("api" ".")
FOUND_STRAY=0
for pattern in "${STRAY_PATTERNS[@]}"; do
  for dir in "${STRAY_SEARCH_DIRS[@]}"; do
    MAXDEPTH=1
    [[ "$dir" == "api" ]] && MAXDEPTH=3
    while IFS= read -r -d '' f; do
      fail "Stray file found: $f"
      FOUND_STRAY=$((FOUND_STRAY + 1))
    done < <(find "$dir" -maxdepth $MAXDEPTH -name "$pattern" \
      -not -path "./node_modules/*" -not -path "./scripts/*" -print0 2>/dev/null)
  done
done
if [[ $FOUND_STRAY -eq 0 ]]; then
  ok "No stray debug/test files found"
fi
echo ""

# 4. Dependencies installed
echo "--- Dependencies ---"
if [[ ! -d node_modules ]]; then
  fail "node_modules missing — run: npm install"
else
  # Check key deps are resolvable
  MISSING=0
  for dep in stripe @supabase/supabase-js; do
    DEP_DIR="node_modules/$(echo "$dep" | sed 's|@||;s|/|/|')"
    if [[ ! -d "node_modules/$dep" ]]; then
      fail "Missing dependency: $dep"
      MISSING=$((MISSING + 1))
    fi
  done
  if [[ $MISSING -eq 0 ]]; then
    ok "Dependencies installed (stripe, @supabase/supabase-js)"
  fi
fi
echo ""

# 5. package.json is valid JSON
echo "--- Config files ---"
if node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" 2>/dev/null; then
  ok "package.json is valid JSON"
else
  fail "package.json is invalid JSON"
fi
echo ""

# Result
if [[ $ERRORS -eq 0 ]]; then
  echo -e "${GREEN}=== All checks passed — safe to push ===${NC}"
  exit 0
else
  echo -e "${RED}=== $ERRORS check(s) failed — fix before pushing ===${NC}"
  exit 1
fi
