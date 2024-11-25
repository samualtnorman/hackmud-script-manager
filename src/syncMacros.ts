import { readDirectoryWithStats } from "@samual/lib/readDirectoryWithStats"
import { stat as getFileStatus, readFile, writeFile } from "fs/promises"
import { basename as getBaseName, extname as getFileExtension, resolve as resolvePath } from "path"

export async function syncMacros(hackmudPath: string): Promise<{ macrosSynced: number, usersSynced: number }> {
	const files = await readDirectoryWithStats(hackmudPath)
	const macros = new Map<string, { macro: string, date: Date }>()
	const users: string[] = []

	await Promise.all(files.map(async file => {
		if (!file.stats.isFile())
			return

		switch (getFileExtension(file.name)) {
			case `.macros`: {
				const [ lines, date ] = await Promise.all([
					readFile(resolvePath(hackmudPath, file.name), { encoding: `utf8` }).then(file => file.split(`\n`)),
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

	for (const [ name, { macro } ] of
		[ ...macros ].sort(([ a ], [ b ]) => (a as any > b as any) - (a as any < b as any))
	) {
		if (macro[0] == macro[0]!.toLowerCase()) {
			macroFile += `${name}\n${macro}\n`
			macrosSynced++
		}
	}

	await Promise.all(users.map(async user => writeFile(resolvePath(hackmudPath, `${user}.macros`), macroFile)))

	return { macrosSynced, usersSynced: users.length }
}
