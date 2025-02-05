export default ({ expect }: typeof import('vitest')) => {
	const array = [
		function (this: any) {
			return this
		}
	]

	expect(array[0]!()).toBe(array)
}
