import findFiles from "@samual/lib/findFiles"
import { readFileSync, writeFileSync } from "fs"

const packageConfig = JSON.parse(readFileSync(`package.json`, { encoding: `utf-8` }))

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
	packageConfig.exports[name] = `${name}.js`

	if (name != `./index` && name.endsWith(`/index`))
		packageConfig.exports[name.slice(0, -6)] = packageConfig.exports[name]
}

writeFileSync(`dist/package.json`, JSON.stringify(packageConfig, undefined, `\t`))
