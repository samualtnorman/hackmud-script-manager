export default ({ expect }: typeof import ('vitest')) => {
    const i = 0;

    try {
        // @ts-ignore
        // noinspection JSConstantReassignment
        i = 1;
        expect.unreachable(`i was reassigned!`)
    } catch (e) {
        expect(e).instanceOf(TypeError)
    }

    expect(i).toBe(0)
}
