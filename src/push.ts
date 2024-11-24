import type { LaxPartial } from "@samual/lib"
import { AutoMap } from "@samual/lib/AutoMap"
import { assert, ensure } from "@samual/lib/assert"
import { countHackmudCharacters } from "@samual/lib/countHackmudCharacters"
import { readDirectoryWithStats } from "@samual/lib/readDirectoryWithStats"
import { writeFilePersistent } from "@samual/lib/writeFilePersistent"
import { readFile } from "fs/promises"
import { basename as getBaseName, resolve as resolvePath } from "path"
import type { Info } from "."
import { processScript } from "./processScript"

export type PushOptions = LaxPartial<{
	/** whether to do the minify step (defaults to `true`) */ minify: boolean
	/** whether to mangle function and class names (defaults to `false`) */ mangleNames: boolean

	/** array of scripts in the format `foo.bar`
	  *
	  * also accepts wild card (`*`) e.g. `*.bar` or `foo.*`
	  *
	  * pushes everything by default (`*.*`) */
	scripts: string[]

	/** callback called on script push */ onPush: (info: Info) => void

	/** when set to `true` forces use of quine cheats
	  *
	  * when set to `false` forces quine cheats not to be used
	  *
	  * when left unset or set to `undefined`, automatically uses or doesn't use quine cheats based on character count
	  */
	forceQuineCheats: boolean
}>

export class MissingSourceFolderError extends Error {}
Object.defineProperty(MissingSourceFolderError.prototype, `name`, { value: `MissingSourceFolderError` })

export class MissingHackmudFolderError extends Error {}
Object.defineProperty(MissingHackmudFolderError.prototype, `name`, { value: `MissingHackmudFolderError` })

export class NoUsersError extends Error {}
Object.defineProperty(NoUsersError.prototype, `name`, { value: `NoUsersError` })

export class NoScriptsError extends Error {}
Object.defineProperty(NoScriptsError.prototype, `name`, { value: `NoScriptsError` })

/** Push scripts from a source directory to the hackmud directory.
  *
  * Pushes files directly in the source folder to all users
  * @param sourcePath directory containing source code
  * @param hackmudPath directory created by hackmud containing user data including scripts
  * @param options {@link PushOptions details}
  * @returns array of info on pushed scripts */
