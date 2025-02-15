#!/bin/sh
set -ex
tsc
tsc --project src
eslint
