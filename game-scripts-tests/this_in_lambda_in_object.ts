export default ({ expect }: typeof import('vitest')) => {
	const myObject = {
		a: 0,
		b: function () {
			this.a++
			return this.a
		},
		c: function (value: number = this.a) {
			this.a = value + 1
		},
		d: function ({ value = this.a }: { value?: number }) {
			this.a = value + 1
		}
	}

	expect(myObject.a).toBe(0)
	myObject.b()
	expect(myObject.a).toBe(1)
	myObject.c()
	expect(myObject.a).toBe(2)
	myObject.d({})
	expect(myObject.a).toBe(3)
}
