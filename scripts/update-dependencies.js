/* eslint-disable unicorn/no-process-exit */

import { execFileSync as executeFileSync } from "child_process"
import { readFileSync } from "fs"

const packageConfig = JSON.parse(readFileSync(`package.json`, { encoding: `utf-8` }))

const dependencies = [
	...Object.keys(packageConfig.dependencies || []),
	...Object.keys(packageConfig.devDependencies || []),
	...Object.keys(packageConfig.optionalDependencies || [])
]

dependencies.splice(dependencies.indexOf(`@types/node`), 1)

try {
	executeFileSync(`pnpm`, [ `update`, ...dependencies, `--latest` ], { stdio: `inherit` })
} catch (error) {
	process.exit(error.code)
}

try {
	executeFileSync(`pnpm`, [ `update`, `@types/node` ], { stdio: `inherit` })
} catch (error) {
	process.exit(error.code)
}
