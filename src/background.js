const CONTEXT_MENU_ID = 'share-to-sns';
const PENDING_SHARE_CONTEXT_STORAGE_KEY = 'pendingShareContext';

function createShareText(title, url) {
  return `${title}\n${url}`;
}

async function handleContextMenuClick(info, tab) {
  if (info.menuItemId !== CONTEXT_MENU_ID) {
    return;
  }

  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
    return;
  }

  const shareText = createShareText(tab.title || tab.url, tab.url);
  await chrome.storage.local.set({
    [PENDING_SHARE_CONTEXT_STORAGE_KEY]: {
      url: tab.url,
      title: tab.title || '',
      text: shareText,
      createdAt: Date.now()
    }
  });

  await chrome.action.openPopup();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'このページをSNSに共有',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab);
});
