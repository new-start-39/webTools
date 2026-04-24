/**
 * 通用 Worker 池管理类
 * 支持多 Worker 并行、任务队列、进度回调、超时取消
 */
class WorkerPool {
  /**
   * @param {string} workerScript - Worker 脚本路径
   * @param {Object} options - 配置项
   * @param {number} [options.poolSize=navigator.hardwareConcurrency||4] - Worker 最大并发数
   * @param {number} [options.idleTimeout=30000] - Worker 空闲超时(ms)，0 表示不自动回收
   * @param {number} [options.taskTimeout=0] - 任务默认超时(ms)，0 表示不超时
   */
  constructor(workerScript, options = {}) {
    this.workerScript = workerScript;
    this.poolSize = options.poolSize || (navigator.hardwareConcurrency || 4);
    this.idleTimeout = options.idleTimeout ?? 30000;
    this.taskTimeout = options.taskTimeout || 0;

    /** @type {Map<number, WorkerInstance>} */
    this.workers = new Map();
    this.workerIdCounter = 0;

    /** @type {Array<TaskItem>} */
    this.taskQueue = [];

    /** @type {Map<string, TaskPromise>} */
    this.pendingTasks = new Map();
    this.taskIdCounter = 0;

    this.isTerminated = false;
    this.isPaused = false;
  }

  /**
   * 生成唯一任务 ID
   */
  _generateTaskId() {
    return uuidv4();
  }

  /**
   * 生成唯一 Worker ID
   */
  _generateWorkerId() {
    return ++this.workerIdCounter;
  }

  /**
   * 创建并包装一个 Worker 实例
   */
  _createWorker() {
    const workerId = this._generateWorkerId();
    const rawWorker = new Worker(this.workerScript);

    const workerInstance = {
      id: workerId,
      worker: rawWorker,
      state: 'idle', // 'idle' | 'busy'
      currentTaskId: null,
      idleTimer: null,
      createdAt: Date.now(),
    };

    rawWorker.onmessage = (e) => this._handleMessage(workerId, e.data);
    rawWorker.onerror = (err) => this._handleWorkerError(workerId, err);
    rawWorker.onmessageerror = (err) => this._handleWorkerError(workerId, err);

    this.workers.set(workerId, workerInstance);
    return workerInstance;
  }

  /**
   * 获取一个空闲 Worker，如果没有且未达上限则创建
   */
  _getIdleWorker() {
    for (const instance of this.workers.values()) {
      if (instance.state === 'idle') {
        this._clearIdleTimer(instance);
        return instance;
      }
    }

    if (this.workers.size < this.poolSize) {
      return this._createWorker();
    }

    return null;
  }

  /**
   * 分配任务到 Worker
   */
  _assignTask(workerInstance, taskItem) {
    const { taskId, payload, resolve, reject, onProgress, timeout, timer } = taskItem;

    workerInstance.state = 'busy';
    workerInstance.currentTaskId = taskId;

    this.pendingTasks.set(taskId, {
      taskId,
      resolve,
      reject,
      onProgress,
      timeout,
      timer,
      workerId: workerInstance.id,
    });

    workerInstance.worker.postMessage({
      taskId,
      payload,
    });
  }

  /**
   * 尝试从队列中调度任务
   */
  _dispatch() {
    if (this.isPaused || this.isTerminated || this.taskQueue.length === 0) {
      return;
    }

    const worker = this._getIdleWorker();
    if (!worker) {
      return;
    }

    const taskItem = this.taskQueue.shift();
    this._assignTask(worker, taskItem);

    // 继续尝试调度，可能还有空闲 Worker
    this._dispatch();
  }

  /**
   * 处理 Worker 回传的消息
   */
  _handleMessage(workerId, data) {
    const workerInstance = this.workers.get(workerId);
    if (!workerInstance) {
      return;
    }

    const { taskId, type, payload } = data || {};
    if (!taskId || !type) {
      return;
    }

    const taskPromise = this.pendingTasks.get(taskId);
    if (!taskPromise) {
      return;
    }

    switch (type) {
      case 'progress':
        if (typeof taskPromise.onProgress === 'function') {
          taskPromise.onProgress(payload);
        }
        break;

      case 'result':
        this._finishTask(taskId, 'resolve', payload);
        this._releaseWorker(workerInstance);
        break;

      case 'error':
        this._finishTask(taskId, 'reject', new Error(payload?.message || payload || 'Worker error'));
        this._releaseWorker(workerInstance);
        break;
    }
  }

  /**
   * 处理 Worker 原生错误（脚本加载失败、未捕获异常等）
   */
  _handleWorkerError(workerId, error) {
    const workerInstance = this.workers.get(workerId);
    if (!workerInstance) {
      return;
    }

    const taskId = workerInstance.currentTaskId;
    if (taskId) {
      this._finishTask(taskId, 'reject', error instanceof Error ? error : new Error(String(error)));
    }

    this._destroyWorker(workerInstance);
    this._dispatch();
  }

