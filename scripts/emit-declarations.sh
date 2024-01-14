#!/bin/sh
set -ex
tsc --project src --declaration --emitDeclarationOnly --noEmit false --outDir dist
