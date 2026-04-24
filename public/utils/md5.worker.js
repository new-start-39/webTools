/**
 * MD5 计算 Worker
 * 接收文件对象，按 chunk 增量计算 SparkMD5，实时回传进度
 */

// 引入 spark-md5，路径相对于此 Worker 脚本所在位置
importScripts('../lib/spark-md5.min.js');

/**
 * 将 Blob/File 切片读取为 ArrayBuffer
 */
const readChunkAsArrayBuffer = (chunk) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e.target.error || new Error('FileReader error'));
    reader.readAsArrayBuffer(chunk);
  });
};

/**
 * 执行增量 MD5 计算
 */
const computeMd5 = async (taskId, file, chunkSize) => {
  const spark = new SparkMD5.ArrayBuffer();
  const totalSize = file.size;
  const totalChunks = Math.ceil(totalSize / chunkSize);
  const chunkHashes = [];

  for (let index = 0; index < totalChunks; index++) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, totalSize);
    const chunk = file.slice(start, end);

    const buffer = await readChunkAsArrayBuffer(chunk);
    spark.append(buffer);

    const chunkSpark = new SparkMD5.ArrayBuffer();
    chunkSpark.append(buffer);
    const chunkHash = chunkSpark.end();
    chunkHashes.push(chunkHash);

    self.postMessage({
      taskId,
      type: 'progress',
      payload: {
        index,
        currentChunk: index + 1,
        totalChunks,
        percent: Math.round(((index + 1) / totalChunks) * 100),
        loadedSize: end,
        totalSize,
        chunkHash,
      },
    });
  }

  const hash = spark.end();

  self.postMessage({
    taskId,
    type: 'result',
    payload: {
      hash,
      chunkHashes,
      totalChunks,
      totalSize,
    },
  });
};

self.onmessage = async (e) => {
  const { taskId, payload } = e.data || {};

  if (!taskId || !payload) {
    return;
  }

  const { file, chunkSize = 2 * 1024 * 1024 } = payload;

  if (!file) {
    self.postMessage({
      taskId,
      type: 'error',
      payload: { message: 'Missing file in payload' },
    });
    return;
  }

  try {
    await computeMd5(taskId, file, chunkSize);
  } catch (err) {
    self.postMessage({
      taskId,
      type: 'error',
      payload: { message: err.message || String(err) },
    });
  }
};
