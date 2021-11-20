import { countHackmudCharacters, DynamicMap, forEachParallel, writeFilePersistent } from "@samual/lib"
import { promises as fsPromises } from "fs"
import { basename as getBaseName, extname as getFileExtension, resolve as resolvePath } from "path"
import { Info, processScript, supportedExtensions } from "."

const { readFile, readdir: readDirectory } = fsPromises

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

	/** whether to mangle function and class names (defaults to `false`) */
	mangleNames: boolean
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
		minify = true,
		mangleNames = false
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
	await forEachParallel(wildScriptUsers, async user => {
		await readDirectory(resolvePath(sourceDirectory, user), { withFileTypes: true }).then(async dirents => {
			await forEachParallel(dirents, async dirent => {
				const extension = getFileExtension(dirent.name)

				if (dirent.isFile() && supportedExtensions.includes(extension)) {
					const scriptName = getBaseName(dirent.name, extension)
					const filePath = resolvePath(sourceDirectory, user, dirent.name)

					const { srcLength, script: minifiedCode } = await processScript(
						await readFile(filePath, { encoding: "utf-8" }),
						{
							minify,
							scriptUser: user,
							scriptName,
							filePath,
							mangleNames
						}
					)

					const info: Info = {
						file: `${user}/${dirent.name}`,
						users: [ user ],
						minLength: countHackmudCharacters(minifiedCode),
						error: null,
						srcLength
					}

					scriptNamesAlreadyPushedByUser.get(user).add(scriptName)
					allInfo.push(info)

					await writeFilePersistent(resolvePath(hackmudDirectory, user, `scripts/${scriptName}.js`), minifiedCode)

					onPush(info)
				}
			})
		}, (error: NodeJS.ErrnoException) => {
			if (error.code != "ENOENT")
				throw error
		})
	})

	// foo.bar
	await forEachParallel(scriptNamesByUser, async ([ user, scripts ]) => {
		if (wildScriptUsers.has(user))
			return

		await forEachParallel(scripts, async scriptName => {
			let code
			let fileName

			let filePath!: string

			for (const extension of supportedExtensions) {
				try {
					fileName = `${scriptName}${extension}`
					code = await readFile(filePath = resolvePath(sourceDirectory, user, fileName), { encoding: "utf-8" })
					break
				} catch {}
			}

			if (code) {
				const { srcLength, script: minifiedCode } = await processScript(
					code,
					{
						minify,
						scriptUser: user,
						scriptName,
						filePath,
						mangleNames
					}
				)

				const info: Info = {
					file: `${user}/${fileName}`,
					users: [ user ],
					minLength: countHackmudCharacters(minifiedCode),
					error: null,
					srcLength
				}

				allInfo.push(info)

				await writeFilePersistent(resolvePath(hackmudDirectory, user, "scripts", `${scriptName}.js`), minifiedCode)

				onPush(info)
			} else
				usersByGlobalScriptsToPush.get(scriptName).add(user)
		})
	})

	// foo.* (global)
	if (wildScriptUsers.size) {
		await forEachParallel(sourceDirectoryDirents || await readDirectory(resolvePath(sourceDirectory), { withFileTypes: true }), async dirent => {
			const extension = getFileExtension(dirent.name)

			if (!dirent.isFile() || !supportedExtensions.includes(extension))
				return

			const scriptName = getBaseName(dirent.name, extension)
			const usersToPushTo = [ ...wildScriptUsers, ...usersByGlobalScriptsToPush.get(scriptName) ].filter(user => !scriptNamesAlreadyPushedByUser.get(user).has(scriptName))

			if (!usersToPushTo.length)
				return

			const uniqueID = Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, "0")
			const filePath = resolvePath(sourceDirectory, dirent.name)

			const { srcLength, script: minifiedCode } = await processScript(
				await readFile(filePath, { encoding: "utf-8" }),
				{
					minify,
					scriptUser: true,
					scriptName,
					uniqueID,
					filePath,
					mangleNames
				}
			)

			const info: Info = {
				file: dirent.name,
				users: usersToPushTo,
				minLength: countHackmudCharacters(minifiedCode),
				error: null,
				srcLength
			}

			await forEachParallel(usersToPushTo, user =>
				writeFilePersistent(
					resolvePath(
						hackmudDirectory,
						user,
						`scripts/${scriptName}.js`
					),
					minifiedCode
						.replace(new RegExp(`$${uniqueID}$SCRIPT_USER`, "g"), user)
						.replace(new RegExp(`$${uniqueID}$FULL_SCRIPT_NAME`, "g"), `${user}.${scriptName}`)
				)
			)

			allInfo.push(info)
			onPush(info)
		})
	} else {
		// foo.bar (global)
		await forEachParallel(usersByGlobalScriptsToPush, async ([ scriptName, users ]) => {
			let code
			let fileName!: string
			let filePath!: string

			for (const extension of supportedExtensions) {
				try {
					fileName = `${scriptName}${extension}`
					code = await readFile(filePath = resolvePath(sourceDirectory, fileName), { encoding: "utf-8" })
					break
				} catch {}
			}

			if (code) {
				const uniqueID = Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, "0")

				const { srcLength, script: minifiedCode } = await processScript(
					code,
					{
						minify,
						scriptUser: true,
						scriptName,
						uniqueID,
						filePath,
						mangleNames
					}
				)

				const info: Info = {
					file: fileName,
					users: [ ...users ],
					minLength: countHackmudCharacters(minifiedCode),
					error: null,
					srcLength
				}

				await forEachParallel(users, user =>
					writeFilePersistent(
						resolvePath(
							hackmudDirectory,
							user,
							`scripts/${scriptName}.js`
						),
						minifiedCode
							.replace(new RegExp(`$${uniqueID}$SCRIPT_USER`, "g"), user)
							.replace(new RegExp(`$${uniqueID}$FULL_SCRIPT_NAME`, "g"), `${user}.${scriptName}`)
					)
				)

				allInfo.push(info)
				onPush(info)
			}
		})
	}

	return allInfo
}

export default push
