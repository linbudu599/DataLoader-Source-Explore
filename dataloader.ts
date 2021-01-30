// A Function, which when given an Array of keys, returns a Promise of an Array
// of values or Errors.
export type BatchLoadFn<K, V> = (
  keys: Readonly<Array<K>>
) => Promise<Readonly<Array<V | Error>>>;

// Optionally turn off batching or caching or provide a cache key function or a
// custom cache instance.

// C: cache instance?
export type Options<K, V, C = K> = {
  batch?: boolean;
  maxBatchSize?: number;
  batchScheduleFn?: (callback: () => void) => void;
  cache?: boolean;
  cacheKeyFn?: (key: K) => C;
  cacheMap?: CacheMap<C, Promise<V>> | null;
};

// If a custom cache is provided, it must be of this type (a subset of ES6 Map).
export type CacheMap<K, V> = {
  get(key: K): V | void;
  set(key: K, value: V): any;
  delete(key: K): any;
  clear(): any;
};

// Private: Describes a batch of requests
type Batch<K, V> = {
  hasDispatched: boolean;
  keys: Array<K>;
  callbacks: Array<{
    resolve: (value: V) => void;
    reject: (error: Error) => void;
  }>;
  cacheHits?: Array<() => void>;
};

/**
 * A `DataLoader` creates a public API for loading data from a particular
 * data back-end with unique keys such as the `id` column of a SQL table or
 * document name in a MongoDB database, given a batch loading function.
 *
 * Each `DataLoader` instance contains a unique memoized cache. Use caution when
 * used in long-lived applications or those which serve many users with
 * different access permissions and consider creating a new instance per
 * web request.
 */
// 推荐为每一次请求使用一个新的实例
// 如果和Nest/Midway这样的框架协作, 需要将其作用域设置为请求级别
// 对于Apollo-Server + TypeGraphQL也可以用TypeDI实现
export default class DataLoader<K, V, C = K> {
  constructor(batchLoadFn: BatchLoadFn<K, V>, options?: Options<K, V, C>) {
    if (typeof batchLoadFn !== "function") {
      throw new TypeError(
        "DataLoader must be constructed with a function which accepts " +
          `Array<key> and returns Promise<Array<value>>, but got: ${batchLoadFn}.`
      );
    }

    this._batchLoadFn = batchLoadFn;
    // _batchScheduleFn: 负责批处理调度的函数
    // 如果没有传入, 则会使用enqueuePostPromiseJob, 这个函数会根据环境选择使用的函数
    // NodeJS下使用process.nextTick(实际上还会包裹在一个立刻resolve的Promise内)
    // 或者setImmediate
    // 浏览器下使用setTimeout
    // 详见源码讲解中的事件循环部分
    this._batchScheduleFn = getValidBatchScheduleFn(options);

    // 批处理上限, 比如同时load n条数据
    this._maxBatchSize = getValidMaxBatchSize(options);

    this._cacheKeyFn = getValidCacheKeyFn(options);
    this._cacheMap = getValidCacheMap(options);

    // 当前的批(不知道咋翻译好点)
    // 内部包括该batch是否已经派发, 注册的key与对应的回调, 以及缓存控制
    this._batch = null;
  }

  // Private
  _batchLoadFn: BatchLoadFn<K, V>;
  _batchScheduleFn: (fn: () => void) => void;

  _maxBatchSize: number;

  _cacheKeyFn: (key: K) => C;
  _cacheMap: CacheMap<C, Promise<V>> | null;

  _batch: Batch<K, V> | null;

