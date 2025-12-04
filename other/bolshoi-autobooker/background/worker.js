const USE_SCHEDULE = false;
const TARGET_SLOTS = ["10:00:00.010", "11:00:00.010", "12:00:00.010"];
const SHOW_URL_RE = /https:\/\/ticket\.bolshoi\.ru\/show\//i;
const CHECKOUT_URL_RE = /https:\/\/ticket\.bolshoi\.ru\/checkout/i;

let currentStatus = "Ожидание…";
let monitoring = false;
let activeSettings = null;
let activeTabId = null;
const logBuffer = [];
const MAX_LOGS = 200;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return;
  }

  if (message.action === "getStatus") {
    sendResponse({ status: currentStatus, running: monitoring });
    return;
  }

  if (message.action === "startMonitoring") {
    startMonitoring(message.payload).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: error?.message })
    );
    return true;
  }

  if (message.action === "stopMonitoring") {
    stopMonitoring();
    sendResponse({ ok: true });
    return;
  }

  if (message.action === "pageReady") {
    sendResponse({
      active: monitoring,
      settings: monitoring ? activeSettings : null
    });
    return;
  }

  if (message.action === "logEvent") {
    addLog(message.source || detectSender(sender), message.text || "");
    sendResponse({ ok: true });
    return;
  }

  if (message.action === "getLogs") {
    sendResponse({ logs: [...logBuffer] });
    return;
  }

  if (message.action === "clearLogs") {
    logBuffer.length = 0;
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "contentStatus") {
    setStatus(message.status ?? currentStatus, message.running ?? monitoring);
    return;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "autoClick" || !monitoring || !activeTabId) {
    return;
  }
  sendCommandToContent("firePurchase");
  setStatus("Команда: нажать «Купить»", true);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    stopMonitoring();
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  ensureContentScripts(details.tabId, details.url);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  ensureContentScripts(details.tabId, details.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab?.url) {
    ensureContentScripts(tabId, tab.url);
  }
});

async function startMonitoring(settings) {
  activeSettings = settings;
  const tab = await getActiveTab();
  if (!tab) {
    throw new Error("Не удалось определить активную вкладку с сайтом");
  }
  activeTabId = tab.id;
  monitoring = true;
  setStatus("Мониторинг запущен", true);
  await sendCommandToContent("initMonitoring", { settings });
  if (USE_SCHEDULE) {
    scheduleNextAlarm();
  } else {
    firePurchaseNow();
  }
}

function stopMonitoring() {
  chrome.alarms.clear("autoClick");
  if (activeTabId) {
    sendCommandToContent("stopMonitoring");
  }
  activeTabId = null;
  monitoring = false;
  setStatus("Ожидание…", false);
}

async function sendCommandToContent(action, payload = {}) {
  if (!activeTabId) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(activeTabId, { action, ...payload });
  } catch (error) {
    console.warn("Не удалось отправить сообщение контент-скрипту", error);
  }
}

function scheduleNextAlarm() {
  const when = computeNextSlot(TARGET_SLOTS);
  if (!when) {
    return;
  }
  chrome.alarms.create("autoClick", { when });
  setStatus(
    `Ждём ${new Date(when).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })}`,
    true
  );
}

function firePurchaseNow() {
  if (!activeTabId) {
    return;
  }
  sendCommandToContent("firePurchase");
  setStatus("Тестовый запуск: команда «Купить» отправлена", true);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScripts(tabId, url = "") {
  if (!url || tabId == null) {
    return;
  }
  if (SHOW_URL_RE.test(url)) {
    await ensureScriptInjected(tabId, "show");
  }
  if (CHECKOUT_URL_RE.test(url)) {
    await ensureScriptInjected(tabId, "checkout");
  }
}

async function ensureScriptInjected(tabId, type) {
  const action = type === "show" ? "pingShowScript" : "pingCheckoutScript";
  const file =
    type === "show"
      ? "content-scripts/show-detail.js"
      : "content-scripts/checkout.js";

  const alive = await pingContentScript(tabId, action);
  if (alive) {
    addLog("Worker", `Скрипт ${type} уже активен на вкладке ${tabId}`);
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [file]
    });
    addLog("Worker", `Инжектирован скрипт ${type} для вкладки ${tabId}`);
  } catch (error) {
    addLog("Worker", `Ошибка инжекции ${type}: ${error?.message}`);
  }
}

function pingContentScript(tabId, action) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { action }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(response?.alive));
      });
    } catch (error) {
      resolve(false);
    }
  });
}

function computeNextSlot(slots) {
  const now = Date.now();
  const candidates = slots
    .map((timeString) => parseTimeToTimestamp(timeString))
    .filter(Boolean)
    .map((target) => {
      if (target <= now) {
        return target + 24 * 60 * 60 * 1000;
      }
      return target;
    });

  if (!candidates.length) {
    return null;
  }

  return Math.min(...candidates);
}

function parseTimeToTimestamp(timeString) {
  const match = timeString.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!match) {
    return null;
  }
  const now = new Date();
  const [, h, m, s, ms = "0"] = match;
  const target = new Date(now);
  target.setHours(Number(h), Number(m), Number(s), Number(ms));
  return target.getTime();
}

function setStatus(text, isRunning) {
  currentStatus = text;
  monitoring = isRunning;
  addLog("Status", text);
  chrome.runtime.sendMessage({
    type: "statusUpdate",
    status: currentStatus,
    running: monitoring
  });
}

function addLog(source, text) {
  if (!text) return;
  const entry = {
    source,
    text,
    time: new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  };
  logBuffer.push(entry);
  while (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }
  chrome.runtime.sendMessage({ type: "logEvent", entry });
}

function detectSender(sender) {
  if (sender?.tab?.url) {
    if (sender.tab.url.includes("/show/")) return "ShowPage";
    if (sender.tab.url.includes("/checkout")) return "Checkout";
    if (sender.tab.url.includes("/shows")) return "Shows";
  }
  return "Worker";
}

