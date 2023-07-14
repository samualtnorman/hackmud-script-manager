#!node_modules/.bin/rollup --config
import * as t from "@babel/types"
import { babel } from "@rollup/plugin-babel"
import json from "@rollup/plugin-json"
import { nodeResolve } from "@rollup/plugin-node-resolve"
import terser from "@rollup/plugin-terser"
import MagicString from "magic-string"
import { cpus } from "os"
import { relative as getRelativeFilePath } from "path"
import { findFiles } from "./node_modules/@samual/lib/findFiles.js"
import packageConfig from "./package.json" assert { type: "json" }

const SourceFolder = "src"
const Minify = false

const externalDependencies = []

if ("dependencies" in packageConfig)
	externalDependencies.push(...Object.keys(packageConfig.dependencies))

if ("optionalDependencies" in packageConfig)
	externalDependencies.push(...Object.keys(packageConfig.optionalDependencies))

export default findFiles(SourceFolder).then(foundFiles => /** @type {import("rollup").RollupOptions} */ ({
	input: Object.fromEntries(
		foundFiles
			.filter(path => path.endsWith(".ts") && !path.endsWith(".d.ts"))
			.map(path => [ path.slice(SourceFolder.length + 1, -3), path ])
	),
	output: { dir: "dist", chunkFileNames: "[name]-.js", generatedCode: "es2015", interop: "auto", compact: Minify },
	plugins: [
		babel({
			babelHelpers: "bundled",
			extensions: [ ".ts" ],
			presets: [
				[ "@babel/preset-env", { targets: { node: "14" } } ],
				[ "@babel/preset-typescript", { allowDeclareFields: true } ]
			],
			plugins: [
				{
					name: "babel-plugin-here",
					visitor: {
						Program(path) {
							if (!path.scope.hasGlobal("HERE"))
								return

							const [ variableDeclarationPath ] = path.unshiftContainer(
								"body",
								t.variableDeclaration("let", [ t.variableDeclarator(t.identifier("HERE")) ])
							)

							path.scope.crawl()

							const filePath = getRelativeFilePath(".", this.file.opts.filename)

							for (const referencePath of path.scope.getBinding("HERE").referencePaths) {
								const line = referencePath.node.loc.start.line
								const column = referencePath.node.loc.start.column + 1

								if (referencePath.parent.type != "TemplateLiteral") {
									referencePath.replaceWith(t.stringLiteral(`${filePath}:${line}:${column}`))

									continue
								}

								const { parent, node } = referencePath
								const index = parent.expressions.indexOf(/** @type {any} */ (node))
								const quasi = parent.quasis[index].value.raw
								const nextQuasi = parent.quasis[index + 1].value.raw

								parent.expressions.splice(index, 1)
								delete parent.quasis[index].value.cooked
								parent.quasis[index].value.raw = `${quasi}${filePath}:${line}:${column}${nextQuasi}`
								parent.quasis[index].tail = parent.quasis[index + 1].tail
								parent.quasis.splice(index + 1, 1)
							}

							variableDeclarationPath.remove()
						}
					}
				}
			]
		}),
		nodeResolve({ extensions: [ ".ts" ] }),
		Minify && terser(/** @type {Parameters<typeof terser>[0] & { maxWorkers: number }} */ ({
			keep_classnames: true,
			keep_fnames: true,
			compress: { passes: Infinity },
			maxWorkers: Math.floor(cpus().length / 2)
		})),
		{
			name: "rollup-plugin-shebang",
			renderChunk(code, { fileName }) {
				if (!fileName.startsWith("bin/"))
					return undefined

				const magicString = new MagicString(code).prepend("#!/usr/bin/env node\n")

				return { code: magicString.toString(), map: magicString.generateMap({ hires: true }) }
			}
		},
		json()
	],
	external:
		source => externalDependencies.some(dependency => source == dependency || source.startsWith(`${dependency}/`)),
	preserveEntrySignatures: "allow-extension",
	strictDeprecations: true
}))
