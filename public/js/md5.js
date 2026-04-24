/**
 * 在线 MD5 计算器前端逻辑
 * 数据与结构分离，驱动桌面端表格和移动端卡片
 */

// ==================== 数据层 ====================

/** @type {Array<FileItem>} */
const fileList = [];

// ==================== Worker 池 ====================

const pool = new WorkerPool('utils/md5.worker.js', { poolSize: 10 });

// ==================== DOM 引用 ====================

const uploadZoneDesktop = document.getElementById('upload-zone-desktop');
const uploadZoneMobile = document.getElementById('upload-zone-mobile');
const fileInput = document.getElementById('file-input');
const desktopTbody = document.getElementById('desktop-tbody');
const mobileCards = document.getElementById('mobile-cards');

// ==================== 工具函数 ====================

/**
 * 格式化文件大小
 */
const formatSize = (bytes) => {
  if (bytes === 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
};

/**
 * 截断显示 MD5，保留前 6 位和后 4 位
 */
const formatHash = (hash) => {
  if (!hash || hash.length <= 12) {
    return hash || '-';
  }

  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
};

/**
 * 根据文件名判断图标类型
 */
const getFileIconType = (name) => {
  const lower = name.toLowerCase();

  if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z')) {
    return 'icon-file-zip';
  }

  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/.test(lower)) {
    return 'icon-file-image';
  }

  return 'icon-file';
};

/**
 * 获取状态展示文案
 */
const getStatusText = (status) => {
  const map = {
    pending: '等待中...',
    calculating: '计算中...',
    completed: '已完成',
    error: '计算失败',
  };

  return map[status] || status;
};

const getDesktopEmptyHtml = () => '<tr><td colspan="5"><div class="empty-state">暂无文件，请选择或拖拽文件到上方</div></td></tr>';
const getMobileEmptyHtml = () => '<div class="empty-state">暂无文件，请点击上方按钮上传</div>';

// ==================== 渲染层 ====================

/**
 * 渲染桌面端表格行
 */
const renderDesktopRow = (file) => {
  const iconId = getFileIconType(file.name);
  const statusText = getStatusText(file.status);

  let statusCell = '';
  if (file.status === 'completed') {
    statusCell = `<span class="status-completed">${statusText}</span>`;
  } else if (file.status === 'calculating' || file.status === 'pending') {
    statusCell = `
      <div class="progress-wrap">
        <div class="progress-text">${statusText} ${file.progress}%</div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${file.progress}%"></div>
        </div>
      </div>
    `;
  } else {
    statusCell = `<span style="color:#f5222d;font-size:13px">${statusText}</span>`;
  }

  const hashDisplay = file.status === 'completed' ? formatHash(file.fullHash) : '-';
  const isCopied = file.copiedAt && Date.now() - file.copiedAt < 1500;
  const actionCell = file.status === 'completed'
    ? (isCopied
        ? `<button class="btn-copy copied" onclick="handleCopy('${file.id}', this)">
             <svg class="icon"><use href="assets/icons.svg#icon-check"></use></svg>
             已复制
           </button>`
        : `<button class="btn-copy" onclick="handleCopy('${file.id}', this)">
             <svg class="icon"><use href="assets/icons.svg#icon-copy"></use></svg>
             复制
           </button>`)
    : '-';

  return `
    <tr data-id="${file.id}">
      <td>
        <div class="file-name-cell">
          <svg class="icon"><use href="assets/icons.svg#${iconId}"></use></svg>
          <span class="file-name-text" title="${file.name}">${file.name}</span>
        </div>
      </td>
      <td class="size-cell">${formatSize(file.size)}</td>
      <td>${statusCell}</td>
      <td class="hash-cell">${hashDisplay}</td>
      <td>${actionCell}</td>
    </tr>
  `;
};

/**
 * 渲染移动端卡片
 */
const renderMobileCard = (file) => {
  const iconId = getFileIconType(file.name);
  const statusText = getStatusText(file.status);

  let progressSection = '';
  if (file.status === 'calculating' || file.status === 'pending') {
    progressSection = `
      <div class="card-progress">
        <div class="card-progress-row">
          <span class="card-progress-label">${statusText}</span>
          <span class="card-progress-percent">${file.progress}%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${file.progress}%"></div>
        </div>
      </div>
    `;
  }

  const statusClass = file.status === 'completed' ? 'completed' : file.status === 'error' ? 'error' : '';
  const hashDisplay = file.status === 'completed' ? formatHash(file.fullHash) : '-';
  const isCopied = file.copiedAt && Date.now() - file.copiedAt < 1500;
  const copyBtn = file.status === 'completed'
    ? (isCopied
        ? `<button class="btn-copy copied" onclick="handleCopy('${file.id}', this)">已复制</button>`
        : `<button class="btn-copy" onclick="handleCopy('${file.id}', this)">复制</button>`)
    : '';

  return `
    <div class="card-item" data-id="${file.id}">
      <div class="card-top">
        <svg class="card-icon"><use href="assets/icons.svg#${iconId}"></use></svg>
        <div class="card-info">
          <div class="card-name" title="${file.name}">${file.name}</div>
          <div class="card-size">${formatSize(file.size)}</div>
        </div>
        <div class="card-status ${statusClass}">${statusText}</div>
      </div>
      ${progressSection}
      <div class="card-bottom">
        <div class="card-hash" title="${file.fullHash || ''}">MD5: ${hashDisplay}</div>
        ${copyBtn}
      </div>
    </div>
  `;
};

