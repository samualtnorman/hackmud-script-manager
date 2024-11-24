export { supportedExtensions } from "./constants"
export { generateTypeDeclaration } from "./generateTypeDeclaration"
export { processScript } from "./processScript"
export { pull } from "./pull"
export { push } from "./push"
export { syncMacros } from "./syncMacros"
export { watch } from "./watch"

// TODO `clean()` function that delete all scripts in hackmud directory #70
// TODO optional argument (defaults to false) for `clean()` that makes it keep scripts with a source file #70

export type Info =
	{ path: string, users: string[], characterCount: number, error: Error | undefined, warnings: { message: string }[] }
