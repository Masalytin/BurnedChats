#!/bin/bash
# Install git hooks for BurnedChats project
# Run this script after cloning the repository

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Installing git hooks...${NC}"

# Get the root directory of the repository
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Git hooks directory
GIT_HOOKS_DIR="$REPO_ROOT/.git/hooks"
SOURCE_HOOKS_DIR="$REPO_ROOT/scripts/git-hooks"

# Check if we're in a git repository
if [ ! -d "$REPO_ROOT/.git" ]; then
    echo -e "${RED}Error: Not a git repository${NC}"
    echo "Please run this script from within the BurnedChats repository"
    exit 1
fi

# Create hooks directory if it doesn't exist
mkdir -p "$GIT_HOOKS_DIR"

# Install hooks
HOOKS=("pre-commit" "commit-msg")

for hook in "${HOOKS[@]}"; do
    SOURCE="$SOURCE_HOOKS_DIR/$hook"
    TARGET="$GIT_HOOKS_DIR/$hook"

    if [ -f "$SOURCE" ]; then
        # Copy hook
        cp "$SOURCE" "$TARGET"
        # Make executable
        chmod +x "$TARGET"
        echo -e "${GREEN}✓ Installed $hook hook${NC}"
    else
        echo -e "${YELLOW}⚠ Hook not found: $SOURCE${NC}"
    fi
done

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}Git hooks installed successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo ""
echo "Hooks will run automatically on:"
echo "  - pre-commit: Code quality checks"
echo "  - commit-msg: Commit message validation"
echo ""
echo "To skip hooks temporarily, use: git commit --no-verify"


