const form = document.getElementById("builder-form");
const toNameInput = document.getElementById("toName");
const fromNameInput = document.getElementById("fromName");
const headlineInput = document.getElementById("headline");
const messageInput = document.getElementById("message");
const videoUrlInput = document.getElementById("videoUrl");
const shareUrlInput = document.getElementById("shareUrl");
const copyStatus = document.getElementById("copyStatus");
const recordStatus = document.getElementById("recordStatus");
const videoUrlHint = document.getElementById("videoUrlHint");
const builderGuideText = document.getElementById("builderGuideText");
const livePreviewStatus = document.getElementById("livePreviewStatus");
const shareNote = document.getElementById("shareNote");
const cameraBlock = document.querySelector(".camera-block");

const railwayApiOrigin = "https://video-card-api-production.up.railway.app";
const apiOrigin = window.location.hostname.endsWith("vercel.app") ? railwayApiOrigin : "";

const toNameCounter = document.getElementById("toNameCounter");
const fromNameCounter = document.getElementById("fromNameCounter");
const headlineCounter = document.getElementById("headlineCounter");
const messageCounter = document.getElementById("messageCounter");

const cameraPreview = document.getElementById("cameraPreview");
const cameraEnableBtn = document.getElementById("cameraEnableBtn");
const recordStartBtn = document.getElementById("recordStartBtn");
const recordStopBtn = document.getElementById("recordStopBtn");
const recordClearBtn = document.getElementById("recordClearBtn");
const nativeRecorderInput = document.getElementById("nativeRecorderInput");

const previewTo = document.getElementById("previewTo");
const previewFrom = document.getElementById("previewFrom");
const previewHeadline = document.getElementById("previewHeadline");
const previewMessage = document.getElementById("previewMessage");
const previewFootnote = document.getElementById("previewFootnote");

const videoFrame = document.getElementById("videoFrame");
const videoNative = document.getElementById("videoNative");
const videoPlaceholder = document.getElementById("videoPlaceholder");

const generateBtn = document.getElementById("generateBtn");
const resetBtn = document.getElementById("resetBtn");
const copyBtn = document.getElementById("copyBtn");

let cameraStream = null;
let recordingStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let finalizeCurrentRecording = null;
let requestStopCurrentRecording = null;
let recordedVideoUrl = "";
let recordedVideoBlob = null;
let uploadedVideoUrl = "";
let isUploadingVideo = false;
let uploadBackendAvailable = true;
let activePreviewVideoType = "none";
let activePreviewVideoUrl = "";
let lastAnnouncedPreviewState = "";

const recordingChunkIntervalMs = 500;
const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const useNativeCaptureMode = isAppleMobile;

const defaultState = {
  toName: "To someone special",
  fromName: "From you",
  headline: "Your Video Greeting",
  message:
    "Write a heartfelt message and add your video link to make this card unforgettable.",
};

const fieldCounterConfig = [
  { input: toNameInput, counter: toNameCounter },
  { input: fromNameInput, counter: fromNameCounter },
  { input: headlineInput, counter: headlineCounter },
  { input: messageInput, counter: messageCounter },
];

function debounce(callback, waitMs) {
  let timeoutId = null;
  return (...args) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      callback(...args);
    }, waitMs);
  };
}

function syncCopyButtonState() {
  copyBtn.disabled = !shareUrlInput.value.trim();
}

function setStatusMessage(element, message, tone = "info") {
  element.textContent = message;
  if (message) {
    element.dataset.tone = tone;
  } else {
    delete element.dataset.tone;
  }
}

function setCopyStatus(message, tone = "info") {
  setStatusMessage(copyStatus, message, tone);
}

function setRecordStatus(message, tone = "info") {
  setStatusMessage(recordStatus, message, tone);
}

function syncRecordingControls() {
  const hasRecordedVideo = Boolean(recordedVideoBlob || recordedVideoUrl || uploadedVideoUrl);
  recordClearBtn.disabled = !hasRecordedVideo;
}

function announcePreviewState(message) {
  if (message === lastAnnouncedPreviewState) {
    return;
  }
  livePreviewStatus.textContent = message;
  lastAnnouncedPreviewState = message;
}

const schedulePreviewUpdate = debounce(updatePreview, 90);

