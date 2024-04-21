import type { NodePath } from "@babel/traverse"
import type { Identifier, Program } from "@babel/types"
import t from "@babel/types"
import { ensure } from "@samual/lib/assert"

export function getReferencePathsToGlobal(name: string, program: NodePath<Program>) {
	const [ variableDeclaration ] = program
		.unshiftContainer(`body`, t.variableDeclaration(`let`, [ t.variableDeclarator(t.identifier(name)) ]))

	program.scope.crawl()

	const binding = ensure(program.scope.getBinding(name), HERE)

	variableDeclaration.remove()

	return binding.referencePaths as NodePath<Identifier>[]
}

export const includesIllegalString = (toCheck: string) => toCheck.includes(`SC$`) || toCheck.includes(`DB$`) ||
	toCheck.includes(`__D_S`) || toCheck.includes(`__FMCL_`) || toCheck.includes(`__G_`)

export const replaceUnsafeStrings = (uniqueID: string, toReplace: string) => toReplace
	.replaceAll(`SC$`, `$${uniqueID}$\\$SC_DOLLAR$`)
	.replaceAll(`DB$`, `$${uniqueID}$\\$DB_DOLLAR$`)
	.replaceAll(`__D_S`, `$${uniqueID}$\\$D$`)
	.replaceAll(`__FMCL_`, `$${uniqueID}$\\$FMCL$`)
	.replaceAll(`__G_`, `$${uniqueID}$\\$G$`)
	.replaceAll(`//`, `$${uniqueID}$SLASH_SLASH$`)
	.replaceAll(/#[0-4fhmln]?s(?:\.[_a-z][\d_a-z]{0,24}){2}\(/g, `$${uniqueID}$NOT_A_SUBSCRIPT$$$&$`)
	.replaceAll(/#db\.(?<methodName>[irfu]|u1|us|ObjectId)\(/g, `$${uniqueID}$NOT_A_DB_CALL$$$1$`)
	.replaceAll(`#D(`, `$${uniqueID}$NOT_A_DEBUG_CALL$`)
	.replaceAll(`#FMCL`, `$${uniqueID}$NOT_FMCL$`)
	.replaceAll(`#G`, `$${uniqueID}$NOT_G$`)
