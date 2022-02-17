import { NodePath } from "@babel/traverse"
import t, { Identifier, Program } from "@babel/types"
import { ensure } from "@samual/lib/assert"

export function getReferencePathsToGlobal(name: string, program: NodePath<Program>) {
	const [ variableDeclaration ] = program.unshiftContainer(
		`body`,
		t.variableDeclaration(
			`let`,
			[ t.variableDeclarator(t.identifier(name)) ]
		)
	)

	program.scope.crawl()

	const binding = ensure(program.scope.getBinding(name))

	variableDeclaration.remove()

	return binding.referencePaths as NodePath<Identifier>[]
}

export function includesIllegalString(toCheck: string) {
	return toCheck.includes(`SC$`) || toCheck.includes(`DB$`) || toCheck.includes(`__D_S`) || toCheck.includes(`__FMCL_`) || toCheck.includes(`__G_`)
}

export function replaceUnsafeStrings(uniqueID: string, toReplace: string) {
	return toReplace
		.replace(/SC\$/g, `$${uniqueID}$\\$SC_DOLLAR$`)
		.replace(/DB\$/g, `$${uniqueID}$\\$DB_DOLLAR$`)
		.replace(/__D_S/g, `$${uniqueID}$\\$D$`)
		.replace(/__FMCL_/g, `$${uniqueID}$\\$FMCL$`)
		.replace(/__G_/g, `$${uniqueID}$\\$G$`)
		.replace(/\/\//g, `$${uniqueID}$SLASH_SLASH$`)
		// eslint-disable-next-line unicorn/no-unsafe-regex
		.replace(/#[0-4fhmln]?s(?:\.[_a-z][\d_a-z]{0,24}){2}\(/g, `$${uniqueID}$NOT_A_SUBSCRIPT$$$&$`)
		.replace(/#db\.(?<methodName>[irfu]|u1|us|ObjectId)\(/g, `$${uniqueID}$NOT_A_DB_CALL$$$1$`)
		.replace(/#D\(/g, `$${uniqueID}$NOT_A_DEBUG_CALL$`)
		.replace(/#FMCL/g, `$${uniqueID}$NOT_FMCL$`)
		.replace(/#G/g, `$${uniqueID}$NOT_G$`)
}
