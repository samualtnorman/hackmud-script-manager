import fs from "fs"
import { basename as getBaseName, extname as getFileExtension, resolve as resolvePath } from "path"
import { Info, processScript, supportedExtensions } from "."
import { DynamicMap, forEachAsync, hackmudLength, writeFilePersist } from "./lib"

const { readFile, readdir: readDirectory } = fs.promises

interface PushOptions {
	/**
	 * array of scripts in the format `foo.bar`
	 *
	 * also accepts wild card e.g. `*.bar` or `foo.*`
	 *
	 * pushes everything by default
	 */
	scripts: string | string[]

	/** callback when a script is pushed */
	onPush: (info: Info) => void

	/** whether to do the minify step (defaults to `true`) */
	minify: boolean
}

/**
 * Push scripts from a source directory to the hackmud directory.
 *
 * Files directly in the source folder are pushed to all users
 * @param sourceDirectory directory containing source code
 * @param hackmudDirectory directory created by hackmud containing user data including scripts
 * @param options {@link PushOptions details}
 * @returns array of info on pushed scripts
 */
export async function push(
	sourceDirectory: string,
	hackmudDirectory: string,
	{
		scripts = "*.*",
		onPush = (info: Info) => {},
		minify = true
	}: Partial<PushOptions> = {}
) {
	if (typeof scripts == "string")
		scripts = [ scripts ]

	const scriptNamesByUser = new DynamicMap((user: string) => new Set<string>())
	const wildScriptUsers = new Set<string>()
	const wildUserScripts = new Set<string>()

	let pushEverything = false

	for (const fullScriptName of scripts) {
		const [ user, scriptName ] = fullScriptName.split(".")

		if (!user || user == "*") {
			if (!scriptName || scriptName == "*")
				pushEverything = true
			else
				wildUserScripts.add(scriptName)
		} else if (!scriptName || scriptName == "*")
			wildScriptUsers.add(user)
		else
			scriptNamesByUser.get(user).add(scriptName)
	}

	const usersByGlobalScriptsToPush = new DynamicMap((user: string) => new Set<string>())
	const allInfo: Info[] = []
	const scriptNamesAlreadyPushedByUser = new DynamicMap((user: string) => new Set<string>())

	let sourceDirectoryDirents

	// *.bar
	if (wildUserScripts.size || pushEverything) {
		const hackmudDirectoryDirents = await readDirectory(resolvePath(hackmudDirectory), { withFileTypes: true })

		const allUsers = new Set([
			...(sourceDirectoryDirents = await readDirectory(resolvePath(sourceDirectory), { withFileTypes: true }))
				.filter(dirent => dirent.isDirectory())
				.map(dirent => dirent.name),
			...hackmudDirectoryDirents
				.filter(dirent => dirent.isDirectory())
				.map(dirent => dirent.name),
			...hackmudDirectoryDirents
				.filter(dirent => dirent.isFile() && getFileExtension(dirent.name) == ".key")
				.map(dirent => dirent.name.slice(0, -4)),
			...scriptNamesByUser.keys(),
			...wildScriptUsers
		])

		if (pushEverything) {
			for (const user of allUsers)
				wildScriptUsers.add(user)
		} else {
			for (const user of allUsers) {
				const scriptNames = scriptNamesByUser.get(user)

				for (const scriptName of wildUserScripts)
					scriptNames.add(scriptName)
			}
		}
	}

	// foo.*
	await forEachAsync(wildScriptUsers, async user => {
		await readDirectory(resolvePath(sourceDirectory, user), { withFileTypes: true }).then(async dirents => {
			await forEachAsync(dirents, async dirent => {
				const extension = getFileExtension(dirent.name)

				if (dirent.isFile() && supportedExtensions.includes(extension)) {
					const { srcLength, script: minifiedCode } = await processScript(
						await readFile(resolvePath(sourceDirectory, user, dirent.name), { encoding: "utf-8" }),
						{ minify }
					)

					const info: Info = {
						file: `${user}/${dirent.name}`,
						users: [ user ],
						minLength: hackmudLength(minifiedCode),
						error: null,
						srcLength
					}

					const scriptName = getBaseName(dirent.name, extension)

					scriptNamesAlreadyPushedByUser.get(user).add(scriptName)
					allInfo.push(info)

					await writeFilePersist(resolvePath(hackmudDirectory, user, `scripts/${scriptName}.js`), minifiedCode)

					onPush(info)
				}
			})
		}, (error: NodeJS.ErrnoException) => {
			if (error.code != "ENOENT")
				throw error
		})
	})

	// foo.bar
	await forEachAsync(scriptNamesByUser, async ([ user, scripts ]) => {
		if (wildScriptUsers.has(user))
			return

		await forEachAsync(scripts, async scriptName => {
			let code
			let fileName

			for (const extension of supportedExtensions) {
				try {
					fileName = `${scriptName}${extension}`
					code = await readFile(resolvePath(sourceDirectory, user, fileName), { encoding: "utf-8" })
					break
				} catch {}
			}

			if (code) {
				const { srcLength, script: minifiedCode } = await processScript(code, { minify })

				const info: Info = {
					file: `${user}/${fileName}`,
					users: [ user ],
					minLength: hackmudLength(minifiedCode),
					error: null,
					srcLength
				}

				allInfo.push(info)

				await writeFilePersist(resolvePath(hackmudDirectory, user, "scripts", `${scriptName}.js`), minifiedCode)

				onPush(info)
			} else
				usersByGlobalScriptsToPush.get(scriptName).add(user)
		})
	})

	// foo.* (global)
	if (wildScriptUsers.size) {
		await forEachAsync(sourceDirectoryDirents || await readDirectory(resolvePath(sourceDirectory), { withFileTypes: true }), async dirent => {
			const extension = getFileExtension(dirent.name)

			if (!dirent.isFile() || !supportedExtensions.includes(extension))
				return

			const scriptName = getBaseName(dirent.name, extension)
			const usersToPushTo = [ ...wildScriptUsers, ...usersByGlobalScriptsToPush.get(scriptName) ].filter(user => !scriptNamesAlreadyPushedByUser.get(user).has(scriptName))

			if (!usersToPushTo.length)
				return

			const { srcLength, script: minifiedCode } = await processScript(
				await readFile(resolvePath(sourceDirectory, dirent.name), { encoding: "utf-8" }),
				{ minify }
			)

			const info: Info = {
				file: dirent.name,
				users: usersToPushTo,
				minLength: hackmudLength(minifiedCode),
				error: null,
				srcLength
			}

			await forEachAsync(usersToPushTo, user =>
				writeFilePersist(resolvePath(hackmudDirectory, user, `scripts/${scriptName}.js`), minifiedCode)
			)

			allInfo.push(info)
			onPush(info)
		})
	} else {
		// foo.bar (global)
		await forEachAsync(usersByGlobalScriptsToPush, async ([ scriptName, users ]) => {
			let code
			let fileName!: string

			for (const extension of supportedExtensions) {
				try {
					fileName = `${scriptName}${extension}`
					code = await readFile(resolvePath(sourceDirectory, fileName), { encoding: "utf-8" })
					break
				} catch {}
			}

			if (code) {
				const { srcLength, script: minifiedCode } = await processScript(code, { minify })

				const info: Info = {
					file: fileName,
					users: [ ...users ],
					minLength: hackmudLength(minifiedCode),
					error: null,
					srcLength
				}

				await forEachAsync(users, user =>
					writeFilePersist(resolvePath(hackmudDirectory, user, "scripts", `${scriptName}.js`), minifiedCode)
				)

				allInfo.push(info)
				onPush(info)
			} else
				throw new Error(`couldn't find script named "${scriptName}" in ${resolvePath(sourceDirectory, users.values().next().value)} or ${resolvePath(sourceDirectory)}`)
		})
	}

	return allInfo
}

export default push
