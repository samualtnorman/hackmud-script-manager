export interface Info {
	file: string
	users: string[]
	srcLength: number
	minLength: number
	error: Error | null
}

export const supportedExtensions = [ ".js", ".ts" ]

// TODO `clean()` function that delete all scripts in hackmud directory #70
// TODO optional argument (defaults to false) for `clean()` that makes it only remove scripts without a source file #70

export * from "./push"
export * from "./watch"
export * from "./pull"
export * from "./syncMacros"
export * from "./test"
export * from "./generateTypings"
export * from "./processScript"
