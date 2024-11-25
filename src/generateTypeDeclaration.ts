import { readDirectoryWithStats } from "@samual/lib/readDirectoryWithStats"
import { basename as getBaseName, resolve as resolvePath } from "path"
import * as PathPosix from "path/posix"

export async function generateTypeDeclaration(sourceDirectory: string, hackmudPath?: string): Promise<string> {
	const users = new Set<string>()

	if (hackmudPath) {
		for (const { stats, name } of await readDirectoryWithStats(hackmudPath)) {
			if (stats.isFile() && name.endsWith(`.key`))
				users.add(getBaseName(name, `.key`))
		}
	}

	const wildScripts: string[] = []
	const wildAnyScripts: string[] = []
	const allScripts: Record<string, string[]> = {}
	const allAnyScripts: Record<string, string[]> = {}

	await Promise.all((await readDirectoryWithStats(sourceDirectory)).map(async ({ stats, name }) => {
		if (stats.isFile()) {
			if (name.endsWith(`.ts`)) {
				if (!name.endsWith(`.d.ts`))
					wildScripts.push(getBaseName(name, `.ts`))
			} else if (name.endsWith(`.js`))
				wildAnyScripts.push(getBaseName(name, `.js`))
		} else if (stats.isDirectory()) {
			const scripts: string[] = []
			const anyScripts: string[] = []

			allScripts[name] = scripts
			allAnyScripts[name] = anyScripts
			users.add(name)

			for (const child of await readDirectoryWithStats(resolvePath(sourceDirectory, name))) {
				if (child.stats.isFile()) {
					if (child.name.endsWith(`.ts`)) {
						if (!name.endsWith(`.d.ts`))
							scripts.push(getBaseName(child.name, `.ts`))
					} else if (child.name.endsWith(`.js`))
						anyScripts.push(getBaseName(child.name, `.js`))
				}
			}
		}
	}))

	sourceDirectory = PathPosix.resolve(sourceDirectory)

	let o = ``

	for (const script of wildScripts)
		o += `type $${script}$ = typeof import("${sourceDirectory}/${script}").default\n`

	o += `\n`

	for (const user in allScripts) {
		const scripts = allScripts[user]!

		for (const script of scripts)
			o += `type $${user}$${script}$ = typeof import("${sourceDirectory}/${user}/${script}").default\n`
	}

	// TODO detect security level and generate apropriate code

	// TODO accurate function signatures
	// I lose the generic-ness of my functions when I wrap them
	// regexing isn't enough and it looks like I'm going to need to parse the files in TypeScript to extract the signature

	o += `
type ArrayRemoveFirst<A> = A extends [ infer FirstItem, ...infer Rest ] ? Rest : never

type Subscript<T extends (...args: any) => any> =
	(...args: ArrayRemoveFirst<Parameters<T>>) => ReturnType<T> | ScriptFailure

type WildFullsec = Record<string, () => ScriptFailure> & {
`

	for (const script of wildScripts)
		o += `\t${script}: Subscript<$${script}$>\n`

	for (const script of wildAnyScripts)
		o += `\t${script}: (...args: any) => any\n`

	o += `}\n\ninterface PlayerFullsec {`

	let lastWasMultiLine = true

	for (const user of users) {
		const scripts = allScripts[user]
		const anyScripts = allAnyScripts[user]

		if ((scripts && scripts.length) || (anyScripts && anyScripts.length)) {
			lastWasMultiLine = true
			o += `\n\t${user}: WildFullsec & {\n`

			if (scripts) {
				for (const script of scripts)
					o += `\t\t${script}: Subscript<$${user}$${script}$>\n`
			}

			if (anyScripts) {
				for (const script of anyScripts)
					o += `\t\t${script}: (...args: any) => any\n`
			}

			o += `\t}`
		} else {
			if (lastWasMultiLine) {
				o += `\n`
				lastWasMultiLine = false
			}

			o += `\t${user}: WildFullsec`
		}

		o += `\n`
	}

	o += `}\n`

	return o
}
