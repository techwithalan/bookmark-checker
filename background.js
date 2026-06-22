// background.js — 监听标签页切换和 URL 变化，更新图标状态
// 判断逻辑：以"域名"为单位匹配书签
// 图标状态：已收藏 → 蓝底黄书签；未收藏 → 蓝底白书签（默认）

const ICON_DEFAULT = {
  "16": "icons/icon16.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png",
};

const ICON_SAVED = {
  "16": "icons/icon16_saved.png",
  "48": "icons/icon48_saved.png",
  "128": "icons/icon128_saved.png",
};

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
 * 检测当前 URL 的域名是否已有书签
 */
async function checkBookmarkByHostname(url) {
  if (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("about:")
  ) {
    return [];
  }
  const targetHostname = extractHostname(url);
  if (!targetHostname) return [];
  const allBookmarks = await getAllBookmarks();
  return allBookmarks.filter(
    (bm) => extractHostname(bm.url) === targetHostname
  );
}

/**
 * 更新指定标签页的图标（切换图标 + 清空徽章文字）
 */
async function updateBadge(tabId, url) {
  const bookmarks = await checkBookmarkByHostname(url);
  if (bookmarks.length > 0) {
    // 已收藏：切换为黄色书签图标
    chrome.action.setIcon({ path: ICON_SAVED, tabId });
    chrome.action.setBadgeText({ text: "", tabId });
  } else {
    // 未收藏：恢复默认白色书签图标
    chrome.action.setIcon({ path: ICON_DEFAULT, tabId });
    chrome.action.setBadgeText({ text: "", tabId });
  }
}

// 监听标签页激活（切换标签时触发）
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url) updateBadge(activeInfo.tabId, tab.url);
});

// 监听标签页 URL 更新（导航到新页面时触发）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    updateBadge(tabId, tab.url);
  }
});

// 书签变化时，刷新当前标签页图标
async function refreshCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) updateBadge(tab.id, tab.url);
}

chrome.bookmarks.onCreated.addListener(refreshCurrentTab);
chrome.bookmarks.onRemoved.addListener(refreshCurrentTab);
chrome.bookmarks.onChanged.addListener(refreshCurrentTab);
