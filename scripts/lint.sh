#!/bin/sh
set -ex
eslint .
tsc
tsc --project src
