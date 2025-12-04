if (window.__bolshoiShowDetailLoaded) {
  console.debug("[ShowDetail] Script already initialized, skipping");
} else {
  window.__bolshoiShowDetailLoaded = true;
  window.addEventListener("unload", () => {
    delete window.__bolshoiShowDetailLoaded;
  });

(() => {
const SEAT_SCAN_INTERVAL = 400;
const SEAT_REFRESH_INTERVAL = 1200;
const MODAL_CONTAINER_SELECTOR = [
  ".modal-main:not([aria-hidden='true'])",
  ".v-modal__box:not([aria-hidden='true'])",
  ".modal:not([aria-hidden='true'])"
].join(", ");
const MODAL_CLOSE_SELECTORS = [
  'button[aria-label="Close"]',
  'button[aria-label="Закрыть"]',
  ".modal__close",
  ".popup__close",
  ".notice__close",
  ".attention-popup__close",
  ".modal-main__close",
  ".modal-main_close",
  "[data-bs-dismiss='modal']",
  ".v-modal__box button.btn-close",
  ".modal button.btn-close",
  ".modal button.close",
  ".modal button",
  ".warning-popup button"
];

let settings = null;
let seatTimer = null;
let seatsLocked = false;
let seatData = null;
let fetchPatched = false;
let lastShowId = null;
let lastTariffId = null;
let modalWatcher = null;
let modalGuardPromise = null;
let seatSelectionScheduled = false;
let seatRefreshTimer = null;
let seatVerificationInProgress = false;
const rowStatsCache = new Map();
const ZONE_BASES = [
  { id: "parter", label: "Партер", pattern: /партер/i },
  { id: "amphi", label: "Амфитеатр", pattern: /амфитеатр/i },
  { id: "tier1", label: "1 ярус", pattern: /1\s*ярус/i },
  { id: "tier2", label: "2 ярус", pattern: /2\s*ярус/i },
  { id: "belEtage", label: "Бельэтаж", pattern: /бельэтаж/i },
  { id: "balcony", label: "Балкон / Галерея", pattern: /(балкон|галерея|3\s*ярус)/i }
];
const ZONE_VARIANTS = [
  { suffix: "Any", side: "any" },
  { suffix: "Center", side: "center" },
  { suffix: "Left", side: "left" },
  { suffix: "Right", side: "right" }
];
const ZONE_PRESETS = ZONE_BASES.flatMap((base) =>
  ZONE_VARIANTS.map((variant) => ({
    id: `${base.id}${variant.suffix}`,
    pattern: base.pattern,
    side: variant.side
  }))
);

bootstrap();

function logEvent(text) {
  chrome.runtime.sendMessage({
    action: "logEvent",
    source: "ShowDetail",
    text
  });
  console.log(`[ShowDetail] ${text}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.action) return;
  if (message.action === "stopMonitoring") {
    teardown();
    return;
  }
  if (message.action === "initMonitoring") {
    if (message.settings) {
      settings = message.settings;
    }
    resumeSeatSelection("message");
    return;
  }
  if (message.action === "pingShowScript") {
    sendResponse({ alive: true });
  }
});

async function bootstrap() {
  let response = null;
  try {
    response = await chrome.runtime.sendMessage({
      action: "pageReady",
      page: "show"
    });
  } catch (error) {
    logEvent(`Ошибка запроса pageReady: ${error?.message}`);
  }

  logEvent(`pageReady response: ${JSON.stringify(response)}`);
  await closeSafetyModal();
  enableModalWatcher();
  await waitForSeatIds();
  ensureSeatDataHooks();
  fetchSeatMapSnapshot();

  if (!response?.active || !response.settings) {
    logEvent("Нет активной сессии мониторинга");
    return;
  }

  settings = response.settings;
  setStatus("Страница спектакля открыта");
  startSeatWatcher();
}

async function closeSafetyModal(
  timeoutMs = 10000,
  { reason = "safety", waitForAppear = true } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let modal = getActiveModal();

  if (!modal && waitForAppear) {
    modal = await waitForModal(timeoutMs);
  }

  if (!modal) {
    logEvent("Предупреждение отсутствует");
    return false;
  }

  logEvent(`[ModalGuard] ${reason}: обнаружена модалка, пытаемся закрыть`);

  while (Date.now() < deadline) {
    const activeModal = getActiveModal();
    if (!activeModal) {
      logEvent(`[ModalGuard] ${reason}: модалка закрыта`);
      return true;
    }

    const closeBtn = findModalCloseButton(activeModal);
    if (closeBtn) {
      dispatchSyntheticClick(closeBtn);
    } else {
      sendEscapeKey(activeModal);
    }

    await waitForModalHidden(activeModal, 600);
  }

  logEvent(`[ModalGuard] ${reason}: не удалось закрыть модалку за ${timeoutMs} мс`);
  return false;
}

async function waitForModal(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const modal = getActiveModal();
    if (modal) {
      return modal;
    }
    await delay(100);
  }
  return null;
}

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") {
    return false;
  }
  return Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function getActiveModal() {
  return document.querySelector(MODAL_CONTAINER_SELECTOR);
}

function findModalCloseButton(modal) {
  for (const selector of MODAL_CLOSE_SELECTORS) {
    const btn = modal.querySelector(selector) || document.querySelector(selector);
    if (btn && isVisible(btn)) {
      return btn;
    }
  }
  return null;
}

function dispatchSyntheticClick(target) {
  if (!(target instanceof HTMLElement)) return;
  const eventOptions = { bubbles: true, cancelable: true };
  target.dispatchEvent(new MouseEvent("pointerdown", eventOptions));
  target.dispatchEvent(new MouseEvent("pointerup", eventOptions));
  target.dispatchEvent(new MouseEvent("click", eventOptions));
}

function sendEscapeKey(target) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
  );
}

async function waitForModalHidden(modal, timeout = 600) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (!modal.isConnected) return true;
    if (modal.getAttribute("aria-hidden") === "true") return true;
    const style = window.getComputedStyle(modal);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return true;
    }
    await delay(50);
  }
  return false;
}

function enableModalWatcher() {
  if (modalWatcher) {
    modalWatcher.disconnect();
  }
  modalWatcher = new MutationObserver(() => {
    if (modalGuardPromise || !getActiveModal()) {
      return;
    }
    scheduleModalGuard();
  });
  modalWatcher.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-hidden", "class", "style"]
  });
}

function scheduleModalGuard(reason = "mutation") {
  if (modalGuardPromise) return;
  modalGuardPromise = closeSafetyModal(6000, { reason, waitForAppear: false }).finally(() => {
    modalGuardPromise = null;
  });
}

function startSeatWatcher() {
  teardown();
  enableModalWatcher();
  seatTimer = window.setInterval(trySelectSeats, SEAT_SCAN_INTERVAL);
  scheduleSeatSelection("watcher-start");
}

function teardown() {
  if (seatTimer) {
    clearInterval(seatTimer);
    seatTimer = null;
  }
  if (seatRefreshTimer) {
    clearTimeout(seatRefreshTimer);
    seatRefreshTimer = null;
  }
  if (modalWatcher) {
    modalWatcher.disconnect();
    modalWatcher = null;
  }
  seatsLocked = false;
}

function scheduleSeatSelection(reason = "event") {
  if (seatSelectionScheduled || seatsLocked || !settings) {
    return;
  }
  seatSelectionScheduled = true;
  requestAnimationFrame(() => {
    logEvent(`Быстрый повтор подбора мест (${reason})`);
    trySelectSeats();
  });
}

async function verifySeatsBeforeContinue(selectedSeats) {
  if (seatVerificationInProgress) {
    return;
  }
  seatVerificationInProgress = true;
  const seatsSnapshot = Array.isArray(selectedSeats) ? selectedSeats : [];
  try {
    setStatus("Проверяем выбранные места перед продолжением");
    const updated = await fetchSeatMapSnapshot();
    const seatsSource = Array.isArray(updated) ? updated : seatData || [];
    const seatMap = new Map(
      seatsSource.map((seat) => [String(seat.seatId ?? seat.id ?? ""), seat])
    );
    const allHeld = seatsSnapshot.every((seat) => {
      const seatId = String(seat.seatId ?? seat.id ?? "");
      if (!seatId) return false;
      const actual = seatMap.get(seatId);
      if (!actual) return false;
      return actual.ticketState && actual.ticketState !== "free";
    });
    if (!allHeld) {
      setStatus("Часть мест заняли другие, повторяем поиск");
      seatsLocked = false;
      seatVerificationInProgress = false;
      scheduleSeatRefresh("seat-verify-failed");
      scheduleSeatSelection("seat-verify-failed");
      return;
    }
    if (seatRefreshTimer) {
      clearTimeout(seatRefreshTimer);
      seatRefreshTimer = null;
    }
    setStatus(`Выбраны ${seatsSnapshot.length} мест, переходим далее`);
    proceedToCheckout();
  } catch (error) {
    logEvent(`Ошибка проверки мест перед продолжением: ${error?.message}`);
    seatsLocked = false;
    scheduleSeatRefresh("seat-verify-error");
    scheduleSeatSelection("seat-verify-error");
  } finally {
    seatVerificationInProgress = false;
  }
}

function trySelectSeats() {
  seatSelectionScheduled = false;
  if (!settings || seatsLocked) {
    return;
  }
  if (!seatData || !seatData.length) {
    setStatus("Ожидаем данные схемы");
    return;
  }
  const availableSeats = collectAvailableSeatInfos();
  if (!availableSeats.length) {
    setStatus("Свободных мест нет, ждём обновления");
    scheduleSeatRefresh("no-free-seats");
    return;
  }
  const prioritized = scoreSeats(availableSeats);
  const seatsToPick = pickSeats(prioritized, settings.ticketCount);
  if (seatsToPick.length < settings.ticketCount) {
    setStatus("Недостаточно мест по приоритетам");
    scheduleSeatRefresh("not-enough-priority");
    return;
  }

  let successCount = 0;
  seatsToPick.forEach((seat) => {
    if (clickSeat(seat)) {
      successCount += 1;
    }
  });

  if (successCount === settings.ticketCount) {
    seatsLocked = true;
    verifySeatsBeforeContinue(seatsToPick);
  } else {
    setStatus("Не удалось кликнуть по части мест, ждём обновления");
    scheduleSeatRefresh("partial-click-failed");
  }
}

function scoreSeats(seats) {
  const enabledZones = getEnabledZonePresets();
  const preferredRowFilter = buildPreferredRowsFilter(settings?.preferredRows);
  return seats
    .map((seat) => {
      let score = 0;
      const rowNumber = parseNumber(seat.seatRow);
      const seatNumber = parseNumber(seat.seatNumber);

      if (enabledZones.length && !seatMatchesZones(seat, enabledZones)) {
        return null;
      }

      if (preferredRowFilter) {
        if (rowNumber == null || !preferredRowFilter(rowNumber)) {
          return null;
        }
        score += 500;
      }

      if (rowNumber != null) {
        score += Math.max(0, 300 - rowNumber * 5);
      }
      score -= Math.abs((seatNumber ?? 0) - 20);

      return { ...seat, rowNumber, seatNumber, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function pickSeats(sortedSeats, count) {
  if (count <= 1) {
    return sortedSeats.slice(0, count);
  }

  let bestGroup = null;
  let bestScore = -Infinity;
  const requireAdjacent = Boolean(settings?.requireAdjacentSeats);

  const grouped = sortedSeats.reduce((acc, seat) => {
    const key = `${seat.hallRegionName}|${seat.hallSideName}|${seat.seatRow}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(seat);
    return acc;
  }, {});

  Object.values(grouped).forEach((group) => {
    group.sort((a, b) => (a.seatNumber ?? 0) - (b.seatNumber ?? 0));
    for (let i = 0; i <= group.length - count; i += 1) {
      const slice = group.slice(i, i + count);
      const seatNumbers = slice.map((s) => s.seatNumber ?? null);
      const seatNumbersValid = seatNumbers.every(
        (num) => typeof num === "number" && Number.isFinite(num)
      );
      const isAdjacentCombo =
        seatNumbersValid &&
        seatNumbers.every((num, idx) => idx === 0 || num - seatNumbers[idx - 1] === 1);
      if (requireAdjacent && !isAdjacentCombo) {
        continue;
      }
      const numericSeats = seatNumbersValid ? seatNumbers : seatNumbers.map((n) => Number(n) || 0);
      const spread = Math.max(...numericSeats) - Math.min(...numericSeats);
      const sumScore = slice.reduce((sum, seat) => sum + seat.score, 0);
      const comboScore = sumScore - spread * 5;
      if (comboScore > bestScore) {
        bestScore = comboScore;
        bestGroup = slice;
      }
    }
  });

  if (bestGroup) return bestGroup;
  return sortedSeats.slice(0, count);
}

function clickSeat(seatInfo) {
  const node = findSeatNode(seatInfo);
  if (!node) {
    logEvent(`Не нашли DOM-узел для seatId ${seatInfo.seatId}`);
    return false;
  }
  const eventOptions = { bubbles: true, cancelable: true };
  node.dispatchEvent(new MouseEvent("pointerdown", eventOptions));
  node.dispatchEvent(new MouseEvent("pointerup", eventOptions));
  node.dispatchEvent(new MouseEvent("click", eventOptions));
  logEvent(
    `Клик по месту ${seatInfo.hallRegionName} ряд ${seatInfo.seatRow} место ${seatInfo.seatNumber}`
  );
  return true;
}

function findSeatNode(seatInfo) {
  const nodes = document.querySelectorAll("rect.seat");
  if (!nodes.length) {
    return null;
  }
  const targetX = Number(seatInfo.coordinates?.x ?? NaN);
  const targetY = Number(seatInfo.coordinates?.y ?? NaN);
  if (Number.isNaN(targetX) || Number.isNaN(targetY)) {
    return null;
  }
  let bestNode = null;
  let bestDistance = Infinity;
  nodes.forEach((node) => {
    const x = Number(node.getAttribute("x"));
    const y = Number(node.getAttribute("y"));
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    const distance = Math.abs(x - targetX) + Math.abs(y - targetY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestNode = node;
    }
  });
  return bestNode;
}

function getSeatRowKey(seat) {
  return `${seat.hallRegionName}|${seat.hallSideName}|${seat.seatRow}`;
}

function rebuildRowStats() {
  rowStatsCache.clear();
  if (!Array.isArray(seatData)) {
    return rowStatsCache;
  }
  seatData.forEach((seat) => {
    const x = Number(seat?.coordinates?.x);
    if (Number.isNaN(x)) {
      return;
    }
    const key = getSeatRowKey(seat);
    const stats = rowStatsCache.get(key) || { minX: x, maxX: x };
    stats.minX = Math.min(stats.minX, x);
    stats.maxX = Math.max(stats.maxX, x);
    rowStatsCache.set(key, stats);
  });
  return rowStatsCache;
}

function getSeatNormalizedX(seat) {
  const x = Number(seat?.coordinates?.x);
  if (Number.isNaN(x)) {
    return null;
  }
  const stats = rowStatsCache.get(getSeatRowKey(seat));
  if (!stats || stats.maxX <= stats.minX) {
    return null;
  }
  return (x - stats.minX) / (stats.maxX - stats.minX);
}

function getEnabledZonePresets() {
  if (!settings?.seatZones) {
    return [];
  }
  return ZONE_PRESETS.filter((preset) => settings.seatZones[preset.id]);
}

function seatMatchesZones(seat, zonePresets) {
  if (!zonePresets.length) {
    return true;
  }
  const region = normalizeString(seat?.hallRegionName);
  const sideName = normalizeString(seat?.hallSideName);
  const normalizedX = getSeatNormalizedX(seat);
  return zonePresets.some(
    (preset) =>
      preset.pattern.test(region) && matchesZoneSide(preset.side, normalizedX, sideName)
  );
}

function matchesZoneSide(side, normalizedX, sideName) {
  if (side === "any") {
    return true;
  }
  const name = sideName || "";
  if (name) {
    if (side === "left") {
      if (/лев/.test(name)) return true;
      if (/прав/.test(name)) return false;
    }
    if (side === "right") {
      if (/прав/.test(name)) return true;
      if (/лев/.test(name)) return false;
    }
    if (side === "center") {
      if (/центр/.test(name)) return true;
      if (/лев|прав/.test(name)) return false;
    }
  }
  if (normalizedX != null) {
    if (side === "center") {
      return normalizedX >= 0.32 && normalizedX <= 0.68;
    }
    if (side === "left") {
      return normalizedX < 0.34;
    }
    if (side === "right") {
      return normalizedX > 0.66;
    }
  }
  return side === "center" ? true : false;
}

function buildPreferredRowsFilter(raw) {
  if (!raw) {
    return null;
  }
  const tokens = String(raw)
    .split(/[,;]/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) {
    return null;
  }
  const ranges = [];
  tokens.forEach((token) => {
    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const from = Number(rangeMatch[1]);
      const to = Number(rangeMatch[2]);
      if (!Number.isNaN(from) && !Number.isNaN(to)) {
        ranges.push({ min: Math.min(from, to), max: Math.max(from, to) });
      }
      return;
    }
    const singleMatch = token.match(/^(\d+)$/);
    if (singleMatch) {
      const value = Number(singleMatch[1]);
      if (!Number.isNaN(value)) {
        ranges.push({ min: value, max: value });
      }
    }
  });
  if (!ranges.length) {
    return null;
  }
  return (rowNumber) =>
    typeof rowNumber === "number" &&
    ranges.some((range) => rowNumber >= range.min && rowNumber <= range.max);
}

function collectAvailableSeatInfos() {
  if (!Array.isArray(seatData)) return [];
  return seatData.filter(
    (seat) => seat.ticketState === "free" && seat.ticketPrice > 0
  );
}

function parseNumber(value) {
  if (value == null) return null;
  const match = String(value).match(/-?\d+/);
  return match ? Number(match[0]) : null;
}

function normalizeString(text) {
  return (text || "").toLowerCase();
}

function ensureSeatDataHooks() {
  if (fetchPatched) return;
  fetchPatched = true;

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch.apply(window, args);
    processSeatResponse(getRequestUrl(args[0]), response.clone());
    return response;
  };

  const originalOpen = window.XMLHttpRequest.prototype.open;
  const originalSend = window.XMLHttpRequest.prototype.send;

  window.XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    this.__bolshoiUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  window.XMLHttpRequest.prototype.send = function send(...args) {
    this.addEventListener("load", () => {
      if (this.readyState === 4) {
        tryProcessSeatText(this.__bolshoiUrl, this.responseText);
      }
    });
    return originalSend.apply(this, args);
  };
}

