import { countHackmudCharacters, DynamicMap, LaxPartial, writeFilePersistent } from "@samual/lib"
import fs from "fs"
import { basename as getBaseName, extname as getFileExtension, resolve as resolvePath } from "path"
import { Info } from "."
import { supportedExtensions } from "./constants.json"
import processScript from "./processScript"

const { readFile, readdir: readDirectory } = fs.promises

export type PushOptions = {
	/** whether to do the minify step (defaults to `true`) */
	minify: boolean

	/** whether to mangle function and class names (defaults to `false`) */
	mangleNames: boolean

	/**
	 * array of scripts in the format `foo.bar`
	 *
	 * also accepts wild card (`*`) e.g. `*.bar` or `foo.*`
	 *
	 * pushes everything by default (`*.*`)
	 */
	scripts: string[]

	/** callback called on script push */
	onPush: (info: Info) => void
}

/**
 * Push scripts from a source directory to the hackmud directory.
 *
 * Pushes files directly in the source folder to all users
 * @param sourceDirectory directory containing source code
 * @param hackmudDirectory directory created by hackmud containing user data including scripts
 * @param options {@link PushOptions details}
 * @returns array of info on pushed scripts
 */
export async function push(
	sourceDirectory: string,
	hackmudDirectory: string,
	{
		scripts = [ `*.*` ],
		onPush = () => {},
		minify = true,
		mangleNames = false
	}: LaxPartial<PushOptions> = {}
) {
	const scriptNamesByUser = new DynamicMap((_user: string) => new Set<string>())
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
			scriptNamesByUser.get(user).add(scriptName)
	}

	const usersByGlobalScriptsToPush = new DynamicMap((_user: string) => new Set<string>())
	const allInfo: Info[] = []
	const scriptNamesAlreadyPushedByUser = new DynamicMap((_user: string) => new Set<string>())
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
				.filter(dirent => dirent.isFile() && getFileExtension(dirent.name) == `.key`)
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
	await Promise.all([ ...wildScriptUsers ].map(async user => {
		await readDirectory(resolvePath(sourceDirectory, user), { withFileTypes: true }).then(async dirents => {
			await Promise.all(dirents.map(async dirent => {
				const extension = getFileExtension(dirent.name)

				if (dirent.isFile() && supportedExtensions.includes(extension)) {
					const scriptName = getBaseName(dirent.name, extension)
					const filePath = resolvePath(sourceDirectory, user, dirent.name)

					const { script: minifiedCode } = await processScript(
						await readFile(filePath, { encoding: `utf-8` }),
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
						error: undefined
					}

					scriptNamesAlreadyPushedByUser.get(user).add(scriptName)
					allInfo.push(info)
					await writeFilePersistent(resolvePath(hackmudDirectory, user, `scripts/${scriptName}.js`), minifiedCode)
					onPush(info)
				}
			}))
		}, (error: NodeJS.ErrnoException) => {
			if (error.code != `ENOENT`)
				throw error
		})
	}))

	// foo.bar
	await Promise.all([ ...scriptNamesByUser ].map(async ([ user, scripts ]) => {
		if (wildScriptUsers.has(user))
			return

		await Promise.all([ ...scripts ].map(async scriptName => {
			let code
			let fileName
			let filePath!: string

			// TODO there's definitly a better way to do this
			for (const extension of supportedExtensions) {
				try {
					fileName = `${scriptName}${extension}`
					// eslint-disable-next-line no-await-in-loop -- I don't think paralelysing this is worth it
					code = await readFile(filePath = resolvePath(sourceDirectory, user, fileName), { encoding: `utf-8` })

					break
				} catch {}
			}

			if (code) {
				const { script: minifiedCode } = await processScript(
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
					error: undefined
				}

				allInfo.push(info)
				await writeFilePersistent(resolvePath(hackmudDirectory, user, `scripts`, `${scriptName}.js`), minifiedCode)
				onPush(info)
			} else
				usersByGlobalScriptsToPush.get(scriptName).add(user)
		}))
	}))

	// foo.* (global)
	await (wildScriptUsers.size
		? Promise.all((sourceDirectoryDirents || await readDirectory(resolvePath(sourceDirectory), { withFileTypes: true })).map(async dirent => {
			const extension = getFileExtension(dirent.name)

			if (!dirent.isFile() || !supportedExtensions.includes(extension))
				return

			const scriptName = getBaseName(dirent.name, extension)
			const usersToPushTo = [ ...wildScriptUsers, ...usersByGlobalScriptsToPush.get(scriptName) ].filter(user => !scriptNamesAlreadyPushedByUser.get(user).has(scriptName))

			if (!usersToPushTo.length)
				return

			const uniqueID = Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, `0`)
			const filePath = resolvePath(sourceDirectory, dirent.name)

			const { script: minifiedCode } = await processScript(
				await readFile(filePath, { encoding: `utf-8` }),
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
				error: undefined
			}

			await Promise.all(usersToPushTo.map(user =>
				writeFilePersistent(
					resolvePath(
						hackmudDirectory,
						user,
						`scripts/${scriptName}.js`
					),
					minifiedCode
						.replace(new RegExp(`$${uniqueID}$SCRIPT_USER`, `g`), user)
						.replace(new RegExp(`$${uniqueID}$FULL_SCRIPT_NAME`, `g`), `${user}.${scriptName}`)
				)
			))

			allInfo.push(info)
			onPush(info)
		})) : Promise.all([ ...usersByGlobalScriptsToPush ].map(async ([ scriptName, users ]) => {
			let code
			let fileName!: string
			let filePath!: string

			// TODO there's definitly a better way to do this
			for (const extension of supportedExtensions) {
				try {
					fileName = `${scriptName}${extension}`
					// eslint-disable-next-line no-await-in-loop -- I don't think paralelysing this is worth it
					code = await readFile(filePath = resolvePath(sourceDirectory, fileName), { encoding: `utf-8` })

					break
				} catch {}
			}

			if (code) {
				const uniqueID = Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, `0`)

				const { script: minifiedCode } = await processScript(
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
					error: undefined
				}

				await Promise.all([ ...users ].map(user =>
					writeFilePersistent(
						resolvePath(
							hackmudDirectory,
							user,
							`scripts/${scriptName}.js`
						),
						minifiedCode
							.replace(new RegExp(`$${uniqueID}$SCRIPT_USER`, `g`), user)
							.replace(new RegExp(`$${uniqueID}$FULL_SCRIPT_NAME`, `g`), `${user}.${scriptName}`)
					)
				))

				allInfo.push(info)
				onPush(info)
			}
		}))
	)

	return allInfo
}

export default push
