if (window.__bolshoiCheckoutLoaded) {
  console.debug("[Checkout] Script already initialized, skipping");
} else {
  window.__bolshoiCheckoutLoaded = true;
  window.addEventListener("unload", () => {
    delete window.__bolshoiCheckoutLoaded;
  });

(() => {
function logEvent(text) {
  chrome.runtime.sendMessage({
    action: "logEvent",
    source: "Checkout",
    text
  });
  console.log(`[Checkout] ${text}`);
}

function markTiming(label) {
  if (automationStartedAt == null) return;
  const delta = ((performance.now() - automationStartedAt) / 1000).toFixed(2);
  logEvent(`[Timing] ${label} (+${delta}s)`);
}

let checkoutSettings = null;
let automationActive = false;
const MODAL_CONTAINER_SELECTOR = [
  ".modal-main:not([aria-hidden='true'])",
  ".v-modal__box:not([aria-hidden='true'])",
  ".modal:not([aria-hidden='true'])"
].join(", ");
const MODAL_CLOSE_SELECTORS = [
  ".modal-main__close",
  ".modal-main_close",
  ".modal-main__actions button",
  ".modal-main__footer button",
  ".modal__close",
  ".popup__close",
  ".warning-popup button",
  "[data-bs-dismiss='modal']",
  'button[aria-label="Закрыть"]',
  'button[aria-label="Close"]',
  ".v-modal__box button.btn-close",
  ".modal button.btn-close",
  ".modal button.close",
  ".modal button"
];
const MODAL_BACKDROP_SELECTORS = [
  ".modal-backdrop",
  ".modal-main__overlay",
  ".v-overlay",
  ".v-modal__mask",
  ".v-modal__backdrop"
];
let modalWatcher = null;
let modalGuardPromise = null;
let modalGuardPauseDepth = 0;
let passengerFormRecoveryAt = 0;
let passengerStepNavigationInProgress = false;
let passengerDataConfirmed = false;
const PASSENGER_INPUT_SELECTOR =
  ".ticket_input input[type='text'], .ticket__form input[type='text'], .ticket_content input[type='text'], input.ticket__input-text";
const DOCUMENT_FIELD_KEYWORDS = /документ|паспорт|удостовер|серия|номер|identity|travel|id/i;
const PASSENGER_SCOPE_SELECTORS = [
  ".ticket__form",
  ".ticket_content",
  ".ticket_input",
  ".ticket__user-fio",
  ".ticket_user-fio",
  "li.event__ticket",
  "li.event_ticket",
  "li.event-ticket"
];
const PASSENGER_HIDDEN_INPUT_SELECTOR = PASSENGER_SCOPE_SELECTORS.map(
  (selector) => `${selector} input`
).join(", ");
const ORDER_STEPS_SELECTOR = ".order__steps, .order_steps, .order-steps";
const BASKET_TICKETS_SELECTOR =
  ".basket__tickets, .basket_tickets, .order-basket, .order__tickets, .order__basket";
const PASSENGER_CONTAINER_SELECTOR =
  ".ticket__user-fio, .ticket_user-fio, .ticket__form, .ticket_content, .ticket_input";
const PASSENGER_WAIT_TIMEOUT = 15000;
const PAYMENT_URL_REGEX = /(payment|pay-button|order|checkout|basket)/i;
let uiMutationWatcher = null;
let passengerInputWaiters = new Set();
let passengerInputsNotified = false;
let currentCheckoutStep = 0;
let passengerBoostAttempted = false;
let lastCardExpandAt = 0;
let automationStartedAt = null;
let paymentButtonWaiters = new Set();
let paymentButtonNotified = false;
let paymentHooksEnabled = false;
const cardFieldSnapshot = new Map();

bootstrap();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.action) return;
  if (message.action === "stopMonitoring") {
    automationActive = false;
    if (modalWatcher) {
      modalWatcher.disconnect();
      modalWatcher = null;
    }
    disableUiObservers();
    cleanupPassengerWaiters();
    cleanupPaymentWaiters();
  }
  if (message.action === "pingCheckoutScript") {
    sendResponse({ alive: true });
  }
});

async function bootstrap() {
  const response = await chrome.runtime.sendMessage({
    action: "pageReady",
    page: "checkout"
  });
  if (!response?.active || !response.settings) {
    logEvent("Нет активной сессии, шаг checkout пропущен");
    return;
  }

  logEvent("Получены настройки для заполнения checkout");
  checkoutSettings = response.settings;
  automationActive = true;
  automationStartedAt = performance.now();
  enableModalWatcher();
  enableUiObservers();
  ensurePaymentRequestHooks();
  markTiming("bootstrap");
  runAutomation();
}

async function runAutomation() {
  try {
    logEvent("Старт автоматизации checkout");
    markTiming("automation-start");
    await closeWarningModal(10000, {
      reason: "initial-modal",
      appearWaitMs: 0,
      skipIfAbsent: true
    });
    await handleStepOne();
    markTiming("step1-complete");
    await handleStepTwo();
    markTiming("step2-complete");
    await handleStepThree();
    markTiming("step3-complete");
    markTiming("automation-finished");
    setStatus("Данные заполнены, переход к оплате");
  } catch (error) {
    setStatus(`Ошибка: ${error.message}`);
    logEvent(`Ошибка checkout: ${error.message}`);
  }
}