async function processSeatResponse(url, response) {
  if (!/seats/i.test(url || "")) return;
  updateLastIdsFromUrl(url);
  try {
    const json = await response.json();
    cacheSeatData(json);
  } catch (error) {
  }
}

function tryProcessSeatText(url, text) {
  if (!/seats/i.test(url || "")) return;
  updateLastIdsFromUrl(url);
  try {
    const json = JSON.parse(text);
    cacheSeatData(json);
  } catch (error) {
  }
}

function cacheSeatData(payload) {
  const seats = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.seats)
    ? payload.seats
    : null;
  if (!seats) return;
  seatData = seats;
  rebuildRowStats();
  logEvent(`Получены данные о ${seats.length} местах`);
  scheduleSeatSelection("seat-data");
}

function getRequestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof Request) return input.url;
  return "";
}

async function fetchSeatMapSnapshot() {
  const { showId, tariffId } = await extractShowAndTariff();
  if (!showId || !tariffId) {
    logEvent("Не удалось определить ID спектакля или тарифа");
    return null;
  }
  logEvent(`Запрашиваем схему seats для show=${showId} tariff=${tariffId}`);
  const url = `${location.origin}/api/v1/client/shows/${showId}/tariffs/${tariffId}/seats`;
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      logEvent(`Ошибка загрузки схемы: ${response.status}`);
      return null;
    }
    const data = await response.json();
    cacheSeatData(data);
    return seatData;
  } catch (error) {
    logEvent(`Ошибка запроса схемы: ${error?.message}`);
    return null;
  }
}

