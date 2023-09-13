declare const HERE: string

declare module "@babel/plugin-*" {
	const value: { default: (...arguments_: any[]) => any }

	export default value
}