  /**
   * Loads a key, returning a `Promise` for the value represented by that key.
   */
  load(key: K): Promise<V> {
    // load会被多次调用:
    // 首次调用 创建新的batch(绑定到当前DL实例)
    // 后续调用 将key与回调(resolve reject)挂载到batch的keys和callbacks上
    if (key === null || key === undefined) {
      throw new TypeError(
        "The loader.load() function must be called with a value, " +
          `but got: ${String(key)}.`
      );
    }

    // 批处理的批次?
    let batch = getCurrentBatch(this);

    let cacheMap = this._cacheMap;
    let cacheKey = this._cacheKeyFn(key);

    // If caching and there is a cache-hit, return cached Promise.
    if (cacheMap) {
      let cachedPromise = cacheMap.get(cacheKey);
      if (cachedPromise) {
        let cacheHits = batch.cacheHits || (batch.cacheHits = []);
        return new Promise((resolve) => {
          cacheHits.push(() => {
            resolve(cachedPromise as V | PromiseLike<V>);
          });
        });
      }
    }

    // Otherwise, produce a new Promise for this key, and enqueue it to be
    // dispatched along with the current batch.
    batch.keys.push(key);
    // 每次调用的key会被记录
    // console.log(key);
    const promise: Promise<V> = new Promise((resolve, reject) => {
      // 这就是为啥key和callback要对应的原因?
      batch.callbacks.push({ resolve, reject });
    });

    // If caching, cache this promise.
    if (cacheMap) {
      cacheMap.set(cacheKey, promise);
    }

    // 返回的promise会在下个事件循环resolve掉
    return promise;
  }

  /**
   * Loads multiple keys, promising an array of values:
   *
   *     let [ a, b ] = await myLoader.loadMany([ 'a', 'b' ]);
   *
   * This is similar to the more verbose:
   *
   *     let [ a, b ] = await Promise.all([
   *       myLoader.load('a'),
   *       myLoader.load('b')
   *     ]);
   *
   * However it is different in the case where any load fails. Where
   * Promise.all() would reject, loadMany() always resolves, however each result
   * is either a value or an Error instance.
   *
   *     let [ a, b, c ] = await myLoader.loadMany([ 'a', 'b', 'badkey' ]);
   *     // c instanceof Error
   *
   */
  loadMany(keys: Readonly<Array<K>>): Promise<Array<V | Error>> {
    // 批量调用load后使用Promise.all等待所有promise resolve掉
    if (!isArrayLike(keys)) {
      throw new TypeError(
        "The loader.loadMany() function must be called with Array<key> " +
          `but got: ${keys}.`
      );
    }
    // Support ArrayLike by using only minimal property access
    const loadPromises: Promise<any>[] = [];
    for (let i = 0; i < keys.length; i++) {
      loadPromises.push(this.load(keys[i]).catch((error) => error));
    }
    return Promise.all(loadPromises);
  }

  /**
   * Clears the value at `key` from the cache, if it exists. Returns itself for
   * method chaining.
   */
  clear(key: K): this {
    let cacheMap = this._cacheMap;
    if (cacheMap) {
      let cacheKey = this._cacheKeyFn(key);
      cacheMap.delete(cacheKey);
    }
    return this;
  }

  /**
   * Clears the entire cache. To be used when some event results in unknown
   * invalidations across this particular `DataLoader`. Returns itself for
   * method chaining.
   */
  clearAll(): this {
    let cacheMap = this._cacheMap;
    if (cacheMap) {
      cacheMap.clear();
    }
    return this;
  }

  /**
   * Adds the provided key and value to the cache. If the key already
   * exists, no change is made. Returns itself for method chaining.
   *
   * To prime the cache with an error at a key, provide an Error instance.
   */
  prime(key: K, value: V | Error): this {
    let cacheMap = this._cacheMap;
    if (cacheMap) {
      let cacheKey = this._cacheKeyFn(key);

      // Only add the key if it does not already exist.
      if (cacheMap.get(cacheKey) === undefined) {
        // Cache a rejected promise if the value is an Error, in order to match
        // the behavior of load(key).
        let promise;
        if (value instanceof Error) {
          promise = Promise.reject(value);
          // Since this is a case where an Error is intentionally being primed
          // for a given key, we want to disable unhandled promise rejection.
          promise.catch(() => {});
        } else {
          promise = Promise.resolve(value);
        }
        cacheMap.set(cacheKey, promise);
      }
    }
    return this;
  }
}