/**
 * 全量渲染
 */
const render = () => {
  if (fileList.length === 0) {
    desktopTbody.innerHTML = getDesktopEmptyHtml();
    mobileCards.innerHTML = getMobileEmptyHtml();
    return;
  }

  desktopTbody.innerHTML = fileList.map(renderDesktopRow).join('');
  mobileCards.innerHTML = fileList.map(renderMobileCard).join('');
};

const updateDesktopRow = (file) => {
  const currentRow = desktopTbody.querySelector(`tr[data-id="${file.id}"]`);
  if (!currentRow) {
    render();
    return;
  }

  currentRow.outerHTML = renderDesktopRow(file).trim();
};

const updateMobileCard = (file) => {
  const currentCard = mobileCards.querySelector(`.card-item[data-id="${file.id}"]`);
  if (!currentCard) {
    render();
    return;
  }

  currentCard.outerHTML = renderMobileCard(file).trim();
};

const renderFile = (file) => {
  updateDesktopRow(file);
  updateMobileCard(file);
};

// ==================== 业务逻辑 ====================

/**
 * 添加单个文件并启动计算
 */
const addFile = async (rawFile) => {
  const id = uuidv4();
  const fileItem = {
    id,
    name: rawFile.name,
    size: rawFile.size,
    status: 'pending',
    progress: 0,
    fullHash: '',
    copiedAt: 0,
    copyTimer: null,
  };

  fileList.unshift(fileItem);
  render();

  try {
    const result = await pool.execute(
      { file: rawFile, chunkSize: 2 * 1024 * 1024 },
      {
        onProgress: (payload) => {
          const target = fileList.find((file) => file.id === id);
          if (!target) {
            return;
          }

          target.status = 'calculating';
          target.progress = payload.percent;
          console.log(`[${rawFile.name}] 分片 ${payload.currentChunk}/${payload.totalChunks} MD5: ${payload.chunkHash}`);
          renderFile(target);
        },
      }
    );

    const target = fileList.find((file) => file.id === id);
    if (target) {
      target.status = 'completed';
      target.progress = 100;
      target.fullHash = result.hash;
      renderFile(target);
    }

    if (result.chunkHashes) {
      console.log(`[${rawFile.name}] 分片 MD5:`, result.chunkHashes);
    }
  } catch (err) {
    const target = fileList.find((file) => file.id === id);
    if (target) {
      target.status = 'error';
      renderFile(target);
    }

    console.error(`[${rawFile.name}] 计算失败:`, err);
  }
};

/**
 * 处理文件输入（可多文件）
 */
const handleFiles = (files) => {
  if (!files || files.length === 0) {
    return;
  }

  Array.from(files).forEach((file) => {
    addFile(file);
  });
};

/**
 * 复制文本到剪贴板（兼容微信内置浏览器）
 */
const copyText = async (text) => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 降级处理
    }
  }

  if (typeof document.execCommand !== 'function') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.contain = 'strict';
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  textarea.style.fontSize = '12pt';

  const previouslyFocusedElement = document.activeElement;
  document.body.appendChild(textarea);

  textarea.select();
  textarea.selectionStart = 0;
  textarea.selectionEnd = text.length;

  let success = false;
  try {
    success = document.execCommand('copy');
  } catch {
    success = false;
  }

  document.body.removeChild(textarea);
  if (previouslyFocusedElement) {
    previouslyFocusedElement.focus();
  }

  return success;
};

/**
 * 复制 MD5 到剪贴板
 */
const handleCopy = async (id) => {
  const target = fileList.find((file) => file.id === id);
  if (!target || !target.fullHash) {
    return;
  }

  const success = await copyText(target.fullHash);
  if (!success) {
    alert('复制失败，请手动复制');
    return;
  }

  target.copiedAt = Date.now();
  if (target.copyTimer) {
    clearTimeout(target.copyTimer);
  }

  target.copyTimer = setTimeout(() => {
    target.copiedAt = 0;
    renderFile(target);
  }, 1500);

  renderFile(target);
};

// ==================== 事件绑定 ====================

const bindUploadEvents = (zone) => {
  zone.addEventListener('click', () => {
    fileInput.click();
  });

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
};

if (uploadZoneDesktop) {
  bindUploadEvents(uploadZoneDesktop);
}

if (uploadZoneMobile) {
  bindUploadEvents(uploadZoneMobile);
}

fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  fileInput.value = '';
});

window.handleCopy = handleCopy;

// ==================== 初始化 ====================

render();
