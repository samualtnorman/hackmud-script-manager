import type { LaxPartial } from "@samual/lib"
import { AutoMap } from "@samual/lib/AutoMap"
import { assert } from "@samual/lib/assert"
import { countHackmudCharacters } from "@samual/lib/countHackmudCharacters"
import { readDirectoryWithStats } from "@samual/lib/readDirectoryWithStats"
import { writeFilePersistent } from "@samual/lib/writeFilePersistent"
import { watch as watchDirectory } from "chokidar"
import { stat as getFileStats, readFile, writeFile } from "fs/promises"
import { extname as getFileExtension, basename as getPathBaseName, resolve as resolvePath } from "path"
import { supportedExtensions } from "./constants"
import { generateTypeDeclaration } from "./generateTypeDeclaration"
import { processScript } from "./processScript"
import type { PushOptions } from "./push"

export type WatchOptions = PushOptions & LaxPartial<{
	/** if provided, will write typescript type declarations for all the scripts on every change detected
	  *
	  * writing the type declarations enables interscript type checking and autocompletetes for the args */
	typeDeclarationPath: string

	onReady: () => void
}>

/** Watches target file or folder for updates and builds and pushes updated file.
  * @param sourceDirectory path to folder containing source files
  * @param hackmudDirectory path to hackmud directory
  * @param options {@link WatchOptions details} and {@link PushOptions more details} */