function scheduleSeatRefresh(reason = "auto") {
  if (seatRefreshTimer) {
    return;
  }
  seatRefreshTimer = setTimeout(() => {
    seatRefreshTimer = null;
    logEvent(`Запрашиваем обновление схемы (${reason})`);
    fetchSeatMapSnapshot();
  }, SEAT_REFRESH_INTERVAL);
}

async function extractShowAndTariff() {
  const showMatch = location.pathname.match(/\/show\/(\d+)/);
  let showId = showMatch ? showMatch[1] : null;
  if (showId) {
    lastShowId = showId;
  }
  await waitForSeatIds();
  let tariffId = findTariffIdInDom();

  if (!tariffId) {
    tariffId = await fetchTariffIdFromApi(showId);
  }

  if (!tariffId && lastTariffId) {
    tariffId = lastTariffId;
  }
  if (!showId && lastShowId) {
    showId = lastShowId;
  }

  logEvent(`Идентификаторы: showId=${showId ?? "?"}, tariffId=${tariffId ?? "?"}`);
  return { showId, tariffId };
}

function findTariffIdInDom() {
  const option = document.querySelector(".vs__dropdown-option.vs__dropdown-option--selected");
  if (option) {
    const attr = option.getAttribute("data-value") || option.dataset?.value;
    const match = attr ? String(attr).match(/(\d{6,})/) : null;
    if (match) {
      lastTariffId = match[1];
      return match[1];
    }
  }
  const input = document.getElementById("tariffSelect");
  if (input?.value) {
    const match = input.value.match(/(\d{6,})/);
    if (match) {
      lastTariffId = match[1];
      return match[1];
    }
  }
  return null;
}

