#!/usr/bin/env node
import { spawnSync } from "child_process"
import * as semver from "semver"
import packageConfig from "../package.json" assert { type: "json" }

const hash = spawnSync("git", [ "rev-parse", "--short", "HEAD" ], { encoding: "utf8" }).stdout.trim()

spawnSync(
	"pnpm",
	[ "version", `${semver.inc(/** @type {any} */ (packageConfig).version || "0.0.0", "minor")}-${hash}` ],
	{ stdio: "inherit" }
)

process.exit()