async function handleStepOne() {
  logEvent("Этап 1: подтверждение выбранных билетов");
  await closeWarningModal(8000, { reason: "step1-before-continue", waitForAppear: false });
  await clickButtonByText("Продолжить");
  await closeWarningModal(8000, { reason: "step1-after-continue", waitForAppear: false });
}

async function handleStepTwo(options = {}) {
  const { skipFill = false } = options;
  cardFieldSnapshot.clear();
  logEvent("Этап 2: заполнение данных посетителя");
  await closeWarningModal(8000, { reason: "step2-before-forms", waitForAppear: false });
  passengerInputsNotified = false;
  passengerBoostAttempted = false;
  await waitForPassengerInputs();
  await enforceTicketCountLimit();
  markTiming("passenger-inputs-ready");
  const docsInfo = prepareDocumentValues();
  if (!skipFill) {
    await fillPassengerNames(docsInfo);
    markTiming("passenger-names-filled");
    if (docsInfo.hasValues) {
      await verifyPassengerDocuments();
      markTiming("passenger-docs-filled");
    }
  } else {
    await verifyPassengerNames();
    logEvent("ФИО уже заполнены, пропускаем ввод");
    markTiming("passenger-names-verified");
    if (docsInfo.hasValues) {
      await verifyPassengerDocuments();
      markTiming("passenger-docs-verified");
    }
  }
  await closeWarningModal(8000, { reason: "step2-before-continue", waitForAppear: false });
  await clickButtonByText("Продолжить");
  await closeWarningModal(8000, { reason: "step2-after-continue", waitForAppear: false });
  passengerDataConfirmed = true;
}

async function handleStepThree() {
  logEvent("Этап 3: подтверждение заказа");
  await closeWarningModal(8000, { reason: "step3-before-agreement", waitForAppear: false });
  await acceptAgreement();
  await closeWarningModal(8000, { reason: "step3-before-payment", waitForAppear: false });
  await ensurePaymentButtonReady();
  await closeWarningModal(8000, { reason: "step3-after-payment", waitForAppear: false });
}

async function ensurePaymentButtonReady() {
  const button = await waitForPaymentButton(900);
  if (button) return;
  logEvent("Кнопка «Оплатить» не появилась, возвращаемся на предыдущий шаг");
  const navigationHappened = await navigateBackToPassengerStep();
  if (!navigationHappened) {
    logEvent("Не удалось перейти назад, пробуем снова найти кнопку «Оплатить»");
    await waitForPaymentButton(600);
    return;
  }
  const quickButton = await waitForPaymentButton(600);
  if (quickButton) return;
  await closeWarningModal(2000, { reason: "step3-retry-before-payment", waitForAppear: false });
  await waitForPaymentButton(1200);
}

async function waitForPaymentButton(timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const paymentButton = findPaymentButton();
    if (paymentButton) {
      notifyPaymentButtonReady("polling", paymentButton);
      return paymentButton;
    }
    const remaining = timeout - (Date.now() - start);
    if (remaining <= 0) break;
    const signal = await waitForPaymentButtonSignal(Math.min(400, remaining));
    if (signal) {
      return signal;
    }
  }
  return null;
}

function findPaymentButton() {
  return Array.from(
    document.querySelectorAll("button, a, input[type='submit'], input[type='button']")
  ).find((el) => /оплат/i.test((el.textContent || el.value || "").trim()));
}

async function navigateBackToPassengerStep() {
  const backButton = findBackButtonToPassengerStep();
  if (backButton) {
    passengerFormRecoveryAt = Date.now();
    passengerStepNavigationInProgress = true;
    dispatchSyntheticClick(backButton);
    await wait(120);
    resetPaymentButtonTracking();
    return true;
  }
  return false;
}

