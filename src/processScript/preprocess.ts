import babelGenerator from "@babel/generator"
import { parse } from "@babel/parser"
import babelTraverse, { NodePath } from "@babel/traverse"
import t, { Program } from "@babel/types"
import { assert, spliceString } from "@samual/lib"

const { default: traverse } = babelTraverse as any as typeof import("@babel/traverse")
const { default: generate } = babelGenerator as any as typeof import("@babel/generator")

export type PreprocessOptions = {
	/** 11 a-z 0-9 characters */
	uniqueID: string
}

/**
 * @param code source code for preprocessing
 * @param options {@link PreprocessOptions details}
 */
export function preprocess(code: string, { uniqueID = `00000000000` }: Partial<PreprocessOptions> = {}) {
	assert(/^\w{11}$/.test(uniqueID))

	// TODO rename variables that trips this
	if (/(?:SC|DB)\$/.test(code))
		throw new Error(`SC$ and DB$ are protected and cannot appear in a script`)

	const sourceCode = code
	let lengthBefore

	do {
		lengthBefore = code.length

		code = code
			.replace(/^\s+/, ``)
			.replace(/^\/\/.*/, ``)
			.replace(/^\/\*[\s\S]*?\*\//, ``)
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
			assert(error_ instanceof SyntaxError)

			error = error_ as SyntaxError & {
				pos: number
				code: string
				reasonCode: string
			}
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
			code = spliceString(code, `$${uniqueID}$FMCL`, error.pos, match[0]!.length)
		else if ((match = /^#G/.exec(codeSlice)))
			code = spliceString(code, `$${uniqueID}$GLOBAL`, error.pos, match[0]!.length)
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
				) : [ t.importSpecifier(t.identifier(`Tuple`), t.identifier(`Tuple`)) ],
			t.stringLiteral(`@bloomberg/record-tuple-polyfill`)
		))
	}

	if (program.scope.hasGlobal(`Proxy`)) {
		file.program.body.unshift(t.importDeclaration([
			t.importDefaultSpecifier(t.identifier(`Proxy`))
		], t.stringLiteral(`proxy-polyfill/src/proxy.js`)))
	}

	if (program.node.body.length == 1 && program.node.body[0]!.type == `FunctionDeclaration`)
		return { code: `export default ${generate(file).code}` }

	return { code: generate(file).code }
}

export default preprocess
