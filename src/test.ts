import fs from "fs"
import { extname as getFileExtension, resolve as resolvePath } from "path"
import { supportedExtensions } from "./constants.json"
import processScript from "./processScript"

const { readFile, readdir: readDirectory } = fs.promises

export async function test(sourcePath: string) {
	const promises: Promise<any>[] = []

	const errors: {
		file: string
		message: string
		line: number
	}[] = []

	for (const dirent of await readDirectory(sourcePath, { withFileTypes: true })) {
		if (dirent.isDirectory()) {
			promises.push(readDirectory(resolvePath(sourcePath, dirent.name), { withFileTypes: true }).then(files => {
				const promises: Promise<any>[] = []

				for (const file of files) {
					if (!file.isFile() || !supportedExtensions.includes(getFileExtension(file.name)))
						continue

					promises.push(
						readFile(resolvePath(sourcePath, dirent.name, file.name), { encoding: `utf-8` })
							.then(processScript)
							.then(({ warnings }) =>
								errors.push(...warnings.map(({ message, line }) => ({
									file: `${dirent.name}/${file.name}`,
									message,
									line
								})))
							)
					)
				}

				return Promise.all(promises)
			}))
		} else if (dirent.isFile() && supportedExtensions.includes(getFileExtension(dirent.name))) {
			promises.push(
				readFile(resolvePath(sourcePath, dirent.name), { encoding: `utf-8` })
					.then(processScript)
					.then(({ warnings }) =>
						errors.push(...warnings.map(({ message, line }) => ({
							file: dirent.name,
							message,
							line
						})))
					)
			)
		}
	}

	await Promise.all(promises)

	return errors
}

export default test