function ensureButtonVisible(button) {
  if (!(button instanceof HTMLElement)) return;
  const rect = button.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    button.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function closeWarningModal(
  timeoutMs = 8000,
  { reason = "manual", waitForAppear = true, appearWaitMs, skipIfAbsent = false } = {}
) {
  const deadline = Date.now() + timeoutMs;
  let modal = getVisibleModal();

  if (!modal && waitForAppear) {
    const waitMs =
      typeof appearWaitMs === "number" && appearWaitMs >= 0 ? appearWaitMs : timeoutMs;
    if (waitMs > 0) {
      modal = await waitForElement(MODAL_CONTAINER_SELECTOR, waitMs);
    }
  }

  if (!modal) {
    return !skipIfAbsent;
  }

  logEvent(`[ModalGuard] ${reason}: обнаружено модальное окно`);

  while (Date.now() < deadline) {
    const activeModal = getVisibleModal();
    if (!activeModal) {
      logEvent(`[ModalGuard] ${reason}: окно закрыто`);
      return true;
    }

    const closeBtn = findModalCloseButton(activeModal);
    if (closeBtn) {
      dispatchSyntheticClick(closeBtn);
    } else {
      const backdrop = findModalBackdrop(activeModal);
      if (backdrop) {
        dispatchSyntheticClick(backdrop);
      }
      sendEscapeKey(activeModal);
    }

    await waitForModalHidden(activeModal, 600);
  }

  logEvent(`[ModalGuard] ${reason}: не удалось закрыть окно за ${timeoutMs} мс`);
  return false;
}

function getVisibleModal() {
  return document.querySelector(MODAL_CONTAINER_SELECTOR);
}

function findModalCloseButton(modal) {
  for (const selector of MODAL_CLOSE_SELECTORS) {
    const btn = modal.querySelector(selector) || document.querySelector(selector);
    if (isElementVisible(btn)) {
      return btn;
    }
  }
  return null;
}

function findModalBackdrop(modal) {
  if (!(modal instanceof HTMLElement)) return null;
  for (const selector of MODAL_BACKDROP_SELECTORS) {
    const node = modal.querySelector(selector) || document.querySelector(selector);
    if (isElementVisible(node)) {
      return node;
    }
  }
  return null;
}

function isElementVisible(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.visibility === "hidden" || style.display === "none") {
    return false;
  }
  return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
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
    await wait(50);
  }
  return false;
}

function enableModalWatcher() {
  if (modalWatcher) {
    modalWatcher.disconnect();
  }
  modalWatcher = new MutationObserver(() => {
    if (!automationActive || modalGuardPauseDepth > 0) {
      return;
    }
    if (getVisibleModal()) {
      scheduleModalSweep("mutation");
    }
  });
  modalWatcher.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-hidden", "class", "style"]
  });
  scheduleModalSweep("watcher-start");
}

function scheduleModalSweep(reason = "mutation") {
  if (!automationActive || modalGuardPauseDepth > 0) return;
  if (modalGuardPromise) return;
  modalGuardPromise = closeWarningModal(6000, { reason, waitForAppear: false }).finally(() => {
    modalGuardPromise = null;
  });
}

function enableUiObservers() {
  if (uiMutationWatcher) {
    uiMutationWatcher.disconnect();
  }
  if (!document.body) {
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        enableUiObservers();
      },
      { once: true }
    );
    return;
  }
  uiMutationWatcher = new MutationObserver(() => {
    handleUiMutation();
  });
  const targets = [
    document.body,
    document.querySelector(ORDER_STEPS_SELECTOR),
    document.querySelector(BASKET_TICKETS_SELECTOR)
  ].filter(Boolean);
  targets.forEach((node) => {
    uiMutationWatcher.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-step", "aria-hidden"]
    });
  });
  if (!targets.length) {
    uiMutationWatcher.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-step", "aria-hidden"]
    });
  }
  handleUiMutation();
}

function disableUiObservers() {
  if (uiMutationWatcher) {
    uiMutationWatcher.disconnect();
    uiMutationWatcher = null;
  }
}

function ensurePaymentRequestHooks() {
  if (paymentHooksEnabled) return;
  paymentHooksEnabled = true;
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch.apply(window, args);
    trySchedulePaymentScan(getRequestUrl(args[0]));
    return response;
  };

  const originalOpen = window.XMLHttpRequest.prototype.open;
  const originalSend = window.XMLHttpRequest.prototype.send;
  window.XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    this.__bolshoiCheckoutUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  window.XMLHttpRequest.prototype.send = function send(...sendArgs) {
    this.addEventListener("load", () => {
      if (this.readyState === 4) {
        trySchedulePaymentScan(this.__bolshoiCheckoutUrl);
      }
    });
    return originalSend.apply(this, sendArgs);
  };
}

function trySchedulePaymentScan(url) {
  if (!url || !PAYMENT_URL_REGEX.test(String(url))) return;
  schedulePaymentScan("api");
}

function schedulePaymentScan(reason = "api") {
  if (!automationActive) return;
  if (currentCheckoutStep !== 3) return;
  requestAnimationFrame(() => checkPaymentButton(reason));
}

function handleUiMutation() {
  if (!automationActive) return;
  const detectedStep = normalizeDetectedStep(detectCheckoutStep());
  if (detectedStep && detectedStep !== currentCheckoutStep) {
    currentCheckoutStep = detectedStep;
    logEvent(`[UI] Активирован шаг ${detectedStep}`);
    markTiming(`step${detectedStep}-visible`);
    resetPaymentButtonTracking();
    if (detectedStep === 2) {
      passengerInputsNotified = false;
      passengerBoostAttempted = false;
    }
  }
  if (currentCheckoutStep === 2) {
    maybeExpandTicketCards("mutation");
    if (hasPassengerInputs()) {
      notifyPassengerInputsReady("observer");
    }
  }
  if (currentCheckoutStep === 3) {
    checkPaymentButton("mutation");
  }
}

function detectCheckoutStep() {
  if (isConfirmationStepVisible()) {
    return 3;
  }
  if (document.querySelector(PASSENGER_CONTAINER_SELECTOR) || hasPassengerInputs()) {
    return 2;
  }
  return 1;
}