function updateCharCounters() {
  fieldCounterConfig.forEach(({ input, counter }) => {
    const max = Number(input.maxLength);
    if (!Number.isFinite(max) || max <= 0) {
      counter.textContent = "";
      return;
    }

    const remaining = Math.max(max - input.value.length, 0);
    counter.textContent = `${remaining} left`;
    counter.classList.toggle("near-limit", remaining <= Math.ceil(max * 0.2) && remaining > 0);
    counter.classList.toggle("limit-hit", remaining === 0);
  });
}

function updateVideoHint() {
  if (recordedVideoUrl || uploadedVideoUrl) {
    videoUrlHint.textContent = "Using your recorded video for preview and sharing.";
    return;
  }

  const raw = videoUrlInput.value.trim();
  if (!raw) {
    videoUrlHint.textContent = "Paste a YouTube, Vimeo, or direct MP4/WebM/Ogg link.";
    return;
  }

  const { type } = toEmbedUrl(raw);
  if (type === "iframe") {
    videoUrlHint.textContent = "Great - this link will be embedded in the card.";
    return;
  }

  if (type === "native") {
    videoUrlHint.textContent = "This direct video file will play in the native player.";
    return;
  }

  videoUrlHint.textContent = "That URL is not recognized. Try YouTube, Vimeo, or MP4/WebM/Ogg.";
}

function updateBuilderGuide() {
  const coreFields = [toNameInput, fromNameInput, headlineInput, messageInput];
  const filledCount = coreFields.filter((field) => field.value.trim().length > 0).length;
  const hasVideo = Boolean(videoUrlInput.value.trim() || recordedVideoUrl || uploadedVideoUrl);

  if (filledCount === 0 && !hasVideo) {
    builderGuideText.textContent =
      "Start by filling To, From, and headline. Then add a message and choose a video source.";
    return;
  }

  if (filledCount < coreFields.length) {
    builderGuideText.textContent = `Nice progress - ${coreFields.length - filledCount} text field(s) left before your card text is complete.`;
    return;
  }

  if (!hasVideo) {
    builderGuideText.textContent = "Your message is ready. Add a video URL or record with camera to complete the card.";
    return;
  }

  builderGuideText.textContent = "Everything looks ready. Generate your share link and send your card.";
}

function updatePreviewFootnote(toName, fromName) {
  const hasCustomRecipient = toName !== defaultState.toName;
  const hasCustomSender = fromName !== defaultState.fromName;

  if (hasCustomRecipient && hasCustomSender) {
    previewFootnote.textContent = `A small keepsake from ${fromName} to ${toName}.`;
    return;
  }

  if (hasCustomSender) {
    previewFootnote.textContent = `Made with love by ${fromName}.`;
    return;
  }

  previewFootnote.textContent = "Made with a little extra sweetness.";
}

function determinePreviewVideo() {
  const preferredVideoUrl = uploadedVideoUrl || recordedVideoUrl;
  if (preferredVideoUrl) {
    return { type: "native", url: preferredVideoUrl, mode: "recorded" };
  }

  const { type, url } = toEmbedUrl(videoUrlInput.value.trim());
  if (type === "iframe") {
    return { type: "iframe", url, mode: "embed" };
  }

  if (type === "native") {
    return { type: "native", url, mode: "native" };
  }

  return { type: "none", url: "", mode: "none" };
}

function applyPreviewVideo(nextVideo) {
  const { type, url } = nextVideo;
  const sourceChanged = type !== activePreviewVideoType || url !== activePreviewVideoUrl;

  if (!sourceChanged) {
    return false;
  }

  if (activePreviewVideoType === "iframe" && type !== "iframe") {
    videoFrame.src = "";
  }

  if (activePreviewVideoType === "native" && type !== "native") {
    videoNative.pause();
    videoNative.removeAttribute("src");
    videoNative.load();
  }

  if (type === "iframe") {
    if (videoFrame.src !== url) {
      videoFrame.src = url;
    }
  } else if (type === "native") {
    if (videoNative.src !== url) {
      videoNative.src = url;
    }
  }

  activePreviewVideoType = type;
  activePreviewVideoUrl = url;
  return true;
}

function setPreviewVideoVisibility(type) {
  videoFrame.style.display = type === "iframe" ? "block" : "none";
  videoNative.style.display = type === "native" ? "block" : "none";
  videoPlaceholder.style.display = type === "none" ? "grid" : "none";
}

