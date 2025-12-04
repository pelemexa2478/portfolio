const SEAT_ZONE_BASES = [
  { id: "parter", label: "Партер" },
  { id: "amphi", label: "Амфитеатр" },
  { id: "tier1", label: "1 ярус" },
  { id: "tier2", label: "2 ярус" },
  { id: "belEtage", label: "Бельэтаж" },
  { id: "balcony", label: "Балкон / Галерея" }
];

const SEAT_ZONE_VARIANTS = [
  { suffix: "Any", label: "любой сектор" },
  { suffix: "Center", label: "центр" },
  { suffix: "Left", label: "левая сторона" },
  { suffix: "Right", label: "правая сторона" }
];

const SEAT_ZONE_PRESETS = SEAT_ZONE_BASES.flatMap((base) =>
  SEAT_ZONE_VARIANTS.map((variant) => ({
    id: `${base.id}${variant.suffix}`,
    label: `${base.label} — ${variant.label}`
  }))
);

const defaultSettings = {
  showTitle: "Луиза Миллер",
  showDate: "",
  showTime: "",
  ticketCount: 1,
  passengerNames: ["", "", "", ""],
  passengerDocs: ["", "", "", ""],
  requireAdjacentSeats: false,
  seatZones: createDefaultSeatZones(),
  preferredRows: ""
};

const dom = {
  showTitle: document.getElementById("showTitle"),
  showDate: document.getElementById("showDate"),
  showTime: document.getElementById("showTime"),
  ticketCount: document.getElementById("ticketCount"),
  passengerList: document.getElementById("passengerList"),
  requireAdjacent: document.getElementById("require-adjacent"),
  zoneList: document.getElementById("zoneList"),
  preferredRows: document.getElementById("preferredRows"),
  statusText: document.getElementById("statusText"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  saveBtn: document.getElementById("saveBtn")
};

let currentSettings = structuredClone(defaultSettings);
let monitoringActive = false;

init();

async function init() {
  await loadSettings();
  renderPassengers(currentSettings.ticketCount);
  updateUIFromSettings();
  wireEvents();
  requestCurrentStatus();
}

function wireEvents() {
  dom.ticketCount.addEventListener("change", () => {
    const count = Number(dom.ticketCount.value);
    currentSettings.ticketCount = count;
    renderPassengers(count);
  });

  dom.saveBtn.addEventListener("click", async () => {
    collectSettingsFromUI();
    await persistSettings();
    flashStatus("Данные сохранены");
  });

  dom.startBtn.addEventListener("click", async () => {
    collectSettingsFromUI();
    await persistSettings();
    sendCommandToWorker("startMonitoring", currentSettings);
    monitoringActive = true;
    syncButtons();
  });

  dom.stopBtn.addEventListener("click", () => {
    sendCommandToWorker("stopMonitoring");
    monitoringActive = false;
    syncButtons();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === "statusUpdate" && typeof message.status === "string") {
      dom.statusText.textContent = message.status;
      monitoringActive = message.running ?? monitoringActive;
      syncButtons();
    }
  });
}

function renderPassengers(count) {
  dom.passengerList.innerHTML = "";
  currentSettings.passengerNames = currentSettings.passengerNames || [];
  currentSettings.passengerDocs = currentSettings.passengerDocs || [];
  currentSettings.passengerNames.length = count;
  currentSettings.passengerDocs.length = count;
  for (let i = 0; i < count; i += 1) {
    const wrapper = document.createElement("label");
    wrapper.className = "field passenger-field";
    const span = document.createElement("span");
    span.textContent = `Билет №${i + 1}`;

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Иванов Иван Иванович";
    nameInput.value = currentSettings.passengerNames[i] || "";
    nameInput.dataset.role = "name";
    nameInput.dataset.index = String(i);
    nameInput.addEventListener("input", (evt) => {
      const index = Number(evt.target.dataset.index);
      currentSettings.passengerNames[index] = evt.target.value;
    });

    const docInput = document.createElement("input");
    docInput.type = "text";
    docInput.placeholder = "Документ (серия и номер)";
    docInput.value = currentSettings.passengerDocs[i] || "";
    docInput.dataset.role = "doc";
    docInput.dataset.index = String(i);
    docInput.addEventListener("input", (evt) => {
      const index = Number(evt.target.dataset.index);
      currentSettings.passengerDocs[index] = evt.target.value;
    });

    wrapper.append(span, nameInput, docInput);
    dom.passengerList.appendChild(wrapper);
  }
}

