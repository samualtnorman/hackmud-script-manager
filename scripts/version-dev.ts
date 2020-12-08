import { exec } from "child_process"
import { readFile } from "fs/promises"
import { inc } from "semver"

Promise.all([
	readFile("package.json", { encoding: "utf-8" })
		.then(JSON.parse)
		.then(({ version }: { version: string }) => inc(version, "minor")),
	execute("git rev-parse --short HEAD")
		.then(({ stdout }) => stdout.trim())
]).then(([ version, hash ]) =>
	execute(`npm version ${version}-${hash}`)
		.then(({ stdout }) => console.log(stdout))
)

function execute(command: string) {
	return new Promise<{
		stdout: string
		stderr: string
	}>((resolve, reject) =>
		exec(command, (error, stdout, stderr) => {
			if (error)
				return reject(error)

			resolve({ stdout, stderr })
		})
	)
}