function maybeExpandTicketCards(reason = "mutation") {
  if (currentCheckoutStep !== 2) return;
  const now = Date.now();
  if (now - lastCardExpandAt < 250) return;
  const cards = collectTicketCards();
  if (!cards.length) return;
  let expanded = 0;
  for (const card of cards) {
    if (card.querySelector(PASSENGER_INPUT_SELECTOR)) {
      continue;
    }
    const trigger = findCardEditTrigger(card);
    if (trigger) {
      dispatchSyntheticClick(trigger);
      expanded += 1;
    }
  }
  if (expanded) {
    lastCardExpandAt = now;
    logEvent(`[UI] Раскрываем ${expanded} карточек (${reason})`);
  }
}

function waitForPassengerInputMutation(timeout = 400) {
  if (hasPassengerInputs()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const entry = {
      resolve,
      timer: setTimeout(() => {
        passengerInputWaiters.delete(entry);
        resolve(false);
      }, timeout)
    };
    passengerInputWaiters.add(entry);
  });
}

function notifyPassengerInputsReady(reason = "observer") {
  if (!hasPassengerInputs()) return;
  if (!passengerInputsNotified) {
    logEvent(`[UI] Форма ФИО готова (${reason})`);
    passengerInputsNotified = true;
  }
  passengerInputWaiters.forEach((entry) => {
    clearTimeout(entry.timer);
    entry.resolve(true);
  });
  passengerInputWaiters.clear();
}

function cleanupPassengerWaiters() {
  passengerInputWaiters.forEach((entry) => {
    clearTimeout(entry.timer);
    entry.resolve(false);
  });
  passengerInputWaiters.clear();
}

function waitForPaymentButtonSignal(timeout = 400) {
  const button = findPaymentButton();
  if (button) {
    return Promise.resolve(button);
  }
  return new Promise((resolve) => {
    const entry = {
      resolve,
      timer: setTimeout(() => {
        paymentButtonWaiters.delete(entry);
        resolve(null);
      }, timeout)
    };
    paymentButtonWaiters.add(entry);
  });
}

function notifyPaymentButtonReady(reason = "observer", button) {
  const target = button || findPaymentButton();
  if (!target) return;
  if (!paymentButtonNotified) {
    logEvent(`[UI] Кнопка «Оплатить» готова (${reason})`);
    paymentButtonNotified = true;
    markTiming("payment-button-ready");
  }
  ensureButtonVisible(target);
  paymentButtonWaiters.forEach((entry) => {
    clearTimeout(entry.timer);
    entry.resolve(target);
  });
  paymentButtonWaiters.clear();
}

function cleanupPaymentWaiters() {
  paymentButtonWaiters.forEach((entry) => {
    clearTimeout(entry.timer);
    entry.resolve(null);
  });
  paymentButtonWaiters.clear();
}

function resetPaymentButtonTracking() {
  cleanupPaymentWaiters();
  paymentButtonNotified = false;
}

function checkPaymentButton(reason = "mutation") {
  const button = findPaymentButton();
  if (button) {
    notifyPaymentButtonReady(reason, button);
  }
}

function getRequestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof Request) return input.url;
  if (input && typeof input === "object" && "url" in input) {
    return input.url;
  }
  return "";
}

async function attemptPassengerStepSprint(reason = "passenger-wait") {
  if (isConfirmationStepVisible()) return false;
  const continueBtn = findContinueButtonForSprint();
  if (!continueBtn) return false;
  logEvent(`[StepBoost] ${reason}: пробуем проскочить на шаг 3 и вернуться`);
  dispatchSyntheticClick(continueBtn);
  const moved = await waitForCondition(() => isConfirmationStepVisible(), 1500).catch(() => false);
  if (!moved) {
    return false;
  }
  const backButton = findBackButtonToPassengerStep();
  if (backButton) {
    dispatchSyntheticClick(backButton);
    await wait(600);
    logEvent(`[StepBoost] ${reason}: вернулись к шагу 2`);
    passengerStepNavigationInProgress = true;
    return true;
  }
  return false;
}

function findContinueButtonForSprint() {
  return Array.from(
    document.querySelectorAll("button, a, input[type='button'], input[type='submit']")
  ).find((el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest("[aria-hidden='true']")) return false;
    if (el.disabled) return false;
    if (!isElementVisible(el)) return false;
    const label = normalizeText(el.textContent || el.value || "");
    return /продолж/i.test(label);
  });
}

async function withModalGuardPaused(task) {
  modalGuardPauseDepth += 1;
  try {
    return await task();
  } finally {
    modalGuardPauseDepth = Math.max(0, modalGuardPauseDepth - 1);
    if (modalGuardPauseDepth === 0) {
      scheduleModalSweep("guard-resume");
    }
  }
}