// Private: Enqueue a Job to be executed after all "PromiseJobs" Jobs.
//
// ES6 JavaScript uses the concepts Job and JobQueue to schedule work to occur
// after the current execution context has completed:
// http://www.ecma-international.org/ecma-262/6.0/#sec-jobs-and-job-queues
//
// Node.js uses the `process.nextTick` mechanism to implement the concept of a
// Job, maintaining a global FIFO JobQueue for all Jobs, which is flushed after
// the current call stack ends.
//
// When calling `then` on a Promise, it enqueues a Job on a specific
// "PromiseJobs" JobQueue which is flushed in Node as a single Job on the
// global JobQueue.
//
// DataLoader batches all loads which occur in a single frame of execution, but
// should include in the batch all loads which occur during the flushing of the
// "PromiseJobs" JobQueue after that same execution frame.
//
// In order to avoid the DataLoader dispatch Job occuring before "PromiseJobs",
// A Promise Job is created with the sole purpose of enqueuing a global Job,
// ensuring that it always occurs after "PromiseJobs" ends.
//
// Node.js's job queue is unique. Browsers do not have an equivalent mechanism
// for enqueuing a job to be performed after promise microtasks and before the
// next macrotask. For browser environments, a macrotask is used (via
// setImmediate or setTimeout) at a potential performance penalty.
let enqueuePostPromiseJob =
  // Node下使用process.nextTick
  // 浏览器使用宏任务
  typeof process === "object" && typeof process.nextTick === "function"
    ? function (fn) {
        if (!resolvedPromise) {
          resolvedPromise = Promise.resolve();
        }
        resolvedPromise.then(() => {
          process.nextTick(fn);
        });
      }
    : setImmediate || setTimeout;

// Private: cached resolved Promise instance
let resolvedPromise: Promise<void>;

// Private: Either returns the current batch, or creates and schedules a
// dispatch of a new batch for the given loader.

// 返回当前的batch >>> 怎么描述这玩意?
function getCurrentBatch<K, V>(loader: DataLoader<K, V, any>): Batch<K, V> {
  // If there is an existing batch which has not yet dispatched and is within
  // the limit of the batch size, then return it.
  let existingBatch = loader._batch;

  // 第一次load创建batch 后面则是使用已有的batch
  if (
    // 不为空
    existingBatch !== null &&
    // 未派发
    !existingBatch.hasDispatched &&
    // 未超过最大并发量
    // 超过的话会自动隔离成两次?
    existingBatch.keys.length < loader._maxBatchSize &&
    // TODO: 缓存相关
    (!existingBatch.cacheHits ||
      existingBatch.cacheHits.length < loader._maxBatchSize)
  ) {
    return existingBatch;
  }

  // Otherwise, create a new batch for this loader.
  let newBatch = { hasDispatched: false, keys: [], callbacks: [] };

  // Store it on the loader so it may be reused.
  loader._batch = newBatch;

  // Then schedule a task to dispatch this batch of requests.
  // 在创建一个新的batch时, 将批处理函数添加到任务队列中
  // 比如在NodeJS环境下, 即为
  // Promise.resolve().then(() => {
  //   process.nextTick(() => {
  //     dispatchBatch(loader, newBatch);
  //   });
  // });
  loader._batchScheduleFn(() => {
    dispatchBatch(loader, newBatch);
  });

  return newBatch;
}

function dispatchBatch<K, V>(
  loader: DataLoader<K, V, any>,
  batch: Batch<K, V>
) {
  // Mark this batch as having been dispatched.
  batch.hasDispatched = true;

  // If there's nothing to load, resolve any cache hits and return early.
  if (batch.keys.length === 0) {
    resolveCacheHits(batch);
    return;
  }

  // Call the provided batchLoadFn for this loader with the batch's keys and
  // with the loader as the `this` context.
  // 调用实例化时传入的批加载函数
  let batchPromise = loader._batchLoadFn(batch.keys);

  // Assert the expected response from batchLoadFn
  if (!batchPromise || typeof batchPromise.then !== "function") {
    return failedDispatch(
      loader,
      batch,
      new TypeError(
        "DataLoader must be constructed with a function which accepts " +
          "Array<key> and returns Promise<Array<value>>, but the function did " +
          `not return a Promise: ${String(batchPromise)}.`
      )
    );
  }

  // Await the resolution of the call to batchLoadFn.
  batchPromise
    .then((values) => {
      // Assert the expected resolution from batchLoadFn.
      if (!isArrayLike(values)) {
        throw new TypeError(
          "DataLoader must be constructed with a function which accepts " +
            "Array<key> and returns Promise<Array<value>>, but the function did " +
            `not return a Promise of an Array: ${String(values)}.`
        );
      }
      if (values.length !== batch.keys.length) {
        throw new TypeError(
          "DataLoader must be constructed with a function which accepts " +
            "Array<key> and returns Promise<Array<value>>, but the function did " +
            "not return a Promise of an Array of the same length as the Array " +
            "of keys." +
            `\n\nKeys:\n${String(batch.keys)}` +
            `\n\nValues:\n${String(values)}`
        );
      }

      // Resolve all cache hits in the same micro-task as freshly loaded values.
      resolveCacheHits(batch);

      // Step through values, resolving or rejecting each Promise in the batch.
      for (let i = 0; i < batch.callbacks.length; i++) {
        // 使用加载值来resolve掉load的promise
        let value = values[i];
        if (value instanceof Error) {
          batch.callbacks[i].reject(value);
        } else {
          console.log(`${i} ${JSON.stringify(value)}`);
          batch.callbacks[i].resolve(value);
        }
      }
    })
    .catch((error) => {
      failedDispatch(loader, batch, error);
    });
}

