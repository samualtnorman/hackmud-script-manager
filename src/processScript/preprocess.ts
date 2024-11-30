import babelGenerator from "@babel/generator"
import { parse } from "@babel/parser"
import type { NodePath } from "@babel/traverse"
import babelTraverse from "@babel/traverse"
import type { Program } from "@babel/types"
import t from "@babel/types"
import type { LaxPartial } from "@samual/lib"
import { assert, ensure } from "@samual/lib/assert"
import { spliceString } from "@samual/lib/spliceString"
import { tokenizer as tokenise, tokTypes as TokenTypes } from "acorn"
import { resolve as resolveModule } from "import-meta-resolve"
import { validDBMethods } from "../constants"

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { default: traverse } = babelTraverse as any as typeof import("@babel/traverse")
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { default: generate } = babelGenerator as any as typeof import("@babel/generator")

const SUBSCRIPT_PREFIXES = [ `s`, `fs`, `4s`, `hs`, `3s`, `ms`, `2s`, `ls`, `1s`, `ns`, `0s` ]
const PREPROCESSOR_NAMES = [ ...SUBSCRIPT_PREFIXES, `D`, `G`, `FMCL`, `db` ]

export type PreprocessOptions = LaxPartial<{ /** 11 a-z 0-9 characters */ uniqueId: string }>

/** @param code source code for preprocessing
  * @param options {@link PreprocessOptions details} */