export async function push(
	sourcePath: string,
	hackmudPath: string,
	{ scripts = [ `*.*` ], onPush = () => {}, minify = true, mangleNames = false, forceQuineCheats }: PushOptions = {}
): Promise<MissingSourceFolderError | MissingHackmudFolderError | NoUsersError | NoScriptsError | Info[]> {
	const [ sourceFolder, hackmudFolder ] = await Promise.all([
		readDirectoryWithStats(sourcePath).catch(error => {
			if (error && (error as NodeJS.ErrnoException).code == "ENOENT")
				return new MissingSourceFolderError(`There is no folder at ${sourcePath}`)

			throw error
		}),
		readDirectoryWithStats(hackmudPath).catch(error => {
			if (error && (error as NodeJS.ErrnoException).code == "ENOENT")
				return new MissingHackmudFolderError(`There is no folder at ${hackmudPath}`)

			throw error
		})
	])

	if (sourceFolder instanceof Error)
		return sourceFolder

	if (hackmudFolder instanceof Error)
		return hackmudFolder

	const sourceFolderFolders = sourceFolder.filter(({ stats }) => stats.isDirectory())

	const allUsers = new Set([
		...scripts.map(scriptName => ensure(scriptName.split(`.`)[0], HERE)).filter(name => name != `*`),
		...sourceFolderFolders.map(({ name }) => name),
		...hackmudFolder.filter(({ stats }) => stats.isDirectory()).map(({ name }) => name),
		...hackmudFolder
			.filter(({ stats, name }) => stats.isFile() && name.endsWith(`.key`)).map(({ name }) => name.slice(0, -4))
	])

	if (!allUsers.size) {
		return new NoUsersError(
			`Could not find any users. Either provide the names of your users or log into a user in hackmud`
		)
	}

	const usersToScriptsToPush =
		new AutoMap((_user: string) => new Map</* script name */ string, /* script path */ string>)

	// const usersToScriptNames = new Cache((_user: string) => new Set)
	// const pushEverything_ = scripts.includes(`*.*`)
	const scriptNamesToUsers = new AutoMap((_scriptName: string) => new Set<string>)

	for (const script of scripts) {
		const [ user, scriptName ] = script.split(`.`)

		assert(user, HERE)
		assert(scriptName, HERE)
		// usersToScriptNames.get(user).add(scriptName)

		if (user == `*`)
			scriptNamesToUsers.set(scriptName, allUsers)
		else
			scriptNamesToUsers.get(scriptName).add(user)
	}

	const sourceFolderFiles = sourceFolder.filter(({ stats }) => stats.isFile())
	const wildScriptUsers_ = scriptNamesToUsers.get(`*`)

	scriptNamesToUsers.delete(`*`)

	for (const { name, path } of [
		...sourceFolderFiles.filter(({ name }) => name.endsWith(`.js`)),
		...sourceFolderFiles.filter(({ name }) => name.endsWith(`.ts`))
	]) {
		const scriptName = name.slice(0, -3)

		for (const user of [ ...wildScriptUsers_!, ...scriptNamesToUsers.get(scriptName) ])
			usersToScriptsToPush.get(user).set(scriptName, path)
	}

	await Promise.all(sourceFolderFolders.map(async ({ name: user, path }) => {
		const files = (await readDirectoryWithStats(path)).filter(({ stats }) => stats.isFile())

		const scriptFiles =
			[ ...files.filter(({ name }) => name.endsWith(`.js`)), ...files.filter(({ name }) => name.endsWith(`.ts`)) ]

		for (const { name, path } of scriptFiles) {
			const scriptName = name.slice(0, -3)

			if ([ ...wildScriptUsers_!, ...scriptNamesToUsers.get(scriptName) ].includes(user))
				usersToScriptsToPush.get(user).set(scriptName, path)
		}
	}))

	for (const [ scriptName, users ] of scriptNamesToUsers) {
		for (const user of users) {
			if (!usersToScriptsToPush.get(user).has(scriptName))
				return new NoScriptsError(`Could not find script ${user}.${scriptName} to push`)
		}
	}

	const pathsToUsers = new AutoMap((_path: string) => new Set<string>)

	for (const [ user, scriptsToPush ] of usersToScriptsToPush) {
		for (const path of scriptsToPush.values())
			pathsToUsers.get(path).add(user)
	}

	const allInfo: Info[] = []
	const sourcePathResolved = resolvePath(sourcePath)

	await Promise.all([ ...pathsToUsers ].map(async ([ path, [ ...users ] ]) => {
		const scriptName = getBaseName(path.slice(0, -3))

		const uniqueId = Math.floor(Math.random() * (2 ** 52)).toString(36).padStart(11, `0`)

		const { script: minifiedCode, warnings } = await processScript(await readFile(path, { encoding: `utf8` }), {
			minify,
			scriptUser: true,
			scriptName,
			uniqueId,
			filePath: path,
			mangleNames,
			forceQuineCheats,
			rootFolderPath: sourcePathResolved
		})

		const info: Info = { path, users, characterCount: countHackmudCharacters(minifiedCode), error: undefined, warnings }

		await Promise.all(users.map(user => writeFilePersistent(
			resolvePath(hackmudPath, user, `scripts/${scriptName}.js`),
			minifiedCode.replace(new RegExp(`\\$${uniqueId}\\$SCRIPT_USER\\$`, `g`), user)
				.replace(new RegExp(`\\$${uniqueId}\\$FULL_SCRIPT_NAME\\$`, `g`), `${user}.${scriptName}`)
		)))

		allInfo.push(info)
		onPush(info)
	}))

	return allInfo
}