// Private: do not cache individual loads if the entire batch dispatch fails,
// but still reject each request so they do not hang.
function failedDispatch<K, V>(
  loader: DataLoader<K, V, any>,
  batch: Batch<K, V>,
  error: Error
) {
  // Cache hits are resolved, even though the batch failed.
  resolveCacheHits(batch);
  for (let i = 0; i < batch.keys.length; i++) {
    loader.clear(batch.keys[i]);
    batch.callbacks[i].reject(error);
  }
}

// Private: Resolves the Promises for any cache hits in this batch.
function resolveCacheHits(batch: Batch<any, any>) {
  if (batch.cacheHits) {
    for (let i = 0; i < batch.cacheHits.length; i++) {
      batch.cacheHits[i]();
    }
  }
}

// Private: given the DataLoader's options, produce a valid max batch size.
function getValidMaxBatchSize(options?: Options<any, any, any>): number {
  let shouldBatch = !options || options.batch !== false;
  if (!shouldBatch) {
    return 1;
  }
  let maxBatchSize = options && options.maxBatchSize;
  if (maxBatchSize === undefined) {
    return Infinity;
  }
  if (typeof maxBatchSize !== "number" || maxBatchSize < 1) {
    throw new TypeError(
      `maxBatchSize must be a positive number: ${maxBatchSize}`
    );
  }
  return maxBatchSize;
}

// Private
function getValidBatchScheduleFn(
  options?: Options<any, any, any>
): (fn: () => void) => void {
  let batchScheduleFn = options && options.batchScheduleFn;
  if (batchScheduleFn === undefined) {
    // 在promise后执行?
    return enqueuePostPromiseJob;
  }
  if (typeof batchScheduleFn !== "function") {
    throw new TypeError(
      `batchScheduleFn must be a function: ${batchScheduleFn}`
    );
  }
  return batchScheduleFn;
}

// Private: given the DataLoader's options, produce a cache key function.
function getValidCacheKeyFn<K, C>(options?: Options<K, any, C>): (K) => C {
  let cacheKeyFn = options && options.cacheKeyFn;
  if (cacheKeyFn === undefined) {
    return (key) => key;
  }
  if (typeof cacheKeyFn !== "function") {
    throw new TypeError(`cacheKeyFn must be a function: ${cacheKeyFn}`);
  }
  return cacheKeyFn;
}

// Private: given the DataLoader's options, produce a CacheMap to be used.
function getValidCacheMap<K, V, C>(
  options?: Options<K, V, C>
): CacheMap<C, Promise<V>> | null {
  let shouldCache = !options || options.cache !== false;
  if (!shouldCache) {
    return null;
  }
  let cacheMap = options && options.cacheMap;
  if (cacheMap === undefined) {
    return new Map();
  }
  if (cacheMap !== null) {
    let cacheFunctions = ["get", "set", "delete", "clear"];
    let missingFunctions = cacheFunctions.filter(
      (fnName) => cacheMap && typeof cacheMap[fnName] !== "function"
    );
    if (missingFunctions.length !== 0) {
      throw new TypeError(
        "Custom cacheMap missing methods: " + missingFunctions.join(", ")
      );
    }
  }
  return cacheMap;
}

// Private
function isArrayLike(x: any): boolean {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof x.length === "number" &&
    (x.length === 0 ||
      (x.length > 0 && Object.prototype.hasOwnProperty.call(x, x.length - 1)))
  );
}

module.exports = DataLoader;
