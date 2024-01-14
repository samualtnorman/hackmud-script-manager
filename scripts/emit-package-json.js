#!/usr/bin/env node
import { writeFileSync, mkdirSync as makeDirectorySync, readdirSync as readDirectorySync } from "fs"
import packageConfig from "../package.json" assert { type: "json" }

delete packageConfig.private
delete packageConfig.devDependencies

try {
	/** @type {any} */ (packageConfig).bin = Object.fromEntries(
		readDirectorySync("dist/bin").map(name => [ name.slice(0, -3), `bin/${name}` ])
	)
} catch (error) {
	if (error.syscall != "scandir" || error.code != "ENOENT" || error.path != "dist/bin")
		throw error
}

makeDirectorySync("dist", { recursive: true })
writeFileSync("dist/package.json", JSON.stringify(packageConfig))
process.exit()