function renderSeatZones() {
  if (!dom.zoneList) return;
  const zonesState = currentSettings.seatZones || createDefaultSeatZones();
  currentSettings.seatZones = zonesState;
  dom.zoneList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  SEAT_ZONE_PRESETS.forEach((preset) => {
    const label = document.createElement("label");
    label.className = "checkbox zone-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.zoneId = preset.id;
    input.checked = Boolean(zonesState[preset.id]);
    input.addEventListener("change", () => {
      currentSettings.seatZones[preset.id] = input.checked;
    });
    const text = document.createElement("span");
    text.textContent = preset.label;
    label.append(input, text);
    fragment.appendChild(label);
  });
  dom.zoneList.appendChild(fragment);
}

async function loadSettings() {
  const stored = await chrome.storage.local.get("settings");
  if (stored.settings) {
    currentSettings = {
      ...defaultSettings,
      ...stored.settings,
      passengerNames: [
        ...defaultSettings.passengerNames,
        ...(stored.settings.passengerNames ?? [])
      ].slice(0, 4),
      passengerDocs: [
        ...defaultSettings.passengerDocs,
        ...(stored.settings.passengerDocs ?? [])
      ].slice(0, 4)
    };
    currentSettings.seatZones = {
      ...createDefaultSeatZones(),
      ...(stored.settings.seatZones ?? {})
    };
    currentSettings.requireAdjacentSeats = Boolean(
      stored.settings.requireAdjacentSeats
    );
  }
}

function collectSettingsFromUI() {
  currentSettings.showTitle = dom.showTitle.value.trim() || defaultSettings.showTitle;
  currentSettings.showDate = dom.showDate.value.trim();
  currentSettings.showTime = dom.showTime.value.trim();
  currentSettings.ticketCount = Number(dom.ticketCount.value);
  const nameInputs = dom.passengerList.querySelectorAll("input[data-role='name']");
  const docInputs = dom.passengerList.querySelectorAll("input[data-role='doc']");
  currentSettings.passengerNames = Array.from({ length: nameInputs.length }, () => "");
  currentSettings.passengerDocs = Array.from({ length: docInputs.length }, () => "");
  nameInputs.forEach((input, index) => {
    currentSettings.passengerNames[index] = input.value.trim();
  });
  docInputs.forEach((input, index) => {
    currentSettings.passengerDocs[index] = input.value.trim();
  });
  currentSettings.requireAdjacentSeats = dom.requireAdjacent.checked;
  currentSettings.preferredRows = dom.preferredRows.value.trim();
  currentSettings.seatZones = createDefaultSeatZones();
  dom.zoneList
    .querySelectorAll("input[data-zone-id]")
    .forEach((input) => {
      const zoneId = input.dataset.zoneId;
      if (zoneId) {
        currentSettings.seatZones[zoneId] = input.checked;
      }
    });
}

async function persistSettings() {
  await chrome.storage.local.set({ settings: currentSettings });
}

function updateUIFromSettings() {
  dom.showTitle.value = currentSettings.showTitle;
  dom.showDate.value = currentSettings.showDate || "";
  dom.showTime.value = currentSettings.showTime || "";
  dom.ticketCount.value = String(currentSettings.ticketCount);
  dom.requireAdjacent.checked = Boolean(currentSettings.requireAdjacentSeats);
  dom.preferredRows.value = currentSettings.preferredRows || "";
  renderSeatZones();
}

function syncButtons() {
  dom.startBtn.disabled = monitoringActive;
  dom.stopBtn.disabled = !monitoringActive;
}

function flashStatus(text) {
  dom.statusText.textContent = text;
  setTimeout(requestCurrentStatus, 1500);
}

function sendCommandToWorker(action, payload) {
  chrome.runtime.sendMessage({ from: "popup", action, payload });
}

function requestCurrentStatus() {
  chrome.runtime.sendMessage({ action: "getStatus" }, (response) => {
    if (chrome.runtime.lastError) {
      return;
    }
    if (response?.status) {
      dom.statusText.textContent = response.status;
      monitoringActive = Boolean(response.running);
      syncButtons();
    }
  });
}

function createDefaultSeatZones() {
  return SEAT_ZONE_PRESETS.reduce((acc, preset) => {
    acc[preset.id] = false;
    return acc;
  }, {});
}

