const API_KEY_STORAGE = "gill-gemini-key-session";
const MODEL_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const $ = (selector) => document.querySelector(selector);
let currentImage = null;
let previewUrl = null;

function getApiKey() {
  return sessionStorage.getItem(API_KEY_STORAGE) || "";
}

function setConnectionState(connected, message) {
  $("#connection-label").textContent = connected ? "AI connected" : "Connect AI";
  $("#connection-note").textContent = message;
}

function saveApiKey() {
  const key = $("#gemini-api-key").value.trim();
  if (!key) {
    sessionStorage.removeItem(API_KEY_STORAGE);
    setConnectionState(false, "Key cleared. It is never saved in the website files.");
    return;
  }
  sessionStorage.setItem(API_KEY_STORAGE, key);
  $("#gemini-api-key").value = "";
  setConnectionState(true, "Key is kept in this tab only. The selected image is sent directly to Google Gemini.");
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("The browser could not prepare this image."));
    reader.readAsDataURL(blob);
  });
}

function imageAsJpeg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = async () => {
      URL.revokeObjectURL(url);
      try {
        let maxSide = 2560;
        let blob = null;
        while (maxSide >= 960) {
          const scale = Math.min(1, maxSide / image.width, maxSide / image.height);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          blob = await new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.88));
          if (blob && blob.size <= 18 * 1024 * 1024) break;
          maxSide = Math.floor(maxSide * 0.72);
        }
        if (!blob) throw new Error("Image conversion failed.");
        resolve({ mime_type: "image/jpeg", data: await blobToBase64(blob) });
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This browser cannot convert the image; sending the original format to Gemini instead."));
    };
    image.src = url;
  });
}

async function prepareImage(file) {
  try {
    return await imageAsJpeg(file);
  } catch {
    return { mime_type: file.type || "application/octet-stream", data: bytesToBase64(await file.arrayBuffer()) };
  }
}

async function askGemini(file) {
  const key = getApiKey();
  if (!key) throw new Error("Connect your Google AI Studio key, then tap Try again.");
  const image = await prepareImage(file);
  const response = await fetch(`${MODEL_ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [
        { text: "Read this complete MetaTrader 5 XAU/USD chart screenshot. Find and focus on the main chart yourself; do not require a crop from the user. Report a cautious trade plan from visible structure. Read exact price-axis labels when possible. Return JSON only with: direction (LONG, SHORT, WAIT, or UNCLEAR), confidence (LOW, MEDIUM, or HIGH), timeframe, visualSummary, currentPrice, entry, stopLoss, takeProfit, levelsBasis, caveats. Use numbers or null for price fields. Never invent unreadable numbers. If you estimate levels rather than read marked levels, say so in levelsBasis and lower confidence. If the chart is ambiguous, use WAIT or UNCLEAR and null levels. This is analysis, not a guarantee." },
        { inline_data: image },
      ] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || `Gemini could not analyze this image (${response.status}).`);
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw new Error("Gemini returned no chart reading. Try selecting the image again.");
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("Gemini returned an unreadable chart report. Please retry.");
  }
}

function displayPrice(value) {
  if (value === null || value === undefined || value === "") return "Not clear";
  const price = Number(value);
  return Number.isFinite(price) ? price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "Not clear";
}

function showResult(result) {
  const direction = String(result.direction || "UNCLEAR").toUpperCase();
  $("#result-direction").textContent = direction;
  $("#result-direction").className = `result-direction ${direction.toLowerCase()}`;
  $("#result-confidence").textContent = `${String(result.confidence || "LOW").toUpperCase()} CONFIDENCE`;
  $("#result-summary").textContent = `${result.timeframe ? `${result.timeframe} · ` : ""}${result.visualSummary || "No clear chart details detected."}`;
  $("#result-price").textContent = displayPrice(result.currentPrice);
  $("#result-entry").textContent = displayPrice(result.entry);
  $("#result-stop").textContent = displayPrice(result.stopLoss);
  $("#result-target").textContent = displayPrice(result.takeProfit);
  const caveats = Array.isArray(result.caveats) ? result.caveats.join(" ") : String(result.caveats || "");
  const basis = result.levelsBasis ? `Level basis: ${result.levelsBasis}. ` : "";
  $("#result-caveats").textContent = `${basis}${caveats}`;
  $("#analysis-result").hidden = false;
}

function showImagePreview(file) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  $("#selected-image").hidden = false;
  $("#image-name").textContent = file.name || "Chart image";
  $("#image-size").textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  const preview = $("#image-preview");
  preview.hidden = false;
  preview.src = previewUrl;
  preview.onerror = () => { preview.hidden = true; };
}

async function analyzeImage(file) {
  currentImage = file;
  showImagePreview(file);
  $("#analysis-result").hidden = true;
  $("#retry-analysis").hidden = true;
  $("#analysis-status").textContent = "Reading chart image…";
  $("#upload-dropzone").classList.add("busy");
  try {
    const result = await askGemini(file);
    showResult(result);
    $("#analysis-status").textContent = "Chart reading ready. Verify every level before trading.";
  } catch (error) {
    $("#analysis-status").textContent = error.message || "Could not read this image. Check your AI connection and retry.";
    $("#retry-analysis").hidden = false;
    if (!getApiKey()) $(".ai-connection").open = true;
  } finally {
    $("#upload-dropzone").classList.remove("busy");
  }
}

function handleFiles(files) {
  const file = files?.[0];
  if (!file) return;
  analyzeImage(file);
}

$("#save-gemini-key").addEventListener("click", saveApiKey);
$("#chart-file").addEventListener("change", (event) => {
  handleFiles(event.target.files);
  event.target.value = "";
});
$("#retry-analysis").addEventListener("click", () => {
  if (currentImage) analyzeImage(currentImage);
});

const dropzone = $("#upload-dropzone");
for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
}
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  handleFiles(event.dataTransfer.files);
});

if (getApiKey()) setConnectionState(true, "AI connected for this tab.");
