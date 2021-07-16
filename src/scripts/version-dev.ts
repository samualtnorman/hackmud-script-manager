import semver from "semver"
import { readFile, execute } from "../lib"

(async () => {
	const [ packageJSONFile, { stdout: gitGetHashStdout } ] = await Promise.all([ readFile("package.json", { encoding: "utf-8" }), execute("git rev-parse --short HEAD") ])
	console.log((await execute(`npm version ${semver.inc(JSON.parse(packageJSONFile).version, "minor")}-${gitGetHashStdout.trim()}`)).stdout)
})()