export async function watch(sourceDirectory: string, hackmudDirectory: string, {
	scripts = [ `*.*` ],
	onPush,
	minify = true,
	mangleNames = false,
	typeDeclarationPath: typeDeclarationPath_,
	onReady,
	forceQuineCheats
}: WatchOptions = {}) {
	if (!scripts.length)
		throw new Error(`scripts option was an empty array`)

	const sourceFolderStats = await getFileStats(sourceDirectory)

	if (!sourceFolderStats.isDirectory())
		throw Error(`Target folder must be a folder`)

	const scriptNamesToUsers = new AutoMap((_scriptName: string) => new Set<string>())
	const wildScriptUsers = new Set<string>()
	const wildUserScripts = new Set<string>()
	let pushEverything = false

	for (const fullScriptName of scripts) {
		const [ user, scriptName ] = fullScriptName.split(`.`)

		if (!user || user == `*`) {
			if (!scriptName || scriptName == `*`)
				pushEverything = true
			else
				wildUserScripts.add(scriptName)
		} else if (!scriptName || scriptName == `*`)
			wildScriptUsers.add(user)
		else
			scriptNamesToUsers.get(scriptName).add(user)
	}

	const watcher = watchDirectory(`.`, {
		cwd: sourceDirectory,
		awaitWriteFinish: { stabilityThreshold: 100 },
		ignored: (path, stats) => !!stats?.isFile() &&
			!((path.endsWith(`.js`) || (path.endsWith(`.ts`) && !path.endsWith(`.d.ts`))))
	}).on(`change`, async path => {
		if (path.endsWith(`.d.ts`))
			return

		const extension = getFileExtension(path)

		if (!supportedExtensions.includes(extension))
			return

		const scriptName = getPathBaseName(path, extension)

		// if the path is still the same after getting just the base, it means it's directly in the source directory
		// (global)
		if (path == getPathBaseName(path)) {
			if (!pushEverything && !wildScriptUsers.size && !wildUserScripts.has(scriptName) &&
				!scriptNamesToUsers.has(scriptName)
			)
				return

			const scriptNamesToUsersToSkip = new AutoMap((_scriptName: string): string[] => [])

			await Promise.all((await readDirectoryWithStats(sourceDirectory)).map(async ({ stats, name, path }) => {
				if (stats.isDirectory()) {
					for (const child of await readDirectoryWithStats(path)) {
						if (child.stats.isFile()) {
							const fileExtension = getFileExtension(child.name)

							if (supportedExtensions.includes(fileExtension))
								scriptNamesToUsersToSkip.get(getPathBaseName(child.name, fileExtension)).push(name)
						}
					}
				}
			}))

			const usersToPushToSet = new Set<string>()

			if (pushEverything || wildUserScripts.has(scriptName)) {
				for (const { stats, name } of await readDirectoryWithStats(sourceDirectory)) {
					if (stats.isDirectory())
						usersToPushToSet.add(name)
				}

				for (const { stats, name } of await readDirectoryWithStats(hackmudDirectory)) {
					if (stats.isDirectory())
						usersToPushToSet.add(name)
					else if (stats.isFile() && name.endsWith(`.key`))
						usersToPushToSet.add(name.slice(0, -4))
				}

				for (const users of scriptNamesToUsers.values()) {
					for (const user of users)
						usersToPushToSet.add(user)
				}
			}

			for (const user of wildScriptUsers)
				usersToPushToSet.add(user)

			for (const user of scriptNamesToUsers.get(scriptName))
				usersToPushToSet.add(user)

			const usersToPushTo = [ ...usersToPushToSet ].filter(user => !scriptNamesToUsersToSkip.has(user))

			if (!usersToPushTo.length) {
				onPush?.({ path, users: [], characterCount: 0, error: new Error(`no users to push to`) })

				return
			}

			const uniqueId = Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, `0`)
			const filePath = resolvePath(sourceDirectory, path)
			let minifiedCode: string

			try {
				({ script: minifiedCode } = await processScript(
					await readFile(filePath, { encoding: `utf8` }),
					{ minify, scriptUser: true, scriptName, uniqueId, filePath, mangleNames, forceQuineCheats }
				))
			} catch (error) {
				assert(error instanceof Error, HERE)
				onPush?.({ path, users: [], characterCount: 0, error })

				return
			}

			await Promise.all(usersToPushTo.map(user => writeFilePersistent(
				resolvePath(hackmudDirectory, user, `scripts/${scriptName}.js`),
				minifiedCode.replace(new RegExp(`\\$${uniqueId}\\$SCRIPT_USER\\$`, `g`), user)
					.replace(new RegExp(`\\$${uniqueId}\\$FULL_SCRIPT_NAME\\$`, `g`), `${user}.${scriptName}`)
			)))

			onPush?.(
				{ path, users: usersToPushTo, characterCount: countHackmudCharacters(minifiedCode), error: undefined }
			)

			return
		}

		const user = getPathBaseName(resolvePath(path, `..`))

		if (!pushEverything && !wildScriptUsers.size && !wildUserScripts.has(scriptName) &&
			!scriptNamesToUsers.get(scriptName).has(user)
		)
			return

		const filePath = resolvePath(sourceDirectory, path)
		const sourceCode = await readFile(filePath, { encoding: `utf8` })
		let script

		try {
			({ script } = await processScript(
				sourceCode,
				{ minify, scriptUser: user, scriptName, filePath, mangleNames, forceQuineCheats }
			))
		} catch (error) {
			assert(error instanceof Error, HERE)
			onPush?.({ path, users: [], characterCount: 0, error })

			return
		}

		await writeFilePersistent(resolvePath(hackmudDirectory, user, `scripts`, `${scriptName}.js`), script)
		onPush?.({ path, users: [ user ], characterCount: countHackmudCharacters(script), error: undefined })
	})

	if (onReady)
		watcher.on(`ready`, onReady)

	if (!typeDeclarationPath_)
		return

	let typeDeclarationPath = typeDeclarationPath_

	/*
		this currently works because the generated type declaration effectively
		just connects things and doesn't actually read the scripts it's
		generating type declarations for

		if I ever change `generateTypings()` to actually read the scripts to
		grab their types, this will need to change
	*/

	const writeTypeDeclaration = async () => {
		const typeDeclaration = await generateTypeDeclaration(sourceDirectory, hackmudDirectory)

		try {
			await writeFile(typeDeclarationPath, typeDeclaration)
		} catch (error) {
			assert(error instanceof Error, HERE)

			if (!((error as NodeJS.ErrnoException).code == `EISDIR`))
				throw error

			typeDeclarationPath = resolvePath(typeDeclarationPath, `player.d.ts`)
			await writeFile(typeDeclarationPath, typeDeclaration)
		}
	}

	await writeTypeDeclaration()
	watcher.on(`add`, writeTypeDeclaration)
	watcher.on(`unlink`, writeTypeDeclaration)
}
