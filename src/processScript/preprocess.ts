import babelGenerator from "@babel/generator"
import { parse } from "@babel/parser"
import type { NodePath } from "@babel/traverse"
import babelTraverse from "@babel/traverse"
import type { Program } from "@babel/types"
import t from "@babel/types"
import type { LaxPartial } from "@samual/lib"
import { assert } from "@samual/lib/assert"
import { spliceString } from "@samual/lib/spliceString"
import { resolve as resolveModule } from "import-meta-resolve"

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { default: traverse } = babelTraverse as any as typeof import("@babel/traverse")
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { default: generate } = babelGenerator as any as typeof import("@babel/generator")

export type PreprocessOptions = LaxPartial<{ /** 11 a-z 0-9 characters */ uniqueId: string }>

/** @param code source code for preprocessing
  * @param options {@link PreprocessOptions details} */
export async function preprocess(code: string, { uniqueId = `00000000000` }: PreprocessOptions = {})
: Promise<{ code: string }> {
	assert(/^\w{11}$/.test(uniqueId), HERE)

	const sourceCode = code
	let lengthBefore

	do {
		lengthBefore = code.length
		code = code.replace(/^\s+/, ``).replace(/^\/\/.*/, ``).replace(/^\/\*[\s\S]*?\*\//, ``)
	} while (code.length != lengthBefore)

	code = code.replace(/^function\s*\(/, `export default function (`)

	let file

	while (true) {
		let error

		try {
			file = parse(code, {
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
			})

			break
		} catch (error_) {
			assert(error_ instanceof SyntaxError, HERE)
			error = error_ as SyntaxError & { pos: number, code: string, reasonCode: string }
		}

		if (error.code != `BABEL_PARSER_SYNTAX_ERROR` || error.reasonCode != `PrivateInExpectedIn`) {
			console.log((/.+/.exec(code.slice(error.pos)))?.[0])

			throw error
		}

		const codeSlice = code.slice(error.pos)
		let match

		if ((match = /^#[0-4fhmln]s\.scripts\.quine\(\)/.exec(codeSlice)))
			code = spliceString(code, JSON.stringify(sourceCode), error.pos, match[0]!.length)
		else if ((match = /^#[0-4fhmln]?s\./.exec(codeSlice)))
			code = spliceString(code, `$`, error.pos, 1)
		else if ((match = /^#D[^\w$]/.exec(codeSlice)))
			code = spliceString(code, `$`, error.pos, 1)
		else if ((match = /^#FMCL/.exec(codeSlice)))
			code = spliceString(code, `$${uniqueId}$FMCL$`, error.pos, match[0]!.length)
		else if ((match = /^#G/.exec(codeSlice)))
			code = spliceString(code, `$${uniqueId}$GLOBAL$`, error.pos, match[0]!.length)
		else if ((match = /^#db\./.exec(codeSlice)))
			code = spliceString(code, `$`, error.pos, 1)
		else
			throw error
	}

	let program!: NodePath<Program>

	traverse(file, {
		Program(path) {
			program = path
			path.skip()
		}
	})

	const needRecord = program.scope.hasGlobal(`Record`)
	const needTuple = program.scope.hasGlobal(`Tuple`)

	if (needRecord || needTuple) {
		file.program.body.unshift(t.importDeclaration(
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
		file.program.body.unshift(t.importDeclaration([
			t.importDefaultSpecifier(t.identifier(`Proxy`))
		], t.stringLiteral(resolveModule(`proxy-polyfill/src/proxy.js`, import.meta.url).slice(7))))
	}

	if (program.node.body.length == 1 && program.node.body[0]!.type == `FunctionDeclaration`) {
		throw Error(`Scripts that only contain a single function declaration are no longer supported.\nPrefix the function declaration with \`export default\`.`)
	}

	return { code: generate(file).code }
}