async function acceptAgreement() {
  await withModalGuardPaused(async () => {
    let checkbox = await waitForCheckbox();
    if (checkbox?.checked) {
      logEvent("Соглашение уже подтверждено");
      return;
    }
    logEvent("Открываем соглашение для подтверждения");
    const label =
      (await waitForElement(
        "label[for='agreeWithRules-chkbx'], label[for='agreeWithRules-chbx'], .basket__button--rules label",
        5000
      )) || document.querySelector(".basket__button--rules");
    if (label instanceof HTMLElement) {
      label.click();
    } else {
      throw new Error("Не нашли лейбл соглашения");
    }
    const modal = await waitForElement(MODAL_CONTAINER_SELECTOR, 5000);
    if (!modal) {
      throw new Error("Не появилось окно соглашения");
    }
    scrollModalToBottom(modal);
    const acceptBtn = Array.from(
      modal.querySelectorAll("button, .btn, .modal__button")
    ).find((btn) => /принять/i.test(btn.textContent || ""));
    if (!acceptBtn) {
      throw new Error("Не нашли кнопку «Принять»");
    }
    acceptBtn.click();
    await wait(400);
    checkbox = await waitForCheckbox();
    if (checkbox && !checkbox.checked) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
    logEvent("Соглашение подтверждено");
  });
}

function findAgreementCheckbox() {
  const selectors = [
    "#agreeWithRules-chkbx",
    "#agreeWithRules-chbx",
    "input[type='checkbox'][name*='agree' i]",
    "input[type='checkbox'][id*='agree' i]"
  ];
  for (const selector of selectors) {
    const input = document.querySelector(selector);
    if (input) {
      return input;
    }
  }
  const label = document.querySelector(
    "label[for='agreeWithRules-chkbx'], label[for='agreeWithRules-chbx'], .basket__button--rules label"
  );
  if (label) {
    logEvent("Пытаемся кликнуть по лейблу соглашения");
    label.click();
    return (
      document.querySelector("#agreeWithRules-chkbx") ||
      document.querySelector("#agreeWithRules-chbx")
    );
  }
  return null;
}

async function waitForCheckbox(timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const checkbox = findAgreementCheckbox();
    if (checkbox) {
      return checkbox;
    }
    await wait(100);
  }
  return null;
}

function scrollModalToBottom(modal) {
  if (!modal) return;
  modal.scrollTop = modal.scrollHeight;
}

async function waitForPassengerInputs() {
  const start = Date.now();
  while (Date.now() - start < PASSENGER_WAIT_TIMEOUT) {
    await ensurePassengerStepVisible();
    if (hasPassengerInputs()) {
      passengerStepNavigationInProgress = false;
      notifyPassengerInputsReady("direct-detect");
      return;
    }
    const cards = collectTicketCards();
    if (cards.length) {
      const input = await ensureCardInput(cards[0]);
      if (input) {
        passengerStepNavigationInProgress = false;
        notifyPassengerInputsReady("card-open");
        return;
      }
    }
    if (!passengerBoostAttempted && Date.now() - start > 800) {
      passengerBoostAttempted = true;
      await attemptPassengerStepSprint("fio-delay");
    }
    await waitForPassengerInputMutation(400);
  }
  throw new Error("Не удалось открыть форму для ввода ФИО");
}

async function fillPassengerNames(docInfo) {
  await ensurePassengerStepVisible();
  const cards = collectTicketCards();
  if (!cards.length) {
    throw new Error("Не найдены карточки билетов для ФИО");
  }
  await enforceTicketCountLimit(cards);
  const names = checkoutSettings.passengerNames.slice();
  const fallbackName =
    names.find((name) => Boolean(name)) || checkoutSettings.showTitle || "Зритель";
  const fallbackCount = cards.length || names.length || checkoutSettings.ticketCount || 1;
  const plannedCount = checkoutSettings.ticketCount || fallbackCount;
  const expectedCount = Math.max(1, Math.min(plannedCount, fallbackCount));

  const hiddenFilled = fillHiddenPassengerInputs(expectedCount, names, fallbackName);
  if (hiddenFilled >= expectedCount) {
    if (await tryVerifyPassengerNames()) {
      logEvent(`[FastFio] Заполнили ФИО без раскрытия карточек (${hiddenFilled} мест)`);
      passengerDataConfirmed = true;
      return;
    }
    logEvent("[FastFio] Проверка скрытых полей не удалась, раскрываем карточки");
  }

  const ensured = await enforcePassengerNames(
    expectedCount,
    names,
    fallbackName,
    docInfo
  );
  if (ensured == null) {
    throw new Error("Не удалось заполнить ФИО");
  }
  logEvent(`Заполнили ФИО (${ensured} мест)`);
  passengerDataConfirmed = true;
}

function fillHiddenPassengerInputs(expectedCount, names, fallbackName) {
  const inputs = collectHiddenPassengerInputs();
  if (!inputs.length) {
    return 0;
  }
  const limit = Math.min(expectedCount, inputs.length);
  let filled = 0;
  for (let index = 0; index < limit; index += 1) {
    const input = inputs[index];
    const name = names[index] || fallbackName;
    if (!name) continue;
    setPassengerInputValue(input, name);
    filled += 1;
  }
  return filled;
}

function prepareDocumentValues() {
  const docs =
    (checkoutSettings.passengerDocs ||
      checkoutSettings.passengerIds ||
      []).map((value) => (value || "").trim());
  return {
    values: docs,
    hasValues: docs.some((value) => Boolean(value && value.length > 0))
  };
}

