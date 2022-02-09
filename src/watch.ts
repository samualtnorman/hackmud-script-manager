import { assert, countHackmudCharacters, DynamicMap, writeFilePersistent } from "@samual/lib"
import { watch as watchDirectory } from "chokidar"
import fs from "fs"
import { basename as getPathBaseName, extname as getFileExtension, resolve as resolvePath } from "path"
import { Info } from "."
import { supportedExtensions } from "./constants.json"
import generateTypings from "./generateTypings"
import processScript from "./processScript"
import { PushOptions } from "./push"

const { readFile, readdir: readDirectory } = fs.promises

type PartialUndefinable<T> = { [P in keyof T]?: T[P] | undefined }

export type WatchOptions = PushOptions & {
	/**
	 * if provided, will write typescript type declarations for all the scripts on every change detected
	 *
	 * writing the type declarations enables interscript type checking and autocompletetes for the args
	 */
	typeDeclarationPath: string
}

/**
 * Watches target file or folder for updates and builds and pushes updated file.
 *
 * @param sourceDirectory path to folder containing source files
 * @param hackmudDirectory path to hackmud directory
 * @param users to push to (pushes to all if empty)
 * @param scripts to push from (pushes from all if empty)
 * @param onPush function that's called on each script push
 */
export function watch(
	sourceDirectory: string,
	hackmudDirectory: string,
	{
		scripts = [ `*.*` ],
		onPush,
		minify = true,
		mangleNames = false,
		typeDeclarationPath
	}: PartialUndefinable<WatchOptions> = {}
) {
	if (typeof scripts == `string`)
		scripts = [ scripts ]
	else if (!scripts.length)
		throw new Error(`scripts option was an empty array`)

	const scriptNamesToUsers = new DynamicMap((_scriptName: string) => new Set<string>())
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

	const watcher = watchDirectory(``, { depth: 1, cwd: sourceDirectory, awaitWriteFinish: { stabilityThreshold: 100 } }).on(`change`, async path => {
		const extension = getFileExtension(path)

		if (!supportedExtensions.includes(extension))
			return

		const scriptName = getPathBaseName(path, extension)

		// if the path is still the same after getting just the base, it means it's directly in the source directory (global)
		if (path == getPathBaseName(path)) {
			if (!pushEverything && !wildScriptUsers.size && !wildUserScripts.has(scriptName) && !scriptNamesToUsers.has(scriptName))
				return

			const scriptNamesToUsersToSkip = new DynamicMap((_scriptName: string): string[] => [])

			await Promise.all((await readDirectory(sourceDirectory, { withFileTypes: true })).map(async dirent => {
				if (!dirent.isDirectory())
					return

				for (const file of await readDirectory(resolvePath(sourceDirectory, dirent.name), { withFileTypes: true })) {
					if (!file.isFile())
						continue

					const fileExtension = getFileExtension(file.name)

					if (supportedExtensions.includes(fileExtension))
						scriptNamesToUsersToSkip.get(getPathBaseName(file.name, fileExtension)).push(dirent.name)
				}
			}))

			const usersToPushToSet = new Set<string>()

			if (pushEverything || wildUserScripts.has(scriptName)) {
				for (const dirent of await readDirectory(resolvePath(sourceDirectory), { withFileTypes: true })) {
					if (dirent.isDirectory())
						usersToPushToSet.add(dirent.name)
				}

				for (const dirent of await readDirectory(resolvePath(hackmudDirectory), { withFileTypes: true })) {
					if (dirent.isDirectory())
						usersToPushToSet.add(dirent.name)
					else if (dirent.isFile() && dirent.name.endsWith(`.key`))
						usersToPushToSet.add(dirent.name.slice(0, -4))
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
				onPush?.({
					file: path,
					users: [],
					srcLength: 0,
					minLength: 0,
					error: new Error(`no users to push to`)
				})

				return
			}

			const uniqueID = Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, `0`)
			const filePath = resolvePath(sourceDirectory, path)
			let sourceCharacterCount
			let minifiedCode: string

			try {
				({ srcLength: sourceCharacterCount, script: minifiedCode } = await processScript(
					await readFile(filePath, { encoding: `utf-8` }),
					{
						minify,
						scriptUser: true,
						scriptName,
						uniqueID,
						filePath,
						mangleNames
					}
				))
			} catch (error) {
				assert(error instanceof Error)

				onPush?.({
					file: path,
					users: [],
					srcLength: 0,
					minLength: 0,
					error
				})

				return
			}

			await Promise.all(usersToPushTo.map(user => writeFilePersistent(
				resolvePath(hackmudDirectory, user, `scripts/${scriptName}.js`),
				minifiedCode
					.replace(new RegExp(`$${uniqueID}$SCRIPT_USER`, `g`), user)
					.replace(new RegExp(`$${uniqueID}$FULL_SCRIPT_NAME`, `g`), `${user}.${scriptName}`)
			)))

			onPush?.({
				file: path,
				users: usersToPushTo,
				minLength: countHackmudCharacters(minifiedCode),
				error: undefined,
				srcLength: sourceCharacterCount
			})

			return
		}

		const user = getPathBaseName(resolvePath(path, `..`))

		if (!pushEverything && !wildScriptUsers.size && !wildUserScripts.has(scriptName) && !scriptNamesToUsers.get(scriptName).has(user))
			return

		const filePath = resolvePath(sourceDirectory, path)
		const sourceCode = await readFile(filePath, { encoding: `utf-8` })
		let sourceCharacterCount
		let script

		try {
			({ srcLength: sourceCharacterCount, script } = await processScript(sourceCode, {
				minify,
				scriptUser: user,
				scriptName,
				filePath,
				mangleNames
			}))
		} catch (error) {
			assert(error instanceof Error)

			onPush?.({
				file: path,
				users: [],
				srcLength: 0,
				minLength: 0,
				error
			})

			return
		}

		await writeFilePersistent(resolvePath(hackmudDirectory, user, `scripts`, `${scriptName}.js`), script)

		onPush?.({
			file: path,
			users: [ user ],
			srcLength: sourceCharacterCount,
			minLength: countHackmudCharacters(script),
			error: undefined
		})
	})

	if (!typeDeclarationPath)
		return

	/*
		this currently works because the generated type declaration effectively
		just connects things and doesn't actually read the scripts it's
		generating type declarations for

		if I ever change `generateTypings()` to actually read the scripts to
		grab their types, this will need to change
	*/

	generateTypings(sourceDirectory, resolvePath(sourceDirectory, typeDeclarationPath), hackmudDirectory)
	watcher.on(`add`, () => generateTypings(sourceDirectory, resolvePath(sourceDirectory, typeDeclarationPath), hackmudDirectory))
	watcher.on(`unlink`, () => generateTypings(sourceDirectory, resolvePath(sourceDirectory, typeDeclarationPath), hackmudDirectory))
}

export default watch
