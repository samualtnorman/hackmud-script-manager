export default ({ expect }: typeof import('vitest')) => {
    const test = {
        [0]: 'test[0]',
        foo: [
            function () {
                // @ts-ignore
                return this[0]
            }
        ],
        bar() {
            return this
        }
    };

    expect(test.foo[0]!()).toBe(test.foo[0])
    expect(test.bar()).toBe(test)
}
