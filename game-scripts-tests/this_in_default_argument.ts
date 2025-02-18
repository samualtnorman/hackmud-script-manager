export default ({ expect }: typeof import('vitest')) => {
	class Foo {
		declare foo: number

		constructor() {
			this.foo = 1
		}

		bar() {
			return 2
		}

		baz(a = this.foo, b = this.bar()) {
			return a + b
		}
	}

	const obj = {
		foo: 1,
		bar() {
			return 2
		},
		baz(a = this.foo, b = this.bar()) {
			return a + b
		}
	}

	const foo = (new Foo)

	expect(foo.baz(3, 4)).toBe(7) // Is this the real life?
	expect(foo.baz()).toBe(3) // Is this just fantasy?

	expect(obj.baz(3, 4)).toBe(7) // Caught in a landslide
	expect(obj.baz()).toBe(3) // No escape from reality
}