export async function preprocess(code: string, { uniqueId = `00000000000` }: PreprocessOptions = {})
: Promise<{ code: string }> {
	assert(/^\w{11}$/.test(uniqueId), HERE)

	const sourceCode = code
	const tokens = [ ...tokenise(code, { ecmaVersion: `latest` }) ]

	const needExportDefault =
		ensure(tokens[0], HERE).type == TokenTypes._function && ensure(tokens[1], HERE).type == TokenTypes.parenL

	const maybePrivatePrefix = `$${uniqueId}$MAYBE_PRIVATE$`

	for (const token of [ ...tokens ].reverse()) {
		assert(`value` in token, HERE)

		if (token.type == TokenTypes.privateId) {
			assert(typeof token.value == `string`, HERE)

			if (PREPROCESSOR_NAMES.includes(token.value))
				code = spliceString(code, maybePrivatePrefix + token.value, token.start, token.end - token.start)
		}
	}

	if (needExportDefault)
		code = `export default ${code}`

	let program!: NodePath<Program>

	traverse(parse(code, {
		plugins: [
			`typescript`,
			[ `decorators`, { decoratorsBeforeExport: true } ],
			`doExpressions`,
			`functionBind`,
			`functionSent`,
			`partialApplication`,
			[ `pipelineOperator`, { proposal: `hack`, topicToken: `%` } ],
			`throwExpressions`,
			[ `recordAndTuple`, { syntaxType: `hash` } ],
			`classProperties`,
			`classPrivateProperties`,
			`classPrivateMethods`,
			`logicalAssignment`,
			`numericSeparator`,
			`nullishCoalescingOperator`,
			`optionalChaining`,
			`optionalCatchBinding`,
			`objectRestSpread`
		],
		sourceType: `module`
	}), {
		Program(path) {
			program = path
		},
		Identifier(path) {
			if (!path.node.name.startsWith(maybePrivatePrefix))
				return

			const name = path.node.name.slice(maybePrivatePrefix.length)

			if (path.parent.type == `ClassProperty` && path.parent.key == path.node) {
				path.parentPath.replaceWith(t.classPrivateProperty(
					t.privateName(t.identifier(name)),
					path.parent.value,
					path.parent.decorators,
					path.parent.static
				))
			} else if (path.parent.type == `MemberExpression`) {
				if (path.parent.property == path.node) {
					assert(!path.parent.computed, HERE)
					path.replaceWith(t.privateName(t.identifier(name)))
				} else {
					assert(path.parent.object == path.node, HERE)

					if (name == `db`) {
						if (path.parent.computed)
							throw Error(`Index notation cannot be used on #db, must be in the form of #db.<DB method name>`)

						if (path.parent.property.type != `Identifier`)
							throw Error(`Expected DB method name to be an Identifier, got ${path.parent.property.type} instead`)

						if (!validDBMethods.includes(path.parent.property.name))
							throw Error(`Invalid DB method #db.${path.parent.property.name}`)

						path.node.name = `$db`
					} else {
						assert(SUBSCRIPT_PREFIXES.includes(name), HERE)

						if (path.parent.computed)
							throw Error(`Index notation cannot be used for subscripts, must be in the form of #${name}.foo.bar`)

						if (path.parent.property.type != `Identifier`)
							throw Error(`Expected subscript user name to be Identifier but got ${path.parent.property.type} instead`)

						if (path.parentPath.parent.type != `MemberExpression`)
							throw Error(`Subscripts must be in the form of #${name}.foo.bar`)

						if (path.parentPath.parent.computed)
							throw Error(`Index notation cannot be used for subscripts, must be in the form of #${name}.foo.bar`)

						if (path.parentPath.parent.property.type != `Identifier`)
							throw Error(`Expected subscript subname to be Identifier but got ${path.parent.property.type} instead`)

						if (
							path.parentPath.parentPath?.parent.type == `CallExpression` &&
							path.parent.property.name == `scripts` &&
							path.parentPath.parent.property.name == `quine`
						)
							ensure(path.parentPath.parentPath.parentPath, HERE).replaceWith(t.stringLiteral(sourceCode))
						else
							path.node.name = `$${name}`
					}
				}
			} else if (path.parent.type == `BinaryExpression` && path.parent.left == path.node && path.parent.operator == `in`)
				path.replaceWith(t.privateName(t.identifier(name)))
			else if (path.parent.type == `ClassMethod` && path.parent.key == path.node) {
				assert(path.parent.kind != `constructor`, HERE)

				path.parentPath.replaceWith(t.classPrivateMethod(
					path.parent.kind,
					t.privateName(t.identifier(name)),
					path.parent.params,
					path.parent.body,
					path.parent.static
				))
			} else {
				if (name == `FMCL`)
					path.node.name = `$${uniqueId}$FMCL$`
				else if (name == `G`)
					path.node.name = `$${uniqueId}$GLOBAL$`
				else if (name == `D`)
					path.node.name = `$D`
				else if (name == `db`)
					throw Error(`Invalid #db syntax, must be in the form of #db.<DB method name>`)
				else {
					assert(SUBSCRIPT_PREFIXES.includes(name), `${HERE} ${name}`)

					throw Error(`Invalid subscript syntax, must be in the form of #${name}.foo.bar`)
				}
			}
		}
	})

	const needRecord = program.scope.hasGlobal(`Record`)
	const needTuple = program.scope.hasGlobal(`Tuple`)

	if (needRecord || needTuple) {
		program.node.body.unshift(t.importDeclaration(
			needRecord
				? (needTuple
					? [
						t.importSpecifier(t.identifier(`Record`), t.identifier(`Record`)),
						t.importSpecifier(t.identifier(`Tuple`), t.identifier(`Tuple`))
					]
					: [ t.importSpecifier(t.identifier(`Record`), t.identifier(`Record`)) ]
				)
				: [ t.importSpecifier(t.identifier(`Tuple`), t.identifier(`Tuple`)) ],
			t.stringLiteral(`@bloomberg/record-tuple-polyfill`)
		))
	}

	if (program.scope.hasGlobal(`Proxy`)) {
		program.node.body.unshift(t.importDeclaration([
			t.importDefaultSpecifier(t.identifier(`Proxy`))
		], t.stringLiteral(resolveModule(`proxy-polyfill/src/proxy.js`, import.meta.url).slice(7))))
	}

	if (program.node.body.length == 1 && program.node.body[0]!.type == `FunctionDeclaration`) {
		throw Error(`Scripts that only contain a single function declaration are no longer supported.\nPrefix the function declaration with \`export default\`.`)
	}

	return { code: generate(program.node).code }
}
