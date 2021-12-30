import fs from "fs"
import { basename as getBaseName, extname as getFileExtension, resolve as resolvePath } from "path"

const { readdir: readDirectory, writeFile } = fs.promises

export async function generateTypings(sourceDirectory: string, target: string, hackmudPath?: string) {
	const users = new Set<string>()

	if (hackmudPath) {
		for (const dirent of await readDirectory(hackmudPath, { withFileTypes: true })) {
			if (dirent.isFile() && getFileExtension(dirent.name) == `.key`)
				users.add(getBaseName(dirent.name, `.key`))
		}
	}

	const wildScripts: string[] = []
	const wildAnyScripts: string[] = []
	const allScripts: Record<string, string[]> = {}
	const allAnyScripts: Record<string, string[]> = {}

	await Promise.all((await readDirectory(sourceDirectory, { withFileTypes: true })).map(async dirent => {
		if (dirent.isFile()) {
			if (getFileExtension(dirent.name) == `.ts`)
				wildScripts.push(getBaseName(dirent.name, `.ts`))
			else if (getFileExtension(dirent.name) == `.js`)
				wildAnyScripts.push(getBaseName(dirent.name, `.js`))
		} else if (dirent.isDirectory()) {
			const scripts: string[] = []
			const anyScripts: string[] = []

			allScripts[dirent.name] = scripts
			allAnyScripts[dirent.name] = anyScripts
			users.add(dirent.name)

			for (const file of await readDirectory(resolvePath(sourceDirectory, dirent.name), { withFileTypes: true })) {
				if (file.isFile()) {
					if (getFileExtension(file.name) == `.ts`)
						scripts.push(getBaseName(file.name, `.ts`))
					else if (getFileExtension(file.name) == `.js`)
						anyScripts.push(getBaseName(file.name, `.js`))
				}
			}
		}
	}))

	let o = ``

	for (const script of wildScripts)
		o += `import { script as $${script}$ } from "./src/${script}"\n`

	o += `\n`

	for (const user in allScripts) {
		const scripts = allScripts[user]!

		for (const script of scripts)
			o += `import { script as $${user}$${script}$ } from "./src/${user}/${script}"\n`
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
		o += `\t${script}: Subscript<typeof $${script}$>\n`

	for (const script of wildAnyScripts)
		o += `\t${script}: (...args: any) => any\n`

	o += `}\n\ndeclare global {\n\tinterface PlayerFullsec {`

	let lastWasMultiLine = true

	for (const user of users) {
		const scripts = allScripts[user]
		const anyScripts = allAnyScripts[user]

		if ((scripts && scripts.length) || (anyScripts && anyScripts.length)) {
			lastWasMultiLine = true
			o += `\n\t\t${user}: WildFullsec & {\n`

			if (scripts) {
				for (const script of scripts)
					o += `\t\t\t${script}: Subscript<typeof $${user}$${script}$>\n`
			}

			if (anyScripts) {
				for (const script of anyScripts)
					o += `\t\t\t${script}: (...args: any) => any\n`
			}

			o += `\t\t}`
		} else {
			if (lastWasMultiLine) {
				o += `\n`
				lastWasMultiLine = false
			}

			o += `\t\t${user}: WildFullsec`
		}

		o += `\n`
	}

	o += `\t}\n}\n`
	await writeFile(target, o)
}

export default generateTypings