function sanitizeText(value, fallback) {
  const clean = value.trim().replace(/\s+/g, " ");
  return clean.length ? clean : fallback;
}

function toEmbedUrl(rawUrl) {
  if (!rawUrl) return { type: "none", url: "" };

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { type: "none", url: "" };
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const path = parsed.pathname;

  if (host.includes("youtube.com")) {
    const videoId = parsed.searchParams.get("v");
    if (videoId) {
      return { type: "iframe", url: `https://www.youtube.com/embed/${videoId}` };
    }

    if (path.startsWith("/embed/")) {
      return { type: "iframe", url: rawUrl };
    }
  }

  if (host === "youtu.be") {
    const videoId = path.slice(1);
    if (videoId) {
      return { type: "iframe", url: `https://www.youtube.com/embed/${videoId}` };
    }
  }

  if (host.includes("vimeo.com")) {
    const segments = path.split("/").filter(Boolean);
    const maybeId = segments[segments.length - 1];
    if (/^\d+$/.test(maybeId)) {
      return { type: "iframe", url: `https://player.vimeo.com/video/${maybeId}` };
    }
  }

  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(path)) {
    return { type: "native", url: rawUrl };
  }

  return { type: "none", url: "" };
}

function updatePreview() {
  const toName = sanitizeText(toNameInput.value, defaultState.toName);
  const fromName = sanitizeText(fromNameInput.value, defaultState.fromName);
  const headline = sanitizeText(headlineInput.value, defaultState.headline);
  const message = sanitizeText(messageInput.value, defaultState.message);

  previewTo.textContent = `To ${toName === defaultState.toName ? "someone special" : toName}`;
  previewFrom.textContent = `From ${fromName === defaultState.fromName ? "you" : fromName}`;
  previewHeadline.textContent = headline;
  previewMessage.textContent = message;
  updatePreviewFootnote(toName, fromName);

  const previewVideo = determinePreviewVideo();
  const mediaChanged = applyPreviewVideo(previewVideo);
  setPreviewVideoVisibility(previewVideo.type);

  updateVideoHint();
  updateBuilderGuide();
  if (mediaChanged) {
    if (previewVideo.mode === "recorded") {
      announcePreviewState(`Preview ready for ${toName}. Recorded video selected.`);
    } else if (previewVideo.mode === "embed") {
      announcePreviewState(`Preview ready for ${toName}. Embedded video selected.`);
    } else if (previewVideo.mode === "native") {
      announcePreviewState(`Preview ready for ${toName}. Direct video selected.`);
    } else {
      announcePreviewState(`Preview updated for ${toName}. Add a supported video to finish.`);
    }
  }
}

function stateToQuery() {
  const params = new URLSearchParams();
  params.set("view", "1");
  params.set("to", toNameInput.value.trim());
  params.set("from", fromNameInput.value.trim());
  params.set("headline", headlineInput.value.trim());
  params.set("msg", messageInput.value.trim());
  params.set("video", uploadedVideoUrl || videoUrlInput.value.trim());
  return params.toString();
}

function statePayload() {
  return {
    to: toNameInput.value.trim(),
    from: fromNameInput.value.trim(),
    headline: headlineInput.value.trim(),
    msg: messageInput.value.trim(),
    video: uploadedVideoUrl || videoUrlInput.value.trim(),
  };
}

