export type BatchLoader<K, V> = (
  keys: Readonly<Array<K>>
) => Promise<Readonly<Array<V | Error>>>;

export type Task<K, V> = {
  key: K;
  resolve: (val: V) => void;
  reject: (reason?: unknown) => void;
};

export type Queue<K, V> = Array<Task<K, V>>;

export default class TinyDataLoader<K, V, C> {
  readonly _batchLoader: BatchLoader<K, V>;

  _taskQueue: Queue<K, V>;

  constructor(batchLoader: BatchLoader<K, V>) {
    this._batchLoader = batchLoader;
    this._taskQueue = [];
  }

  load(key: K): Promise<V> {
    const currentQueue = this._taskQueue;

    const shouldDispatch = currentQueue.length === 0;

    if (shouldDispatch) {
      enqueuePostPromiseJob(() => {
        executeTaskQueue(this);
      });
    }

    const promise = new Promise<V>((resolve, reject) => {
      currentQueue.push({ key, resolve, reject });
    });

    return promise;
  }

  loadMany(keys: Readonly<Array<K>>): Promise<Array<V | Error>> {
    return Promise.all(keys.map((key) => this.load(key)));
  }
}

let resolvedPromise: Promise<void>;

function enqueuePostPromiseJob(fn: () => void): void {
  if (!resolvedPromise) {
    resolvedPromise = Promise.resolve();
  }

  resolvedPromise.then(() => process.nextTick(fn));
}

export function executeTaskQueue<K, V>(loader: TinyDataLoader<K, V, any>) {
  // 保存后清空
  const queue = loader._taskQueue;
  loader._taskQueue = [];

  // 这里已经拿到了所有key
  const keys = queue.map(({ key }) => key);
  const batchLoader = loader._batchLoader;

  const batchPromise = batchLoader(keys);

  batchPromise.then((values) => {
    queue.forEach(({ resolve, reject }, index) => {
      const value = values[index];
      value instanceof Error ? reject(value) : resolve(value);
    });
  });
}
