// Background service worker to track time spent per domain

let activeTabId = null;
let startTime = null;
let checkInterval = null;
let tabVisibility = {}; // Track visibility state of tabs

// Initialize storage
chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get(['domainLimits', 'domainUsage'], (result) => {
    if (!result.domainLimits) {
      chrome.storage.local.set({ domainLimits: {} });
    }
    if (!result.domainUsage) {
      chrome.storage.local.set({ domainUsage: {} });
    }
  });
  
  // Open welcome page on install
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'welcome.html' });
  }
});

// Extract domain from URL
function getDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (e) {
    return null;
  }
}

// Track active tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Save time for previous tab
  if (activeTabId && startTime) {
    await saveTimeSpent(activeTabId);
  }
  
  activeTabId = activeInfo.tabId;
  startTime = Date.now();
  
  // Check if current site is blocked
  const tab = await chrome.tabs.get(activeTabId);
  await checkAndBlockSite(tab);
});

// Track tab updates (URL changes)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tabId === activeTabId) {
    if (startTime) {
      await saveTimeSpent(tabId);
    }
    startTime = Date.now();
    
    // Reset visibility to true when URL changes (content script will update if needed)
    tabVisibility[tabId] = true;
    
    await checkAndBlockSite(tab);
  }
});

// Track window focus changes
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus, save time
    if (activeTabId && startTime) {
      await saveTimeSpent(activeTabId);
      startTime = null;
    }
  } else {
    // Browser gained focus
    const [tab] = await chrome.tabs.query({ active: true, windowId: windowId });
    if (tab) {
      activeTabId = tab.id;
      startTime = Date.now();
      await checkAndBlockSite(tab);
    }
  }
});

// Save time spent
async function saveTimeSpent(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const domain = getDomain(tab.url);
    
    if (!domain || domain.startsWith('chrome://') || domain.startsWith('chrome-extension://')) {
      return;
    }
    
    const timeSpent = Date.now() - startTime;
    
    const result = await chrome.storage.local.get(['domainUsage']);
    const domainUsage = result.domainUsage || {};
    
    const today = new Date().toDateString();
    
    if (!domainUsage[domain]) {
      domainUsage[domain] = {};
    }
    
    if (!domainUsage[domain][today]) {
      domainUsage[domain][today] = 0;
    }
    
    domainUsage[domain][today] += timeSpent;
    
    await chrome.storage.local.set({ domainUsage });
  } catch (e) {
    // Tab might have been closed
  }
}

