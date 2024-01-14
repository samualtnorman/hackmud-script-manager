#!/bin/sh
set -ex
pnpm update --latest !@types/node
pnpm update @types/node
