import fs from "fs"
import { basename as getBaseName, extname as getFileExtension, resolve as resolvePath } from "path"

const { readFile, readdir: readDirectory, stat: getFileStatus, writeFile } = fs.promises

export async function syncMacros(hackmudPath: string) {
	const files = await readDirectory(hackmudPath, { withFileTypes: true })
	const macros = new Map<string, { macro: string, date: Date }>()
	const users: string[] = []

	for (const file of files) {
		if (!file.isFile())
			continue

		switch (getFileExtension(file.name)) {
			case ".macros": {
				const lines = (await readFile(resolvePath(hackmudPath, file.name), { encoding: "utf-8" })).split("\n")
				const date = (await getFileStatus(resolvePath(hackmudPath, file.name))).mtime

				for (let i = 0; i < lines.length / 2 - 1; i++) {
					const macroName = lines[i * 2]
					const curMacro = macros.get(macroName)

					if (!curMacro || date > curMacro.date)
						macros.set(macroName, { date, macro: lines[i * 2 + 1] })
				}
			} break

			case ".key": {
				users.push(getBaseName(file.name, ".key"))
			} break
		}
	}

	let macroFile = ""
	let macrosSynced = 0

	for (const [ name, { macro } ] of [ ...macros ].sort(([ a ], [ b ]) => (a as any > b as any) - (a as any < b as any))) {
		if (macro[0] != macro[0].toLowerCase())
			continue

		macroFile += `${name}\n${macro}\n`
		macrosSynced++
	}

	for (const user of users)
		writeFile(resolvePath(hackmudPath, user + ".macros"), macroFile)

	return { macrosSynced, usersSynced: users.length }
}

export default syncMacros
