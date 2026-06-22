// popup.js — 弹窗逻辑：基于域名检测书签、渲染结果、支持删除

/**
 * 从 URL 中提取域名
 */
function extractHostname(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch (e) {
    return null;
  }
}

/**
 * 递归获取书签节点的完整文件夹路径
 */
async function getFolderPath(nodeId) {
  const path = [];
  let currentId = nodeId;
  while (currentId) {
    try {
      const nodes = await chrome.bookmarks.get(currentId);
      if (!nodes || nodes.length === 0) break;
      const node = nodes[0];
      if (node.id === "0" || node.parentId === undefined) break;
      if (node.title) path.unshift(node.title);
      currentId = node.parentId;
    } catch (e) {
      break;
    }
  }
  return path.filter(Boolean).join(" › ");
}

/**
 * 获取所有书签（递归遍历整棵书签树）
 */
async function getAllBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const results = [];
  function traverse(nodes) {
    for (const node of nodes) {
      if (node.url) results.push(node);
      if (node.children) traverse(node.children);
    }
  }
  traverse(tree);
  return results;
}

/**
 * 按域名过滤书签
 */
async function checkBookmarkByHostname(url) {
  const targetHostname = extractHostname(url);
  if (!targetHostname) return { hostname: null, bookmarks: [] };
  const allBookmarks = await getAllBookmarks();
  const matched = allBookmarks.filter(
    (bm) => extractHostname(bm.url) === targetHostname
  );
  return { hostname: targetHostname, bookmarks: matched };
}

/**
 * HTML 转义
 */
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 截断过长的 URL
 */
function truncateUrl(url, maxLen = 58) {
  if (!url) return "";
  return url.length <= maxLen ? url : url.slice(0, maxLen) + "…";
}

// ─── 确认对话框 ───────────────────────────────────────────────

let pendingDeleteId = null;
let pendingDeleteTitle = null;

/**
 * 显示删除确认对话框
 */
function showConfirm(bookmarkId, bookmarkTitle) {
  pendingDeleteId = bookmarkId;
  pendingDeleteTitle = bookmarkTitle;

  const desc = document.getElementById("confirmDesc");
  desc.innerHTML = `确定要删除书签 <strong>「${escapeHtml(bookmarkTitle || "（无标题）")}」</strong> 吗？此操作不可撤销。`;

  document.getElementById("confirmOverlay").style.display = "flex";
}

/**
 * 隐藏确认对话框
 */
function hideConfirm() {
  pendingDeleteId = null;
  pendingDeleteTitle = null;
  document.getElementById("confirmOverlay").style.display = "none";
}

// ─── 渲染函数 ─────────────────────────────────────────────────

/**
 * 渲染已收藏状态（含删除按钮）
 */
async function renderSaved(hostname, bookmarks) {
  const statusArea = document.getElementById("statusArea");

  const items = await Promise.all(
    bookmarks.map(async (bm) => {
      const path = bm.parentId ? await getFolderPath(bm.parentId) : "";
      return { id: bm.id, title: bm.title, path, url: bm.url };
    })
  );

  const listHtml = items
    .map(
      (item) => `
      <div class="bookmark-item" data-id="${escapeHtml(item.id)}">
        <div class="bookmark-item-header">
          <div class="bookmark-name" title="${escapeHtml(item.title)}">${escapeHtml(item.title) || "（无标题）"}</div>
          <button class="btn-delete" data-id="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}">删除</button>
        </div>
        <div class="bookmark-path">
          <span class="bookmark-path-icon">📁</span>
          <span class="bookmark-path-text">${escapeHtml(item.path) || "书签根目录"}</span>
        </div>
        <div class="bookmark-url" title="${escapeHtml(item.url)}">${escapeHtml(truncateUrl(item.url, 46))}</div>
      </div>
    `
    )
    .join("");

  statusArea.innerHTML = `
    <div class="status-card saved">
      <div class="status-header">
        <span class="status-dot green"></span>
        <span class="status-text green">
          已收藏该网站${bookmarks.length > 1 ? `（共 ${bookmarks.length} 条）` : ""}
        </span>
      </div>
      <div class="domain-hint">匹配域名：<strong>${escapeHtml(hostname)}</strong></div>
      <div class="bookmark-list">${listHtml}</div>
    </div>
  `;

  // 绑定删除按钮事件
  statusArea.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      showConfirm(btn.dataset.id, btn.dataset.title);
    });
  });
}

/**
 * 渲染未收藏状态
 */
function renderNotSaved(hostname) {
  const statusArea = document.getElementById("statusArea");
  statusArea.innerHTML = `
    <div class="status-card not-saved">
      <div class="status-header">
        <span class="status-dot gray"></span>
        <span class="status-text gray">未收藏该产品</span>
      </div>
      <p class="not-saved-hint">域名 <strong>${escapeHtml(hostname)}</strong> 下暂无书签记录。</p>
    </div>
  `;
}

/**
 * 渲染不支持的页面
 */
function renderUnsupported() {
  const statusArea = document.getElementById("statusArea");
  statusArea.innerHTML = `
    <div class="status-card not-saved">
      <div class="status-header">
        <span class="status-dot gray"></span>
        <span class="status-text gray">不支持此页面</span>
      </div>
      <p class="not-saved-hint">Chrome 内部页面或扩展页面无法检测。</p>
    </div>
  `;
}

// ─── 主逻辑 ───────────────────────────────────────────────────

let currentUrl = "";

async function run() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentUrl = tab?.url || "";

    document.getElementById("currentUrl").textContent =
      truncateUrl(currentUrl) || "（无法获取）";

    if (
      !currentUrl ||
      currentUrl.startsWith("chrome://") ||
      currentUrl.startsWith("chrome-extension://") ||
      currentUrl.startsWith("about:")
    ) {
      renderUnsupported();
      return;
    }

    const { hostname, bookmarks } = await checkBookmarkByHostname(currentUrl);

    if (!hostname) {
      renderUnsupported();
      return;
    }

    if (bookmarks.length > 0) {
      await renderSaved(hostname, bookmarks);
    } else {
      renderNotSaved(hostname);
    }
  } catch (err) {
    document.getElementById("statusArea").innerHTML = `
      <div class="status-card not-saved">
        <p class="not-saved-hint">检测出错：${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

// 页面加载后初始化
document.addEventListener("DOMContentLoaded", () => {
  // 确认对话框按钮事件
  document.getElementById("btnCancel").addEventListener("click", hideConfirm);

  document.getElementById("btnConfirmDelete").addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    try {
      await chrome.bookmarks.remove(pendingDeleteId);
    } catch (e) {
      // 忽略删除失败（书签已不存在等情况）
    }
    hideConfirm();
    // 重新检测并刷新弹窗
    await run();
  });

  run();
});
