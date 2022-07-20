import { readdir as readDirectory, readFile, stat as getFileStatus, writeFile } from "fs/promises"
import { basename as getBaseName, extname as getFileExtension, resolve as resolvePath } from "path"

export const syncMacros = async (hackmudPath: string) => {
	const files = await readDirectory(hackmudPath, { withFileTypes: true })
	const macros = new Map<string, { macro: string, date: Date }>()
	const users: string[] = []

	await Promise.all(files.map(async file => {
		if (!file.isFile())
			return

		switch (getFileExtension(file.name)) {
			case `.macros`: {
				const [ lines, date ] = await Promise.all([
					readFile(resolvePath(hackmudPath, file.name), { encoding: `utf-8` }).then(file => file.split(`\n`)),
					getFileStatus(resolvePath(hackmudPath, file.name)).then(({ mtime }) => mtime)
				])

				for (let index = 0; index < (lines.length / 2) - 1; index++) {
					const macroName = lines[index * 2]!
					const currentMacro = macros.get(macroName)

					if (!currentMacro || date > currentMacro.date)
						macros.set(macroName, { date, macro: lines[(index * 2) + 1]! })
				}
			} break

			case `.key`: {
				users.push(getBaseName(file.name, `.key`))
			} break
		}
	}))

	let macroFile = ``
	let macrosSynced = 0

	for (const [ name, { macro } ] of [ ...macros ].sort(([ a ], [ b ]) => (a as any > b as any) - (a as any < b as any))) {
		if (macro[0] != macro[0]!.toLowerCase())
			continue

		macroFile += `${name}\n${macro}\n`
		macrosSynced++
	}

	for (const user of users)
		writeFile(resolvePath(hackmudPath, `${user}.macros`), macroFile)

	return { macrosSynced, usersSynced: users.length }
}

export default syncMacros
