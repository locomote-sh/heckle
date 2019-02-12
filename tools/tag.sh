#!/bin/bash

VERSION=$1

if [ -z "$VERSION" ]; then
    VERSION=$(node -e "console.log(require('./package.json').version)")
    echo "Tagging as version $VERSION"
fi

git tag -a "v$VERSION" -m "Version $VERSION"
git push origin "v$VERSION"

