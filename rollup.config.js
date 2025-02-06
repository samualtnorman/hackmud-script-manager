#!node_modules/.bin/rollup --config
import t from "@babel/types"
import { createId as cuid2 } from "@paralleldrive/cuid2"
import { assert } from "@samual/lib/assert"
import { rollupConfig } from "@samual/rollup-config"

const isModuleBroken = (/** @type {string} */ name) =>
	name == "@babel/traverse" || name == "@babel/generator" || name.startsWith("@babel/plugin-")

export default rollupConfig({
	babelOptions: {
		plugins: [
			{
				name: "babel-has-broken-exports",
				visitor: {
					ImportDefaultSpecifier(path) {
						const importDeclarationPath = path.parentPath

						assert(importDeclarationPath.isImportDeclaration())

						if (!isModuleBroken(importDeclarationPath.node.source.value))
							return

						const specifierName = path.node.local.name
						const specifierNewName = cuid2()

						path.node.local.name = specifierNewName

						importDeclarationPath.insertAfter(t.variableDeclaration("const", [
							t.variableDeclarator(
								t.identifier(specifierName),
								t.memberExpression(t.identifier(specifierNewName), t.identifier("default"))
							)
						]))
					},
					CallExpression(path) {
						if (path.node.callee.type != "Import" || ((path.node.arguments[0]?.type != "StringLiteral" ||
							!isModuleBroken(path.node.arguments[0].value)
						) && (path.node.arguments[0]?.type != "TemplateLiteral" ||
							!path.node.arguments[0].quasis[0] ||
							!isModuleBroken(path.node.arguments[0].quasis[0].value.raw)
						)))
							return

						path.replaceWith(t.callExpression(
							t.memberExpression(
								path.node,
								t.identifier("then")
							),
							[
								t.arrowFunctionExpression(
									[
										t.identifier("module")
									],
									t.memberExpression(
										t.identifier("module"),
										t.identifier("default")
									)
								)
							]
						))

						path.skip()
					}
				}
			}
		]
	}
})
