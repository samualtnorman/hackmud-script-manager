import { exec } from "child_process"
import { readFile } from "fs/promises"
import { PackageId } from "typescript"

const packageJSON = readFile("package.json", { encoding: "utf-8" }).then(JSON.parse) as Promise<PackageId>
const hash = execute("git rev-parse HEAD").then(({ stdout }) => stdout.slice(0, 7)) as Promise<string>

Promise.all([ packageJSON, hash ]).then(async ([ packageJSON, hash ]) => {
	await execute(`npm version ${packageJSON.version}-${hash}`).then(console.log, console.log)
})

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
