#!/bin/sh
set -ex
npx tsc
npx tsc --project src
npx eslint
