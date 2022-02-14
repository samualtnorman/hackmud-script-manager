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

export function replaceIllegalStrings(uniqueID: string, toReplace: string) {
	return toReplace
		.replace(/SC\$/g, `$${uniqueID}$\\0$SC_DOLLAR$`)
		.replace(/DB\$/g, `$${uniqueID}$\\0$DB_DOLLAR$`)
		.replace(/__D_S/g, `$${uniqueID}$\\0$D$`)
		.replace(/__FMCL_/g, `$${uniqueID}$\\0$FMCL$`)
		.replace(/__G_/g, `$${uniqueID}$\\0$G$`)
}