async function fetchTariffIdFromApi(showId) {
  if (!showId) return null;
  try {
    const url = `${location.origin}/api/v1/client/shows/${showId}/tariffs`;
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      return null;
    }
    const tariffs = await response.json();
    if (!Array.isArray(tariffs) || !tariffs.length) return null;
    const selectedTitle = document
      .querySelector(".vs__selected")
      ?.textContent?.trim()
      ?.toLowerCase();
    if (selectedTitle) {
      const match = tariffs.find((t) =>
        (t.name || "").toLowerCase().includes(selectedTitle)
      );
      if (match?.id) {
        lastTariffId = String(match.id);
        return String(match.id);
      }
    }
    lastTariffId = String(tariffs[0].id);
    return lastTariffId;
  } catch (error) {
    return null;
  }
}

function updateLastIdsFromUrl(url = "") {
  const match = url.match(/shows\/(\d+)\/tariffs\/(\d+)/i);
  if (match) {
    lastShowId = match[1];
    lastTariffId = match[2];
  }
}

function extractIdsFromPerformance() {
  const entries = performance.getEntriesByType("resource");
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const url = entries[i].name;
    if (!/seats/i.test(url)) continue;
    const match = url.match(/shows\/(\d+)\/tariffs\/(\d+)/i);
    if (match) {
      lastShowId = match[1];
      lastTariffId = match[2];
      logEvent(
        `Нашли IDs в performance: show=${lastShowId}, tariff=${lastTariffId}`
      );
      return true;
    }
  }
  return false;
}

