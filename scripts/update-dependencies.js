/* eslint-disable unicorn/no-process-exit */

import { execFileSync as executeFileSync } from "child_process"
import { readFileSync } from "fs"

/** @typedef {Error & import("child_process").SpawnSyncReturns<null>} ExecuteFileSyncError */

const packageConfig = JSON.parse(readFileSync(`package.json`, { encoding: `utf-8` }))

const dependencies = [
	...Object.keys(packageConfig.dependencies || []),
	...Object.keys(packageConfig.devDependencies || []),
	...Object.keys(packageConfig.optionalDependencies || [])
]

dependencies.splice(dependencies.indexOf(`@types/node`), 1)
console.log(`> pnpm update ${dependencies.join(` `)} --latest`)

try {
	executeFileSync(`pnpm`, [ `update`, ...dependencies, `--latest` ], { stdio: `inherit` })
} catch (error) {
	process.exit(/** @type {ExecuteFileSyncError} */ (error).status)
}

console.log(`> pnpm update @types/node`)

try {
	executeFileSync(`pnpm`, [ `update`, `@types/node` ], { stdio: `inherit` })
} catch (error) {
	process.exit(/** @type {ExecuteFileSyncError} */ (error).status)
}