// Check if site should be blocked
async function checkAndBlockSite(tab) {
  if (!tab || !tab.url) return;
  
  const domain = getDomain(tab.url);
  if (!domain || domain.startsWith('chrome://') || domain.startsWith('chrome-extension://')) {
    // Clear badge for non-tracked sites
    chrome.action.setBadgeText({ text: '', tabId: tab.id });
    return;
  }
  
  const result = await chrome.storage.local.get(['domainLimits', 'domainUsage']);
  const domainLimits = result.domainLimits || {};
  const domainUsage = result.domainUsage || {};
  
  const limit = domainLimits[domain];
  if (!limit) {
    // No limit set - clear badge
    chrome.action.setBadgeText({ text: '', tabId: tab.id });
    return;
  }
  
  const today = new Date().toDateString();
  const usage = (domainUsage[domain] && domainUsage[domain][today]) || 0;
  
  // Check if tab is visible
  const isTabVisible = tabVisibility[tab.id] !== false; // Default to true if unknown
  
  // Update badge with percentage remaining or paused indicator
  if (!isTabVisible) {
    // Tab is hidden - show pause indicator
    chrome.action.setBadgeText({ text: '⏸', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#6B7280', tabId: tab.id }); // Gray
  } else {
    const percentRemaining = Math.max(0, Math.floor(((limit - usage) / limit) * 100));
    chrome.action.setBadgeText({ text: `${percentRemaining}%`, tabId: tab.id });
    
    // Color based on percentage remaining
    if (percentRemaining <= 0) {
      chrome.action.setBadgeBackgroundColor({ color: '#DC2626', tabId: tab.id }); // Red
    } else if (percentRemaining <= 25) {
      chrome.action.setBadgeBackgroundColor({ color: '#EA580C', tabId: tab.id }); // Orange
    } else if (percentRemaining <= 50) {
      chrome.action.setBadgeBackgroundColor({ color: '#EAB308', tabId: tab.id }); // Yellow
    } else {
      chrome.action.setBadgeBackgroundColor({ color: '#16A34A', tabId: tab.id }); // Green
    }
  }
  
  // Send message to content script
  chrome.tabs.sendMessage(tab.id, {
    type: 'UPDATE_STATUS',
    domain: domain,
    limit: limit,
    usage: usage,
    isBlocked: usage >= limit
  }).catch(() => {
    // Content script might not be ready yet
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TAB_VISIBILITY_CHANGED') {
    const tabId = sender.tab.id;
    tabVisibility[tabId] = message.isVisible;
    
    // Update badge immediately - don't wait for next check
    chrome.tabs.get(tabId, async (tab) => {
      if (chrome.runtime.lastError) return;
      await checkAndBlockSite(tab);
    });
    
    sendResponse({ success: true });
    return true;
  } else if (message.type === 'GET_STATUS') {
    const domain = getDomain(sender.tab.url);
    chrome.storage.local.get(['domainLimits', 'domainUsage'], (result) => {
      const domainLimits = result.domainLimits || {};
      const domainUsage = result.domainUsage || {};
      const limit = domainLimits[domain];
      const today = new Date().toDateString();
      const usage = (domainUsage[domain] && domainUsage[domain][today]) || 0;
      
      sendResponse({
        domain: domain,
        limit: limit,
        usage: usage,
        isBlocked: limit && usage >= limit
      });
    });
    return true; // Keep channel open for async response
  } else if (message.type === 'ADD_TIME') {
    const domain = getDomain(sender.tab.url);
    console.log(`[ScreenTime] ADD_TIME request for ${domain}: -${Math.floor(message.amount/1000)}s`);
    chrome.storage.local.get(['domainUsage'], async (result) => {
      const domainUsage = result.domainUsage || {};
      const today = new Date().toDateString();
      
      if (!domainUsage[domain]) {
        domainUsage[domain] = {};
      }
      
      if (!domainUsage[domain][today]) {
        domainUsage[domain][today] = 0;
      }
      
      const beforeUsage = domainUsage[domain][today];
      
      // Subtract time (add more available time)
      domainUsage[domain][today] = Math.max(0, domainUsage[domain][today] - message.amount);
      
      const afterUsage = domainUsage[domain][today];
      console.log(`[ScreenTime] Usage updated: ${Math.floor(beforeUsage/1000)}s → ${Math.floor(afterUsage/1000)}s (reduced by ${Math.floor((beforeUsage-afterUsage)/1000)}s)`);
      
      await chrome.storage.local.set({ domainUsage });
      
      // Get updated status
      const limits = await chrome.storage.local.get(['domainLimits']);
      const domainLimits = limits.domainLimits || {};
      const limit = domainLimits[domain];
      const usage = domainUsage[domain][today];
      
      console.log(`[ScreenTime] New status: ${Math.floor(usage/1000)}s / ${Math.floor(limit/1000)}s (${Math.floor((limit-usage)/1000)}s remaining)`);
      
      sendResponse({
        domain: domain,
        limit: limit,
        usage: usage,
        isBlocked: limit && usage >= limit
      });
    });
    return true;
  } else if (message.type === 'SET_LIMIT') {
    console.log(`[ScreenTime] Setting limit for ${message.domain}: ${message.limit ? Math.floor(message.limit/1000) + 's' : 'REMOVED'}`);
    chrome.storage.local.get(['domainLimits'], async (result) => {
      const domainLimits = result.domainLimits || {};
      domainLimits[message.domain] = message.limit;
      await chrome.storage.local.set({ domainLimits });
      sendResponse({ success: true });
    });
    return true;
  }
});

// Periodic check (every second)
setInterval(async () => {
  if (activeTabId && startTime) {
    try {
      const tab = await chrome.tabs.get(activeTabId);
      const domain = getDomain(tab.url);
      
      if (domain && !domain.startsWith('chrome://') && !domain.startsWith('chrome-extension://')) {
        // Check if site is currently blocked - don't count time if blocked
        const result = await chrome.storage.local.get(['domainUsage', 'domainLimits']);
        const domainUsage = result.domainUsage || {};
        const domainLimits = result.domainLimits || {};
        
        const today = new Date().toDateString();
        const currentUsage = (domainUsage[domain] && domainUsage[domain][today]) || 0;
        const limit = domainLimits[domain];
        
        // Only count time if not blocked (under limit or no limit set)
        const isBlocked = limit && currentUsage >= limit;
        
        if (!isBlocked) {
          // Update time spent so far
          const timeSpent = Date.now() - startTime;
          
          if (!domainUsage[domain]) {
            domainUsage[domain] = {};
          }
          
          if (!domainUsage[domain][today]) {
            domainUsage[domain][today] = 0;
          }
          
          // Add the elapsed time
          domainUsage[domain][today] += timeSpent;
          
          console.log(`[ScreenTime] Counting time for ${domain}: +${Math.floor(timeSpent/1000)}s | Total: ${Math.floor(domainUsage[domain][today]/1000)}s / ${Math.floor(limit/1000)}s`);
          
          await chrome.storage.local.set({ domainUsage });
        } else {
          console.log(`[ScreenTime] NOT counting time for ${domain} - BLOCKED (${Math.floor(currentUsage/1000)}s / ${Math.floor(limit/1000)}s)`);
        }
        
        // Always reset startTime to current time
        startTime = Date.now();
      }
      
      await checkAndBlockSite(tab);
    } catch (e) {
      // Tab might have been closed
    }
  }
}, 1000);