async function requestShortShareUrl() {
  const response = await fetch(apiUrl("/api/share"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(statePayload()),
  });

  if (!response.ok) {
    throw new Error(`Share service failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (!payload.id || typeof payload.id !== "string") {
    throw new Error("Share service did not return a valid id");
  }

  return `${window.location.origin}${window.location.pathname}?view=1&share=${encodeURIComponent(payload.id)}`;
}

function applyStateToForm(payload) {
  toNameInput.value = payload.to || "";
  fromNameInput.value = payload.from || "";
  headlineInput.value = payload.headline || "";
  messageInput.value = payload.msg || "";
  videoUrlInput.value = payload.video || "";
}

async function loadStateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const shareId = (params.get("share") || "").trim();

  if (shareId) {
    try {
      const response = await fetch(apiUrl(`/api/share/${encodeURIComponent(shareId)}`), {
        method: "GET",
        cache: "no-store",
      });

      if (response.ok) {
        const payload = await response.json();
        applyStateToForm(payload);
      } else {
        applyStateToForm({
          to: params.get("to") || "",
          from: params.get("from") || "",
          headline: params.get("headline") || "",
          msg: params.get("msg") || "",
          video: params.get("video") || "",
        });
      }
    } catch {
      applyStateToForm({
        to: params.get("to") || "",
        from: params.get("from") || "",
        headline: params.get("headline") || "",
        msg: params.get("msg") || "",
        video: params.get("video") || "",
      });
    }
  } else {
    applyStateToForm({
      to: params.get("to") || "",
      from: params.get("from") || "",
      headline: params.get("headline") || "",
      msg: params.get("msg") || "",
      video: params.get("video") || "",
    });
  }

  if (params.get("view") === "1" || shareId) {
    document.body.classList.add("view-mode");
  }
}

function canUploadRecordedVideo() {
  return window.location.protocol.startsWith("http") && uploadBackendAvailable;
}

function apiUrl(path) {
  if (!apiOrigin) {
    return path;
  }

  return new URL(path, apiOrigin).toString();
}

function uploadSetupHint() {
  const origin = window.location.origin && window.location.origin !== "null" ? window.location.origin : "http://127.0.0.1:3000";
  return `Start this app with \`node server.js\` and open ${origin}.`;
}

function setRecordingAvailability(isAvailable) {
  uploadBackendAvailable = isAvailable;

  if (isAvailable) {
    cameraEnableBtn.disabled = false;
    syncRecordingControls();
    if (cameraBlock) {
      cameraBlock.classList.remove("disabled");
    }
    if (shareNote?.dataset.defaultNote) {
      shareNote.textContent = shareNote.dataset.defaultNote;
    }
    return;
  }

  stopCamera();
  setRecordingButtons(false);
  cameraEnableBtn.disabled = true;
  recordStartBtn.disabled = true;
  recordStopBtn.disabled = true;
  recordClearBtn.disabled = true;

  if (cameraBlock) {
    cameraBlock.classList.add("disabled");
  }

  setRecordStatus("Camera recording upload is unavailable on this deployment. Use a video URL instead.", "warning");
  if (shareNote) {
    shareNote.textContent = "This hosted version supports shareable links from URL videos. Camera upload sharing requires a Node server runtime.";
  }
}

async function detectUploadBackendAvailability() {
  if (!window.location.protocol.startsWith("http")) {
    setRecordingAvailability(false);
    return;
  }

  try {
    const response = await fetch(apiUrl("/healthz"), {
      method: "GET",
      cache: "no-store",
    });
    setRecordingAvailability(response.ok);
  } catch {
    setRecordingAvailability(false);
  }
}

async function uploadRecordedVideo() {
  if (!recordedVideoBlob) {
    return "";
  }

  if (uploadedVideoUrl) {
    return uploadedVideoUrl;
  }

  if (!canUploadRecordedVideo()) {
    throw new Error(`Upload requires HTTP. ${uploadSetupHint()}`);
  }

  setCopyStatus("Uploading recorded video...", "info");

  let response;
  try {
    response = await fetch(apiUrl("/api/upload"), {
      method: "POST",
      headers: {
        "Content-Type": recordedVideoBlob.type || "video/webm",
      },
      body: recordedVideoBlob,
    });
  } catch {
    throw new Error(`Could not reach /api/upload. ${uploadSetupHint()}`);
  }

  if (!response.ok) {
    throw new Error(`Upload failed with status ${response.status}. ${uploadSetupHint()}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Upload succeeded but response was invalid JSON.");
  }

  if (!payload.videoUrl || typeof payload.videoUrl !== "string") {
    throw new Error("Upload response did not include a valid video URL.");
  }

  uploadedVideoUrl = new URL(payload.videoUrl, apiOrigin || window.location.origin).toString();
  syncRecordingControls();
  updatePreview();
  return uploadedVideoUrl;
}

async function generateShareUrl() {
  if (isUploadingVideo) {
    setCopyStatus("Upload already in progress...", "info");
    return;
  }

  if (recordedVideoBlob && !uploadBackendAvailable) {
    setCopyStatus("This deployment cannot upload camera recordings. Use a video URL instead.", "warning");
    return;
  }

  isUploadingVideo = true;
  generateBtn.disabled = true;

  if (recordedVideoBlob) {
    try {
      await uploadRecordedVideo();
    } catch (error) {
      setCopyStatus(error instanceof Error ? error.message : "Upload failed.", "error");
      isUploadingVideo = false;
      generateBtn.disabled = false;
      return;
    }
  }

  const fallbackUrl = `${window.location.origin}${window.location.pathname}?${stateToQuery()}`;

  try {
    shareUrlInput.value = await requestShortShareUrl();
  } catch {
    shareUrlInput.value = fallbackUrl;
  }
  syncCopyButtonState();
  if (uploadedVideoUrl) {
    setCopyStatus("Link generated with uploaded camera video. Copy and send it.", "success");
  } else {
    setCopyStatus("Link generated. Copy and send it.", "success");
  }

  isUploadingVideo = false;
  generateBtn.disabled = false;
}

async function copyShareUrl() {
  if (!shareUrlInput.value) {
    setCopyStatus("Generate the link first.", "warning");
    return;
  }

  try {
    await navigator.clipboard.writeText(shareUrlInput.value);
    setCopyStatus("Copied to clipboard.", "success");
  } catch {
    shareUrlInput.focus();
    shareUrlInput.select();
    setCopyStatus("Clipboard blocked. Press Ctrl+C to copy.", "warning");
  }
}

function resetAll() {
  clearRecording();
  form.reset();
  history.replaceState(null, "", window.location.pathname);
  shareUrlInput.value = "";
  syncCopyButtonState();
  setCopyStatus("");
  setRecordStatus("");
  updateCharCounters();
  updatePreview();
}

function setRecordingButtons(isRecording) {
  if (useNativeCaptureMode) {
    recordStartBtn.disabled = false;
    recordStopBtn.disabled = true;
    return;
  }

  recordStartBtn.disabled = isRecording;
  recordStopBtn.disabled = !isRecording;
}

function getAudioTrackState(stream) {
  const track = stream?.getAudioTracks?.()[0];
  if (!track) {
    return { hasAudioTrack: false, enabled: false, muted: true, readyState: "ended" };
  }

  return {
    hasAudioTrack: true,
    enabled: track.enabled,
    muted: track.muted,
    readyState: track.readyState,
  };
}

function buildRecordingStream(stream) {
  return new MediaStream([...stream.getVideoTracks(), ...stream.getAudioTracks()]);
}

function getSupportedMimeType() {
  const mimeTypes = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return mimeTypes.find((item) => MediaRecorder.isTypeSupported(item)) || "";
}

async function enableCamera() {
  if (!uploadBackendAvailable) {
    setRecordStatus("Camera upload is disabled on this deployment. Use a video URL instead.", "warning");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setRecordStatus("Camera API is not available in this browser.", "error");
    return;
  }

  if (cameraStream) {
    setRecordStatus("Camera already enabled.", "info");
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    cameraStream.getAudioTracks().forEach((track) => {
      if (!track.enabled) {
        track.enabled = true;
      }
    });
    cameraPreview.srcObject = cameraStream;

    const audioState = getAudioTrackState(cameraStream);
    if (!audioState.hasAudioTrack) {
      setRecordStatus("Camera enabled, but microphone track is missing. Check mic permissions for this site.", "warning");
    } else if (audioState.muted || !audioState.enabled || audioState.readyState !== "live") {
      setRecordStatus("Camera enabled, but microphone is not active yet. Check browser mic permissions and input device.", "warning");
    } else {
      setRecordStatus("Camera and microphone enabled. Start recording when ready.", "success");
    }
  } catch {
    setRecordStatus("Camera permission denied or unavailable.", "error");
  }
}

function clearRecording() {
  const hasRecordedVideo = Boolean(recordedVideoBlob || recordedVideoUrl || uploadedVideoUrl);
  if (!hasRecordedVideo) {
    setRecordStatus("Nothing to clear yet.", "warning");
    syncRecordingControls();
    return;
  }

  if (recordedVideoUrl) {
    URL.revokeObjectURL(recordedVideoUrl);
    recordedVideoUrl = "";
  }
  recordedVideoBlob = null;
  uploadedVideoUrl = "";
  setRecordStatus("Recorded video cleared.", "info");
  syncRecordingControls();
  updatePreview();
}

function startRecording() {
  if (useNativeCaptureMode) {
    if (!nativeRecorderInput) {
      setRecordStatus("Native camera capture is unavailable on this browser.", "error");
      return;
    }

    setRecordStatus("Opening camera capture...", "info");
    nativeRecorderInput.value = "";
    nativeRecorderInput.click();
    return;
  }

  if (!uploadBackendAvailable) {
    setRecordStatus("Camera upload is disabled on this deployment. Use a video URL instead.", "warning");
    return;
  }

  if (!cameraStream) {
    setRecordStatus("Enable your camera first.", "warning");
    return;
  }

  if (mediaRecorder && mediaRecorder.state === "recording") {
    return;
  }

  const mimeType = getSupportedMimeType();
  const audioState = getAudioTrackState(cameraStream);
  const shouldForceMimeType = Boolean(mimeType) && !isAppleMobile;
  const useIosRecorderMode = isAppleMobile;

  try {
    recordingStream = useIosRecorderMode ? cameraStream : buildRecordingStream(cameraStream);
    mediaRecorder = shouldForceMimeType
      ? new MediaRecorder(recordingStream, { mimeType })
      : new MediaRecorder(recordingStream);
  } catch {
    recordingStream = null;
    setRecordStatus("Recording is not supported in this browser.", "error");
    return;
  }

  recordedChunks = [];
  clearRecording();
  setRecordingButtons(true);

  const recorder = mediaRecorder;
  let finalized = false;
  let stopRequested = false;
  let stopObserved = false;
  let postStopTimerId = null;
  let emergencyFinalizeTimerId = null;
  let flushIntervalId = null;

  const clearFinalizeTimers = () => {
    if (postStopTimerId) {
      clearTimeout(postStopTimerId);
      postStopTimerId = null;
    }
    if (emergencyFinalizeTimerId) {
      clearTimeout(emergencyFinalizeTimerId);
      emergencyFinalizeTimerId = null;
    }
    if (flushIntervalId) {
      clearInterval(flushIntervalId);
      flushIntervalId = null;
    }
  };

  const scheduleFinalizeAfterStop = (delayMs) => {
    if (postStopTimerId) {
      clearTimeout(postStopTimerId);
    }
    postStopTimerId = setTimeout(() => {
      if (stopRequested && stopObserved) {
        finalizeRecording(recorder.mimeType || "video/webm");
      }
    }, delayMs);
  };

  const finalizeRecording = (recorderMimeType) => {
    if (finalized) {
      return;
    }
    finalized = true;
    clearFinalizeTimers();
    finalizeCurrentRecording = null;
    requestStopCurrentRecording = null;

    const blob = new Blob(recordedChunks, { type: recorderMimeType || "video/webm" });
    recordingStream = null;
    mediaRecorder = null;

    if (blob.size > 0) {
      recordedVideoBlob = blob;
      uploadedVideoUrl = "";
      recordedVideoUrl = URL.createObjectURL(blob);
      videoUrlInput.value = "";
      if (audioState.hasAudioTrack && audioState.enabled && !audioState.muted) {
        setRecordStatus("Recording ready with microphone audio. Generate a share link to upload it.", "success");
      } else {
        setRecordStatus("Recording ready, but microphone audio may be missing. Check mic permissions if playback is silent.", "warning");
      }
      syncRecordingControls();
      updatePreview();
    } else {
      setRecordStatus("No video captured. Try recording again.", "warning");
    }
    setRecordingButtons(false);
  };

  finalizeCurrentRecording = finalizeRecording;
  requestStopCurrentRecording = () => {
    if (stopRequested) {
      return;
    }

    stopRequested = true;

    if (recorder.state === "recording") {
      if (useIosRecorderMode) {
        try {
          recorder.requestData();
        } catch {
        }

        setTimeout(() => {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }, 150);
      } else {
        recorder.stop();
      }
    }

    emergencyFinalizeTimerId = setTimeout(() => {
      if (!finalized) {
        finalizeRecording(recorder.mimeType || "video/webm");
      }
    }, 5000);
  };

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);

      if (stopRequested && stopObserved) {
        scheduleFinalizeAfterStop(120);
      }
    }
  };

  recorder.onstop = () => {
    stopObserved = true;
    scheduleFinalizeAfterStop(recordedChunks.length > 0 ? 120 : 1800);
  };

  recorder.onerror = () => {
    clearFinalizeTimers();
    finalizeCurrentRecording = null;
    requestStopCurrentRecording = null;
    finalized = true;
    recordingStream = null;
    mediaRecorder = null;
    setRecordingButtons(false);
    setRecordStatus("Recording failed. Try again after checking camera and microphone permissions.", "error");
  };

  if (useIosRecorderMode) {
    recorder.start();
    flushIntervalId = setInterval(() => {
      if (recorder.state !== "recording") {
        return;
      }

      try {
        recorder.requestData();
      } catch {
      }
    }, 1000);
  } else {
    recorder.start(recordingChunkIntervalMs);
  }
  if (audioState.hasAudioTrack && audioState.enabled && !audioState.muted && audioState.readyState === "live") {
    setRecordStatus("Recording in progress with microphone audio...", "info");
  } else {
    setRecordStatus("Recording in progress without microphone audio. Allow mic access to include sound.", "warning");
  }
}

function stopRecording() {
  if (useNativeCaptureMode) {
    setRecordStatus("In iPhone mode, use Open Camera to record and finish from the native recorder.", "info");
    return;
  }

  if (!mediaRecorder || mediaRecorder.state !== "recording") {
    if (finalizeCurrentRecording) {
      setRecordStatus("Finalizing recording... please wait.", "info");
      return;
    }

    setRecordStatus("No active recording.", "warning");
    return;
  }

  setRecordStatus("Finalizing recording...", "info");

  if (requestStopCurrentRecording) {
    requestStopCurrentRecording();
    return;
  }

  mediaRecorder.stop();
}

function handleNativeCaptureSelection() {
  const selectedFile = nativeRecorderInput?.files?.[0];
  if (!selectedFile) {
    setRecordStatus("No video selected. Tap Open Camera to try again.", "warning");
    return;
  }

  if (!selectedFile.type || !selectedFile.type.startsWith("video/")) {
    setRecordStatus("Selected file is not a video. Please record a video clip.", "warning");
    return;
  }

  clearRecording();
  recordedVideoBlob = selectedFile;
  uploadedVideoUrl = "";
  recordedVideoUrl = URL.createObjectURL(selectedFile);
  videoUrlInput.value = "";
  syncRecordingControls();
  updatePreview();
  setRecordStatus("Recording ready. Generate a share link to upload it.", "success");
}

function stopCamera() {
  if (!cameraStream) {
    return;
  }

  cameraStream.getTracks().forEach((track) => track.stop());
  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop());
    recordingStream = null;
  }
  cameraPreview.srcObject = null;
  cameraStream = null;
}

[toNameInput, fromNameInput, headlineInput, messageInput].forEach((field) => {
  field.addEventListener("input", () => {
    updateCharCounters();
    schedulePreviewUpdate();
  });
});

videoUrlInput.addEventListener("input", () => {
  if (videoUrlInput.value.trim() && recordedVideoUrl) {
    clearRecording();
    setRecordStatus("Using URL video source. Recorded video was cleared.", "info");
  }
  schedulePreviewUpdate();
});

generateBtn.addEventListener("click", () => {
  generateShareUrl();
});
copyBtn.addEventListener("click", copyShareUrl);
resetBtn.addEventListener("click", resetAll);
cameraEnableBtn.addEventListener("click", enableCamera);
recordStartBtn.addEventListener("click", startRecording);
recordStopBtn.addEventListener("click", stopRecording);
recordClearBtn.addEventListener("click", () => {
  clearRecording();
});

if (nativeRecorderInput) {
  nativeRecorderInput.addEventListener("change", handleNativeCaptureSelection);
}

window.addEventListener("beforeunload", () => {
  stopCamera();
  if (recordedVideoUrl) {
    URL.revokeObjectURL(recordedVideoUrl);
  }
});

setRecordingButtons(false);
if (useNativeCaptureMode) {
  recordStartBtn.textContent = "Open Camera";
  cameraEnableBtn.disabled = true;
  setRecordStatus("iPhone mode: use Open Camera to record reliably.", "info");
}
loadStateFromQuery()
  .catch(() => {})
  .finally(() => {
    updateCharCounters();
    updatePreview();
    syncCopyButtonState();
    syncRecordingControls();
    detectUploadBackendAvailability();
  });
