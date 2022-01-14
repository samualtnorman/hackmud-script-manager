import findFiles from "@samual/lib/findFiles"
import fs from "fs"

const { writeFile, readFile } = fs.promises;

(async () => {
	const packageConfig = JSON.parse(await readFile(`package.json`, { encoding: `utf-8` }))

	delete packageConfig.private
	delete packageConfig.scripts
	packageConfig.bin = {}

	for (let name of await findFiles(`dist`)) {
		name = `.${name.slice(4)}`

		if (name.startsWith(`./bin/`) && name.endsWith(`.js`)) {
			packageConfig.bin[name.slice(6, -3)] = name

			continue
		}

		if (!name.endsWith(`.d.ts`))
			continue

		name = name.slice(0, -5)

		const nameWithExtension = `${name}.js`

		packageConfig.exports[name] = nameWithExtension

		if (name != `./index` && name.endsWith(`/index`))
			packageConfig.exports[name.slice(0, -6)] = nameWithExtension
	}

	await writeFile(`dist/package.json`, JSON.stringify(packageConfig, undefined, `\t`))
})()