function resolveDocumentValue(index, docs) {
  if (!Array.isArray(docs) || !docs.length) return "";
  if (docs[index] && docs[index].trim()) {
    return docs[index].trim();
  }
  return "";
}

async function enforcePassengerNames(expectedCount, names, fallbackName, docInfo) {
  const limit = Math.max(1, expectedCount);
  const pending = new Set(Array.from({ length: limit }, (_, idx) => idx));
  const maxPasses = Math.max(4, limit);
  const hasDocs = Boolean(docInfo?.hasValues);
  const docValues = hasDocs ? docInfo.values : [];

  for (let pass = 0; pass < maxPasses && pending.size; pass += 1) {
    await ensurePassengerStepVisible();
    const cards = collectTicketCards();
    for (const index of Array.from(pending)) {
      const card = cards[index];
      if (!card?.isConnected) {
        continue;
      }
      const cardKey = getTicketCardKey(card);
      const desiredName = sanitizePassengerName(names[index], fallbackName);
      if (!desiredName) {
        pending.delete(index);
        continue;
      }
      const input = await ensureCardInput(card);
      if (!(input instanceof HTMLInputElement)) {
        continue;
      }
      if (!nameMatches(input.value, desiredName)) {
        setPassengerInputValue(input, desiredName);
      }
      if (hasDocs) {
        const docValue = resolveDocumentValue(index, docValues);
        if (docValue) {
          await applyDocumentValue(card, docValue);
        }
      }
      if (nameMatches(input.value, desiredName)) {
        if (cardKey) {
          cardFieldSnapshot.set(cardKey, { card });
        }
        pending.delete(index);
      }
    }
    if (pending.size) {
      await wait(60);
    }
  }

  if (pending.size) {
    logEvent(`[FastFio] Не удалось заполнить ${pending.size} карточек`);
    return null;
  }

  const verified = await tryVerifyPassengerNames(700);
  return verified ? Math.min(limit, collectTicketCards().length) : null;
}

function isPassengerField(input) {
  if (!(input instanceof HTMLInputElement)) return false;
  const meta = extractFieldMeta(input);
  return /зрител|фио|покупател|passag|fullname|full.?name|visitor|client|user/i.test(meta);
}

function isDocumentField(input) {
  if (!(input instanceof HTMLInputElement)) return false;
  const meta = extractFieldMeta(input);
  if (!DOCUMENT_FIELD_KEYWORDS.test(meta) && isPassengerField(input)) {
    return false;
  }
  return DOCUMENT_FIELD_KEYWORDS.test(meta);
}

function extractFieldMeta(input) {
  const label =
    input.closest("label")?.textContent ||
    document.querySelector(`label[for='${input.id}']`)?.textContent ||
    "";
  const placeholder = input.getAttribute("placeholder") || "";
  const prefix = input.getAttribute("data-prefix") || "";
  const suffix = input.getAttribute("data-suffix") || "";
  const meta = `${label} ${placeholder} ${prefix} ${suffix} ${input.name || ""} ${
    input.id || ""
  } ${input.dataset?.field || ""}`.toLowerCase();
  return meta;
}

async function ensurePassengerStepVisible() {
  if (hasPassengerInputs()) return;
  const now = Date.now();

  if (isConfirmationStepVisible() && !passengerStepNavigationInProgress) {
    const backButton = findBackButtonToPassengerStep();
    if (backButton) {
      if (now - passengerFormRecoveryAt > 1500) {
        logEvent("Возвращаемся к шагу ввода данных посетителя");
        passengerFormRecoveryAt = now;
      }
      dispatchSyntheticClick(backButton);
      passengerStepNavigationInProgress = true;
      await wait(900);
      return;
    }
  }

  const trigger = findPassengerEditTrigger();
  if (trigger) {
    if (now - passengerFormRecoveryAt > 1500) {
      logEvent("Пробуем раскрыть форму для ввода ФИО");
      passengerFormRecoveryAt = now;
    }
    dispatchSyntheticClick(trigger);
    await wait(400);
  }
}

function hasPassengerInputs() {
  return Boolean(document.querySelector(PASSENGER_INPUT_SELECTOR));
}

function isConfirmationStepVisible() {
  const node = document.querySelector(".basket__button--rules, .basket__button--rules label");
  if (!node) return false;
  return isElementVisible(node);
}

function findBackButtonToPassengerStep() {
  return findInteractiveByText((text) => /вернут|назад/i.test(text));
}

function findPassengerEditTrigger() {
  const cards = collectTicketCards();
  for (const card of cards) {
    const trigger = findCardEditTrigger(card);
    if (trigger) {
      return trigger;
    }
  }
  return findInteractiveByText((text) => {
    if (/вернут|назад|соглас|оплат/i.test(text)) {
      return false;
    }
    return (
      /укаж/.test(text) ||
      /заполн/.test(text) ||
      /введ/i.test(text) ||
      /редакт/.test(text) ||
      /измени/.test(text) ||
      (/дан/i.test(text) && (/посет|зрител|фио/.test(text) || /билет/.test(text)))
    );
  });
}

