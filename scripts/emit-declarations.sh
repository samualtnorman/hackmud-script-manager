#!/bin/sh
set -ex
npx tsc --project src --declaration --emitDeclarationOnly --noEmit false --outDir dist
