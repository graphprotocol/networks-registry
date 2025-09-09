#!/bin/bash

# This script handles version bumping for the Networks Registry
# Usage: ./bump-version.sh [major|minor|patch]
# If no argument is provided, it defaults to "patch"

# Exit on error
set -e

# Default to patch if no argument is provided
BUMP_TYPE="${1:-patch}"
echo "Bump type: $BUMP_TYPE"

# Get current version from package.json
CURRENT_VERSION=$(jq -r '.version' package.json)
echo "Current version: $CURRENT_VERSION"

# Parse current version
IFS='.' read -ra VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR=${VERSION_PARTS[0]}
MINOR=${VERSION_PARTS[1]}
PATCH=${VERSION_PARTS[2]}

# Bump version based on type
case $BUMP_TYPE in
  "major")
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  "minor")
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  "patch")
    PATCH=$((PATCH + 1))
    ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
echo "Bumping version from $CURRENT_VERSION to $NEW_VERSION ($BUMP_TYPE bump)"

# Update package.json
jq --arg version "$NEW_VERSION" '.version = $version' package.json > package.json.tmp
mv package.json.tmp package.json

echo "old_version=$CURRENT_VERSION" >> $GITHUB_OUTPUT
echo "new_version=$NEW_VERSION" >> $GITHUB_OUTPUT
echo "bump_type=$BUMP_TYPE" >> $GITHUB_OUTPUT