async function waitForSeatIds(timeoutMs = 4000) {
  const start = Date.now();
  if (extractIdsFromPerformance() && lastTariffId) {
    return true;
  }
  return new Promise((resolve) => {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (const entry of entries) {
        if (/seats/i.test(entry.name) && extractIdsFromPerformance()) {
          observer.disconnect();
          resolve(true);
          return;
        }
      }
    });
    observer.observe({ entryTypes: ["resource"] });
    const interval = setInterval(() => {
      if (extractIdsFromPerformance() && lastTariffId) {
        clearInterval(interval);
        observer.disconnect();
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        observer.disconnect();
        resolve(false);
      }
    }, 200);
  });
}

function proceedToCheckout() {
  const continueButton = Array.from(document.querySelectorAll("button, a")).find(
    (btn) => /продолжить/i.test(btn.textContent || "")
  );
  if (continueButton) {
    setTimeout(() => continueButton.click(), 300);
  } else {
    setStatus("Не нашли кнопку «Продолжить»");
  }
}

function setStatus(text) {
  logEvent(text);
  chrome.runtime.sendMessage({
    type: "contentStatus",
    status: `[Show] ${text}`,
    running: true
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resumeSeatSelection(reason = "manual") {
  if (!settings) {
    logEvent("[Resume] Нет настроек, пропускаем повторный запуск");
    return;
  }
  logEvent(`[Resume] Перезапускаем подбор мест (${reason})`);
  await closeSafetyModal(4000, { reason: `resume-${reason}`, waitForAppear: false });
  ensureSeatDataHooks();
  fetchSeatMapSnapshot();
  startSeatWatcher();
}

})();

}