function collectTicketCards() {
  return Array.from(
    document.querySelectorAll(
      ".ticket__form, .ticket_content, li.event__ticket, li.event_ticket, li.event-ticket"
    )
  );
}

function normalizeDetectedStep(step) {
  if (step === 2 && !hasPassengerInputs()) {
    return currentCheckoutStep > 1 ? currentCheckoutStep : 1;
  }
  if (step === 3 && !passengerDataConfirmed) {
    return hasPassengerInputs() ? 2 : currentCheckoutStep || 1;
  }
  return step;
}

async function ensureCardInput(card) {
  if (!card) return null;
  let input = getPassengerInputFromCard(card);
  if (input) {
    return input;
  }
  const trigger = findCardEditTrigger(card);
  if (trigger) {
    dispatchSyntheticClick(trigger);
    await wait(120);
    input = getPassengerInputFromCard(card);
    if (input) {
      return input;
    }
  }
  return null;
}

function getPassengerInputFromCard(card) {
  const input = card.querySelector(PASSENGER_INPUT_SELECTOR);
  if (input instanceof HTMLInputElement && isPassengerField(input)) {
    return input;
  }
  return null;
}

async function ensureCardDocumentInput(card) {
  if (!card) return null;
  let input = getPassengerDocumentInputFromCard(card);
  if (input) {
    return input;
  }
  const trigger = findCardEditTrigger(card);
  if (trigger) {
    dispatchSyntheticClick(trigger);
    await wait(120);
    input = getPassengerDocumentInputFromCard(card);
    if (input) {
      return input;
    }
  }
  return null;
}

function getPassengerDocumentInputFromCard(card) {
  const inputs = card.querySelectorAll(PASSENGER_INPUT_SELECTOR);
  for (const input of inputs) {
    if (input instanceof HTMLInputElement && isDocumentField(input)) {
      return input;
    }
  }
  return null;
}

async function applyDocumentValue(card, docValue) {
  if (!docValue) return;
  const cardKey = getTicketCardKey(card);
  let input = null;
  if (cardKey && cardFieldSnapshot.has(cardKey) && cardFieldSnapshot.get(cardKey).docInput) {
    input = cardFieldSnapshot.get(cardKey).docInput;
  }
  if (!(input instanceof HTMLInputElement)) {
    input = await ensureCardDocumentInput(card);
  }
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  if (!documentMatches(input.value, docValue)) {
    setPassengerInputValue(input, docValue);
  }
  if (cardKey) {
    const existing = cardFieldSnapshot.get(cardKey) || {};
    cardFieldSnapshot.set(cardKey, { ...existing, docInput: input });
  }
}

function setPassengerInputValue(input, value) {
  if (!(input instanceof HTMLInputElement)) return;
  input.value = value;
  input.setAttribute("value", value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));
}

function sanitizePassengerName(name, fallbackName) {
  if (typeof name === "string" && name.trim().length > 0) {
    return name.trim();
  }
  if (typeof fallbackName === "string" && fallbackName.trim().length > 0) {
    return fallbackName.trim();
  }
  return null;
}

function findCardEditTrigger(card) {
  const selectors = [
    ".ticket__edit button",
    ".ticket__user-fio button",
    ".ticket_user-fio button",
    ".ticket__arrow",
    ".ticket_edit",
    ".ticket__user-fio",
    ".ticket_user-fio",
    ".ticket__info",
    ".ticket__content",
    ".basket__warning button"
  ];
  for (const selector of selectors) {
    const element = card.querySelector(selector);
    if (element instanceof HTMLElement) {
      return element;
    }
  }
  return null;
}

function findInteractiveByText(predicate) {
  const candidates = Array.from(
    document.querySelectorAll(
      "button, a, [role='button'], input[type='button'], input[type='submit'], .btn, .link, .basket__button, .ticket__user-fio, .ticket_user-fio, .ticket__info, .ticket__content, .basket__warning"
    )
  );
  return candidates.find((el) => {
    if (!(el instanceof HTMLElement)) return false;
    const text = normalizeText(el.textContent || el.getAttribute("aria-label") || "");
    if (!text) return false;
    return predicate(text, el);
  });
}

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function normalizeName(text) {
  return normalizeText(text || "").toLowerCase();
}

function nameMatches(source, expected) {
  const normalizedSource = normalizeName(source);
  const normalizedExpected = normalizeName(expected);
  if (!normalizedExpected) return Boolean(normalizedSource);
  return normalizedSource.includes(normalizedExpected);
}

function normalizeDocumentValue(text) {
  return (text || "").toLowerCase().replace(/\s+/g, "");
}

function documentMatches(source, expected) {
async function enforceTicketCountLimit(existingCards) {
  const cards = existingCards || collectTicketCards();
  const targetCount = checkoutSettings.ticketCount || cards.length;
  if (cards.length > targetCount) {
    logEvent(
      `Сайт добавил ${cards.length} карточек вместо ${targetCount}, возвращаемся к выбору мест`
    );
    const backButton = findBackButtonToPassengerStep();
    if (backButton) {
      dispatchSyntheticClick(backButton);
      await wait(400);
    }
    passengerStepNavigationInProgress = true;
    passengerFormRecoveryAt = Date.now();
    throw new Error("Количество выбранных билетов не соответствует настройке");
  }
}
  if (!expected) return true;
  return normalizeDocumentValue(source) === normalizeDocumentValue(expected);
}

