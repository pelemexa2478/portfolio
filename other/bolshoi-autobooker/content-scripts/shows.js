function logEvent(text) {
  chrome.runtime.sendMessage({
    action: "logEvent",
    source: "ShowsPage",
    text
  });
}
let monitoringEnabled = false;
let observer = null;
let currentBest = null;
let currentSettings = null;
let scanTimerId = null;

chrome.runtime.onMessage.addListener((message) => {
  if (!message?.action) return;

  if (message.action === "initMonitoring") {
    currentSettings = message.settings;
    startMonitoring();
  }

  if (message.action === "stopMonitoring") {
    stopMonitoring();
  }

  if (message.action === "firePurchase") {
    triggerPurchase();
  }
});

function startMonitoring() {
  monitoringEnabled = true;
  setStatus("Отслеживаем спектакли");
  ensureObserver();
  scanShows();
  startScanTimer();
  logEvent("Мониторинг спектаклей запущен");
}

function stopMonitoring() {
  monitoringEnabled = false;
  observer?.disconnect();
  observer = null;
  currentBest = null;
  stopScanTimer();
  setStatus("Мониторинг остановлен", false);
  logEvent("Мониторинг остановлен");
}

function ensureObserver() {
  if (observer) return;
  observer = new MutationObserver(() => {
    if (!monitoringEnabled) return;
    scanShows();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function scanShows() {
  if (!monitoringEnabled || !currentSettings?.showTitle) return;
  const results = findMatchingButtons(
    currentSettings.showTitle,
    currentSettings.showDate,
    currentSettings.showTime
  );
  if (results.length === 0) {
    currentBest = null;
    setStatus(`Ждём "${currentSettings.showTitle}"`, true);
    logEvent(`Не нашли спектакль "${currentSettings.showTitle}"`);
    return;
  }
  results.sort((a, b) => b.available - a.available);
  currentBest = results[0];
  setStatus(`Найдена кнопка, свободно ≈ ${currentBest.available}`, true);
  logEvent(
    `Нашли кнопку для "${currentSettings.showTitle}", свободно ≈ ${currentBest.available}`
  );
}

function findMatchingButtons(title, preferredDate, preferredTime) {
  const needles = title.trim().toLowerCase();
  if (!needles) return [];
  const timeNeedle = normalizeNeedle(preferredTime);
  const dateNeedle = normalizeNeedle(preferredDate);
  const dateNeedleSimple = stripPunctuation(dateNeedle);
  const buttons = Array.from(document.querySelectorAll("button, a"));
  return buttons
    .map((button) => {
      const text = button.textContent?.trim().toLowerCase() ?? "";
      if (!/купить|билеты/i.test(text)) {
        return null;
      }
      const container =
        button.closest("article, li, .event-card, .performance, .poster-card") ??
        button.parentElement;
      if (!container) return null;
      const rawChunk = container.textContent ?? "";
      const chunk = normalizeChunk(rawChunk);
      const chunkSimple = stripPunctuation(chunk);
      if (!chunk.includes(needles)) {
        return null;
      }
      if (timeNeedle && !chunk.includes(timeNeedle)) {
        return null;
      }
      if (dateNeedle && !(chunk.includes(dateNeedle) || chunkSimple.includes(dateNeedleSimple))) {
        return null;
      }
      return {
        button,
        available: extractFreeSeats(container.textContent)
      };
    })
    .filter(Boolean);
}

function extractFreeSeats(text) {
  const match = text.match(/(\d+)\s*(?:мест|билет)/i);
  if (!match) return 0;
  return Number(match[1]);
}

function triggerPurchase() {
  if (!currentBest?.button) {
    scanShows();
  }
  if (currentBest?.button) {
    logEvent("Отправляем клик по кнопке «Купить»");
    currentBest.button.click();
    setStatus("Нажали «Купить»", true);
  } else {
    setStatus("Кнопка не найдена", true);
    logEvent("Кнопка «Купить» не найдена");
  }
}

function setStatus(text, running = true) {
  chrome.runtime.sendMessage({
    type: "contentStatus",
    status: `[Shows] ${text}`,
    running
  });
}

function startScanTimer() {
  stopScanTimer();
  scanTimerId = window.setInterval(() => {
    if (!monitoringEnabled) return;
    scanShows();
  }, 1000);
}

function stopScanTimer() {
  if (scanTimerId) {
    clearInterval(scanTimerId);
    scanTimerId = null;
  }
}

function normalizeNeedle(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeChunk(text = "") {
  return String(text).toLowerCase().replace(/\s+/g, " ");
}

function stripPunctuation(text = "") {
  return text.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}

