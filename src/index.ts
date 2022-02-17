export { supportedExtensions } from "./constants.json"
export { generateTypings } from "./generateTypings"
export { processScript } from "./processScript"
export { pull } from "./pull"
export { push } from "./push"
export { syncMacros } from "./syncMacros"
export { watch } from "./watch"

// TODO `clean()` function that delete all scripts in hackmud directory #70
// TODO optional argument (defaults to false) for `clean()` that makes it keep scripts with a source file #70

export type Info = {
	file: string
	users: string[]
	minLength: number
	error: Error | undefined
}
