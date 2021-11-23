import { NodePath } from "@babel/traverse"
import t, { Identifier, Program } from "@babel/types"
import { ensure } from "@samual/lib/assert"

export function getReferencePathsToGlobal(name: string, program: NodePath<Program>) {
	const [ variableDeclaration ] = program.unshiftContainer(
		"body",
		t.variableDeclaration(
			"let",
			[ t.variableDeclarator(t.identifier(name)) ]
		)
	)

	program.scope.crawl()

	const binding = ensure(program.scope.getBinding(name))

	variableDeclaration.remove()

	return binding.referencePaths as NodePath<Identifier>[]
}
