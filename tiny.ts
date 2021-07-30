export type BatchLoader<K, V> = (
  keys: Readonly<Array<K>>
) => Promise<Readonly<Array<V | Error>>>;

export type Task<K, V> = {
  key: K;
  resolve: (val: V) => void;
  reject: (reason?: unknown) => void;
};

export type Queue<K, V> = {
  tasks: Array<Task<K, V>>;
  cacheHits: Array<() => void>;
};

export default class TinyDataLoader<K, V> {
  readonly _batchLoader: BatchLoader<K, V>;

  _taskQueue: Queue<K, V>;
  _cacheMap: Map<K, Promise<V>> | null;

  constructor(batchLoader: BatchLoader<K, V>) {
    this._batchLoader = batchLoader;
    this._taskQueue = {
      tasks: [],
      cacheHits: [],
    };
    this._cacheMap = new Map();
  }

  load(key: K): Promise<V> {
    const currentQueue = this._taskQueue;
    let cacheMap = this._cacheMap;

    const shouldDispatch = currentQueue.tasks.length === 0;

    if (shouldDispatch) {
      resolveCacheHits(currentQueue);
      enqueuePostPromiseJob(() => {
        executeTaskQueue(this);
      });
    }

    if (cacheMap) {
      // 可以用upsert代替...
      let cachedPromise = cacheMap.get(key);

      if (cachedPromise) {
        let cacheHits =
          this._taskQueue.cacheHits || (this._taskQueue.cacheHits = []);

        // 如果这个key对应的函数已经被缓存了
        return new Promise((resolve) => {
          cacheHits.push(() => {
            resolve(cachedPromise as V | PromiseLike<V>);
          });
        });
      }
    }

    const promise = new Promise<V>((resolve, reject) => {
      currentQueue.tasks.push({ key, resolve, reject });
    });

    if (cacheMap) {
      cacheMap.set(key, promise);
    }

    return promise;
  }

  loadMany(keys: Readonly<Array<K>>): Promise<Array<V | Error>> {
    return Promise.all(keys.map((key) => this.load(key)));
  }
}

let resolvedPromise: Promise<void>;

function resolveCacheHits(queue: Queue<unknown, any>) {
  for (const cacheHit of queue.cacheHits) {
    cacheHit();
  }
}

function enqueuePostPromiseJob(fn: () => void): void {
  if (!resolvedPromise) {
    resolvedPromise = Promise.resolve();
  }

  resolvedPromise.then(() => process.nextTick(fn));
}

export function executeTaskQueue<K, V>(loader: TinyDataLoader<K, V>) {
  // 保存后清空
  const queue = loader._taskQueue.tasks;
  loader._taskQueue.tasks = [];

  // 这里已经拿到了所有key
  const keys = queue.map(({ key }) => key);
  const batchLoader = loader._batchLoader;

  const batchPromise = batchLoader(keys);

  batchPromise.then((values) => {
    resolveCacheHits(loader._taskQueue);

    queue.forEach(({ resolve, reject }, index) => {
      const value = values[index];
      value instanceof Error ? reject(value) : resolve(value);
    });
  });
}
