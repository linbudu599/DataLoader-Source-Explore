import TinyDataLoader from "./tiny";

// 由于Tiny版本移除了校验的相关逻辑、设置缓存、设置调度函数等能力
// 所以测试用例将只会关注其是否能实现

beforeAll(() => {
  // jest.useFakeTimers("legacy");
});

const asyncBatchLoader = jest.fn(
  (ids: readonly number[]): Promise<string[]> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(ids.map(transformer));
      });
    });
  }
);

const batchLoader = jest.fn((ids: readonly number[]): Promise<string[]> => {
  return new Promise((resolve) => {
    resolve(ids.map(transformer));
  });
});

const transformer = (id: number) => `Response for ${id}`;

describe("tmp", () => {
  it.only("should 1", async () => {
    const ins = new TinyDataLoader(batchLoader);
    expect(ins._taskQueue.tasks).toEqual([]);
    expect(ins._taskQueue.cacheHits).toEqual([]);

    expect(ins._batchLoader).toEqual(batchLoader);
    expect(ins._cacheMap?.size).toBe(0);

    // ins.load(1);
    // ins.load(2);
    // ins.load(3);
    // ins.load(4);
    // ins.load(5);

    // expect(ins._cacheMap?.size).toBe(5);
    // expect(ins._taskQueue.tasks.length).toBe(5);

    // ins.load(5);

    // expect(ins._cacheMap?.size).toBe(5);
    // expect(ins._taskQueue.cacheHits.length).toBe(1);
    // expect(ins._taskQueue.tasks.length).toBe(5);
  });
  it("should 2", async () => {
    const ins = new TinyDataLoader(batchLoader);

    // const promise1 = ins.load(1);
    // expect(promise1).toBeInstanceOf(Promise);
    // const value1 = await promise1;

    // expect(value1).toBe(transformer(1));
  });
});
