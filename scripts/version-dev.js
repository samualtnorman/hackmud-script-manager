import { exec as execute_, execFileSync as executeFileSync } from "child_process"
import { readFile } from "fs/promises"
import semver from "semver"
import { promisify } from "util"

const execute = promisify(execute_)

const [ { version }, gitHash ] = await Promise.all([
	readFile(`package.json`, { encoding: `utf-8` }).then(JSON.parse),
	execute(`git rev-parse --short HEAD`).then(({ stdout }) => stdout.trim())
])

executeFileSync(`npm`, [ `version`, `${semver.inc(version, `minor`)}-${gitHash}` ], { stdio: `inherit` })
