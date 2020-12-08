import { exec } from "child_process"
import { readFile } from "fs/promises"

Promise.all([
	readFile("package.json", { encoding: "utf-8" })
		.then(JSON.parse)
		.then(({ version }: { version: string }) => version),
	execute("git rev-parse --short HEAD")
		.then(({ stdout }) => stdout.trim())
]).then(([ version, hash ]) =>
	execute(`npm version ${version}-${hash}`)
		.then(({ stdout }) => stdout)
		.then(console.log)
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
