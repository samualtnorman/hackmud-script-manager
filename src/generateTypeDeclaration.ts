import fs from "fs"
import { basename as getBaseName, resolve as resolvePath } from "path"

const { readdir: readDirectory } = fs.promises

export async function generateTypeDeclaration(sourceDirectory: string, hackmudPath?: string) {
	const users = new Set<string>()

	if (hackmudPath) {
		for (const dirent of await readDirectory(hackmudPath, { withFileTypes: true })) {
			if (dirent.isFile() && dirent.name.endsWith(`.key`))
				users.add(getBaseName(dirent.name, `.key`))
		}
	}

	const wildScripts: string[] = []
	const wildAnyScripts: string[] = []
	const allScripts: Record<string, string[]> = {}
	const allAnyScripts: Record<string, string[]> = {}

	await Promise.all((await readDirectory(sourceDirectory, { withFileTypes: true })).map(async dirent => {
		if (dirent.isFile()) {
			if (dirent.name.endsWith(`.ts`)) {
				if (!dirent.name.endsWith(`.d.ts`))
					wildScripts.push(getBaseName(dirent.name, `.ts`))
			} else if (dirent.name.endsWith(`.js`))
				wildAnyScripts.push(getBaseName(dirent.name, `.js`))
		} else if (dirent.isDirectory()) {
			const scripts: string[] = []
			const anyScripts: string[] = []

			allScripts[dirent.name] = scripts
			allAnyScripts[dirent.name] = anyScripts
			users.add(dirent.name)

			for (const file of await readDirectory(resolvePath(sourceDirectory, dirent.name), { withFileTypes: true })) {
				if (file.isFile()) {
					if (file.name.endsWith(`.ts`)) {
						if (!dirent.name.endsWith(`.d.ts`))
							scripts.push(getBaseName(file.name, `.ts`))
					} else if (file.name.endsWith(`.js`))
						anyScripts.push(getBaseName(file.name, `.js`))
				}
			}
		}
	}))

	sourceDirectory = resolvePath(sourceDirectory)

	let o = ``

	for (const script of wildScripts)
		o += `import $${script}$ from "${sourceDirectory}/${script}"\n`

	o += `\n`

	for (const user in allScripts) {
		const scripts = allScripts[user]!

		for (const script of scripts)
			o += `import $${user}$${script}$ from "${sourceDirectory}/${user}/${script}"\n`
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
					o += `\t\t${script}: Subscript<typeof $${user}$${script}$>\n`
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

export default generateTypeDeclaration