  /**
   * 结束任务，清理映射
   */
  _finishTask(taskId, action, value) {
    const taskPromise = this.pendingTasks.get(taskId);
    if (!taskPromise) {
      return;
    }

    this.pendingTasks.delete(taskId);

    if (taskPromise.timer) {
      clearTimeout(taskPromise.timer);
      taskPromise.timer = null;
    }

    if (action === 'resolve') {
      taskPromise.resolve(value);
    } else {
      taskPromise.reject(value);
    }
  }

  /**
   * 释放 Worker 回空闲池
   */
  _releaseWorker(workerInstance) {
    workerInstance.state = 'idle';
    workerInstance.currentTaskId = null;

    if (this.idleTimeout > 0) {
      this._clearIdleTimer(workerInstance);
      workerInstance.idleTimer = setTimeout(() => {
        this._destroyWorker(workerInstance);
      }, this.idleTimeout);
    }

    this._dispatch();
  }

  /**
   * 清理 Worker 的 idle 定时器
   */
  _clearIdleTimer(workerInstance) {
    if (workerInstance.idleTimer) {
      clearTimeout(workerInstance.idleTimer);
      workerInstance.idleTimer = null;
    }
  }

  /**
   * 销毁单个 Worker 实例
   */
  _destroyWorker(workerInstance) {
    this._clearIdleTimer(workerInstance);

    try {
      workerInstance.worker.terminate();
    } catch {
      // ignore
    }

    this.workers.delete(workerInstance.id);
  }

  /**
   * 提交任务到 Worker 池
   * @param {any} payload - 传给 Worker 的数据（需可结构化克隆）
   * @param {Object} [options] - 任务选项
   * @param {number} [options.timeout] - 任务超时(ms)
   * @param {Function} [options.onProgress] - 进度回调 (payload) => void
   * @param {AbortSignal} [options.signal] - 用于取消任务的 AbortSignal
   * @returns {Promise<any>}
   */
  execute(payload, options = {}) {
    if (this.isTerminated) {
      return Promise.reject(new Error('WorkerPool has been terminated'));
    }

    const taskId = this._generateTaskId();
    const timeout = options.timeout || this.taskTimeout;

    return new Promise((resolve, reject) => {
      let timer = null;

      const taskItem = {
        taskId,
        payload,
        resolve,
        reject,
        onProgress: options.onProgress,
        timeout,
        timer,
      };

      if (timeout > 0) {
        taskItem.timer = setTimeout(() => {
          this._finishTask(taskId, 'reject', new Error(`Task ${taskId} timeout after ${timeout}ms`));

          // 找到并销毁该 Worker
          const workerInstance = Array.from(this.workers.values()).find(
            (w) => w.currentTaskId === taskId
          );
          if (workerInstance) {
            this._destroyWorker(workerInstance);
            this._dispatch();
          }
        }, timeout);
      }

      if (options.signal) {
        const abortHandler = () => {
          options.signal.removeEventListener('abort', abortHandler);
          this._finishTask(taskId, 'reject', new Error(`Task ${taskId} aborted`));

          const workerInstance = Array.from(this.workers.values()).find(
            (w) => w.currentTaskId === taskId
          );
          if (workerInstance) {
            this._destroyWorker(workerInstance);
            this._dispatch();
          }
        };

        if (options.signal.aborted) {
          abortHandler();
          return;
        }

        options.signal.addEventListener('abort', abortHandler);
      }

      this.taskQueue.push(taskItem);
      this._dispatch();
    });
  }

  /**
   * 暂停接收新任务（队列中已有任务仍会被调度）
   */
  pause() {
    this.isPaused = true;
  }

  /**
   * 恢复接收新任务
   */
  resume() {
    this.isPaused = false;
    this._dispatch();
  }

  /**
   * 终止全部 Worker，清空队列，拒绝所有待处理任务
   */
  terminate() {
    this.isTerminated = true;

    // 拒绝队列中尚未执行的任务
    while (this.taskQueue.length > 0) {
      const taskItem = this.taskQueue.shift();
      if (taskItem.timer) {
        clearTimeout(taskItem.timer);
      }
      taskItem.reject(new Error('WorkerPool terminated'));
    }

    // 拒绝正在执行中的任务
    for (const taskPromise of this.pendingTasks.values()) {
      if (taskPromise.timer) {
        clearTimeout(taskPromise.timer);
      }
      taskPromise.reject(new Error('WorkerPool terminated'));
    }
    this.pendingTasks.clear();

    // 销毁所有 Worker
    for (const workerInstance of this.workers.values()) {
      this._destroyWorker(workerInstance);
    }
    this.workers.clear();
  }

  /**
   * 获取当前状态快照
   */
  getStats() {
    let idleCount = 0;
    let busyCount = 0;
    for (const w of this.workers.values()) {
      if (w.state === 'idle') {
        idleCount++;
      } else {
        busyCount++;
      }
    }

    return {
      poolSize: this.poolSize,
      totalWorkers: this.workers.size,
      idleCount,
      busyCount,
      pendingCount: this.taskQueue.length,
      isPaused: this.isPaused,
      isTerminated: this.isTerminated,
    };
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorkerPool;
}
