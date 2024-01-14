#!/bin/sh
set -ex
eslint .
tsc
tsc --project src --noEmit --emitDeclarationOnly false
