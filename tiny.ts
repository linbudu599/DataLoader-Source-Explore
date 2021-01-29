type BatchLoadFn<K, V> = (
  keys: Readonly<Array<K>>
) => Promise<Readonly<Array<V | Error>>>;

type Task<K, V> = {
  key: K;
  resolve: (val: V) => void;
  reject: (reason?: unknown) => void;
};

export default class TinyDataLoader<K, V, C> {
  readonly _batchLoadFn: BatchLoadFn<K, V>;

  _taskQueue: Task<K, V>[];

  constructor(batchLoadFn: BatchLoadFn<K, V>) {
    if (typeof batchLoadFn !== "function") {
      throw new TypeError("batchLoadFn must be a function !");
    }
    this._batchLoadFn = batchLoadFn; // 批量处理函数
    this._taskQueue = []; // 执行参数队列
  }

  load(key: K): Promise<V> {
    const promise = new Promise<V>((resolve, reject) => {
      // 初次建立, 需要创建
      const shouldDispatch = this._taskQueue.length === 0;

      this._taskQueue.push({ key, resolve, reject });

      shouldDispatch
        ? enqueuePostPromiseJob(() => executeTaskQueue(this))
        : executeTaskQueue(this);
    });

    return promise;
  }

  // 批量处理
  loadMany(keys: Readonly<Array<K>>): Promise<Array<V | Error>> {
    return Promise.all(keys.map((key) => this.load(key)));
  }
}

let resolvedPromise: Promise<void>;

// 启动队列开启Promise任务
function enqueuePostPromiseJob(fn: () => void) {
  if (!resolvedPromise) {
    resolvedPromise = Promise.resolve();
  }

  // 此 promise 将在此次 eventLoop 循环结束后执行
  resolvedPromise.then(() => process.nextTick(fn));
}

// 执行队列任务，并且将结果组装返回
function executeTaskQueue<K, V>(loader: TinyDataLoader<K, V, any>) {
  const queue = loader._taskQueue;
  loader._taskQueue = [];

  const keys = queue.map(({ key }) => key);
  const batchLoadFn = loader._batchLoadFn;
  const batchPromise = batchLoadFn(keys);

  batchPromise.then((values) => {
    queue.forEach(({ resolve, reject }, index) => {
      const value = values[index];
      value instanceof Error ? reject(value) : resolve(value);
    });
  });
}