function getTicketCardKey(card) {
  if (!(card instanceof HTMLElement)) return null;
  const seatText = card.querySelector(".ticket__info, .ticket_info, .ticket__title")?.textContent;
  if (seatText) {
    return normalizeText(seatText);
  }
  if (card.dataset?.ticketId) {
    return `ticket:${card.dataset.ticketId}`;
  }
  return null;
}

function collectPassengerLabels() {
  return Array.from(
    document.querySelectorAll(".ticket__user-fio, .ticket_user-fio")
  ).map((el) => el.textContent || "").map(normalizeText);
}

function collectPassengerInputs() {
  return Array.from(document.querySelectorAll(PASSENGER_INPUT_SELECTOR)).filter(
    (input) => input instanceof HTMLInputElement && isPassengerField(input)
  );
}

function collectDocumentInputs() {
  return Array.from(document.querySelectorAll(PASSENGER_INPUT_SELECTOR)).filter(
    (input) => input instanceof HTMLInputElement && isDocumentField(input)
  );
}

function collectHiddenPassengerInputs() {
  const inputs = Array.from(document.querySelectorAll(PASSENGER_HIDDEN_INPUT_SELECTOR)).filter(
    (input) => input instanceof HTMLInputElement && isPassengerField(input)
  );
  const unique = [];
  const seen = new Set();
  inputs.forEach((input) => {
    if (seen.has(input)) return;
    seen.add(input);
    unique.push(input);
  });
  return unique;
}

async function verifyPassengerNames(timeout = 5000) {
  const start = Date.now();
  const expected = checkoutSettings.passengerNames.filter(Boolean);
  const fallbackName = expected[0] || checkoutSettings.showTitle || "";
  while (Date.now() - start < timeout) {
    const labels = collectPassengerLabels();
    const inputs = collectPassengerInputs();
    const hiddenInputs = collectHiddenPassengerInputs();
    const labelsMatch =
      labels.length &&
      labels.every((text, idx) => nameMatches(text, expected[idx] || fallbackName));
    const inputsMatch =
      inputs.length &&
      inputs.every((input, idx) => nameMatches(input.value, expected[idx] || fallbackName));
    const hiddenMatch =
      hiddenInputs.length &&
      hiddenInputs.every((input, idx) => nameMatches(input.value, expected[idx] || fallbackName));
    if (labelsMatch || inputsMatch || hiddenMatch) {
      return;
    }
    await wait(200);
  }
  throw new Error("Сайт не отобразил введённое ФИО");
}

async function verifyPassengerDocuments(timeout = 4000) {
  const docsInfo = prepareDocumentValues();
  if (!docsInfo.hasValues) {
    return false;
  }
  const targetCount = checkoutSettings.ticketCount || docsInfo.values.length || 0;
  const expectedDocs = [];
  for (let index = 0; index < targetCount; index += 1) {
    const value = resolveDocumentValue(index, docsInfo.values);
    expectedDocs.push(normalizeDocumentValue(value));
  }
  if (!expectedDocs.some(Boolean)) {
    return;
  }
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const inputs = collectDocumentInputs();
    if (!inputs.length) {
      await wait(150);
      continue;
    }
    let allMatch = true;
    for (let index = 0; index < Math.min(inputs.length, expectedDocs.length); index += 1) {
      const expectedDoc = expectedDocs[index];
      if (!expectedDoc) {
        continue;
      }
      if (!documentMatches(inputs[index].value, expectedDoc)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) {
      return true;
    }
    await wait(150);
  }
  throw new Error("Сайт не отобразил введённые документы");
}

async function tryVerifyPassengerNames(timeout = 600) {
  try {
    await verifyPassengerNames(timeout);
    return true;
  } catch (error) {
    return false;
  }
}

async function clickButtonByText(text, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const candidates = Array.from(
      document.querySelectorAll(
        "button, a, input[type='button'], input[type='submit']"
      )
    ).filter((el) => el.offsetParent !== null);
    const button = candidates.find((el) => {
      const label = (el.textContent || el.value || "").trim();
      return new RegExp(text, "i").test(label);
    });
    if (button) {
      logEvent(`Нажимаем кнопку "${text}"`);
      button.click();
      button.dispatchEvent(new Event("click", { bubbles: true }));
      await wait(150);
      return;
    }
    await wait(200);
  }
  throw new Error(`Не нашли кнопку ${text}`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForElement(selector, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el) return el;
    await wait(100);
  }
  return null;
}

async function waitForCondition(fn, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await wait(100);
  }
  throw new Error("Ожидание условия истекло");
}

function setStatus(text) {
  logEvent(text);
  chrome.runtime.sendMessage({
    type: "contentStatus",
    status: `[Checkout] ${text}`,
    running: automationActive
  });
}

})();

}
