const $ = (id) => document.getElementById(id);
const state = { topic: null, recent: JSON.parse(localStorage.getItem("saymore.recent") || "[]"), seconds: 300, remaining: 300, overtime: 0, elapsedSeconds: 0, continued: false, interval: null, started: false, finished: false, finishing: false, sessionSaved: false, sessionStartedAt: null, recorder: null, chunks: [], audioBlob: null, recordInterval: null, recordSeconds: 0, sound: localStorage.getItem("saymore.sound") !== "off", topicCount: Number(localStorage.getItem("saymore.count") || 0) };
const DB_NAME = "saymore-progress";
const DB_STORE = "sessions";
const METRICS = { grammar: "Grammar", vocabulary: "Vocabulary", relevance: "Topic relevance", fluency: "Speaking fluency*" };

function openProgressDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE, { keyPath: "id", autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function listSessions() {
  const db = await openProgressDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll();
    request.onsuccess = () => { db.close(); resolve(request.result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
async function storeSession(session) {
  if (state.sessionSaved) return;
  const db = await openProgressDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).add(session);
    transaction.oncomplete = () => { db.close(); state.sessionSaved = true; resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}
async function clearSessions() {
  const db = await openProgressDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    transaction.objectStore(DB_STORE).clear();
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
  });
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  if (busy) button.dataset.original = button.innerHTML;
  button.innerHTML = busy ? `<span class="spinner"></span>${text}` : (button.dataset.original || button.innerHTML);
}
function toast(message) { const el = $("toast"); el.textContent = message; el.classList.remove("hidden"); clearTimeout(toast.timeout); toast.timeout = setTimeout(() => el.classList.add("hidden"), 3000); }
function updateTimer() {
  const total = state.finished && state.continued ? state.overtime : state.remaining;
  const m = String(Math.floor(total / 60)).padStart(2, "0"), s = String(total % 60).padStart(2, "0");
  $("timer").textContent = state.finished && state.continued ? `+${m}:${s}` : `${m}:${s}`;
  $("timerRing").style.setProperty("--progress", `${((300 - Math.max(0, state.remaining)) / 300) * 360}deg`);
}
function renderTopic(topic) {
  state.topic = topic;
  $("category").textContent = topic.category.toUpperCase();
  $("level").textContent = topic.level === "Stretch" ? "A LITTLE CHALLENGE" : "EASY DOES IT";
  $("topicTitle").textContent = topic.title;
  $("topicExplanation").textContent = topic.explanation;
  $("topicExample").textContent = topic.example;
  $("exampleBox").hidden = false;
  state.topicCount += 1;
  localStorage.setItem("saymore.count", String(state.topicCount));
  $("topicCounter").innerHTML = `${String(state.topicCount).padStart(2, "0")} <i>/</i> ∞`;
  $("topicActions").classList.add("hidden");
  $("session").classList.remove("hidden");
  resetSession();
}
function resetSession() {
  clearInterval(state.interval); state.interval = null; state.seconds = 300; state.remaining = 300; state.overtime = 0; state.elapsedSeconds = 0; state.recordSeconds = 0; state.audioBlob = null; state.chunks = []; state.continued = false; state.started = false; state.finished = false; state.finishing = false; state.sessionSaved = false; state.sessionStartedAt = null;
  updateTimer(); $("timerCaption").textContent = "READY?"; $("timerHint").textContent = "Start when you're ready. The five minutes are yours.";
  $("startButton").disabled = false; $("startButton").innerHTML = '<span>Start speaking</span><span class="button-arrow">▶</span>';
  $("ideaButton").disabled = true; $("ideaBox").classList.add("hidden"); $("feedbackResult").classList.add("hidden"); $("feedbackError").classList.add("hidden"); $("feedbackStatus").textContent = "When you finish, your recording will be transcribed and reviewed by Gemini."; state.audioBlob = null; $("timerFinished").classList.add("hidden"); $("finishButton").classList.add("hidden"); $("feedbackPanel").classList.add("hidden"); $("anotherTopic").classList.remove("hidden"); $("recordingLive").classList.add("hidden");
}
async function newTopic() {
  const button = $("newTopic"); setBusy(button, true, "Finding a fresh topic…");
  try {
    const response = await fetch("/api/topic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recent: state.recent }) });
    if (!response.ok) throw new Error("Could not get a topic.");
    const topic = await response.json(); state.recent.push(topic.title); state.recent = state.recent.slice(-12); localStorage.setItem("saymore.recent", JSON.stringify(state.recent)); renderTopic(topic);
  } catch (error) { toast("Couldn't load a topic just now. Try again."); }
  finally { setBusy(button, false); }
}
async function startTimer() {
  if (state.started) return;
  state.started = true;
  const startButton = $("startButton");
  startButton.disabled = true;
  startButton.innerHTML = '<span>Starting microphone…</span>';
  $("anotherTopic").classList.add("hidden");
  const recordingStarted = await toggleRecording();
  state.sessionStartedAt = new Date().toISOString();
  if (!recordingStarted) $("feedbackStatus").textContent = "Microphone access was unavailable. You can still practise, but automatic speech feedback won't be available this session.";
  else $("recordingLive").classList.remove("hidden");
  $("timerCaption").textContent = "YOUR TIME";
  startButton.innerHTML = '<span>Speaking time</span><span class="button-arrow">✓</span>';
  $("ideaButton").disabled = false;
  $("finishButton").classList.remove("hidden");
  $("timerHint").textContent = "Keep going in English. If you get stuck, ask for a small idea.";
  state.interval = setInterval(() => {
    state.elapsedSeconds += 1;
    if (state.remaining > 0) {
      state.remaining -= 1;
      updateTimer();
      if (state.remaining === 0) {
        state.finished = true;
        $("timerCaption").textContent = "5 MINUTES";
        $("timerHint").textContent = "Your five-minute goal is done. Continue if you have more to say.";
        $("timerFinished").classList.remove("hidden");
        if (state.sound) beep();
      }
    } else if (state.finished && state.continued) {
      state.overtime += 1;
      updateTimer();
    }
  }, 1000);
}
function beep() { try { const C = window.AudioContext || window.webkitAudioContext; const context = new C(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 660; gain.gain.value = .08; oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .18); } catch (_) {} }
async function getIdea() {
  const button = $("ideaButton"); button.disabled = true; button.innerHTML = "<span>✦</span> Finding an idea…";
  try { const response = await fetch("/api/idea", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: state.topic.title }) }); const data = await response.json(); if (!response.ok) throw new Error(); $("ideaText").textContent = data.idea; $("ideaBox").classList.remove("hidden"); }
  catch (_) { toast("Couldn't find an idea just now. Try again."); }
  finally { button.disabled = false; button.innerHTML = "<span>✦</span> Need an idea?"; }
}
async function finishSession() {
  if (state.finishing) return;
  state.finishing = true;
  clearInterval(state.interval);
  state.interval = null;
  $("session").classList.add("hidden");
  $("recordingLive").classList.add("hidden");
  $("feedbackPanel").classList.remove("hidden");
  $("feedbackPanel").scrollIntoView({ behavior: "smooth", block: "center" });
  if (!state.recorder || state.recorder.state !== "recording") {
    $("feedbackStatus").textContent = "No recording is available to transcribe. Check microphone permission and try another session.";
    await saveCurrentSession("", null, "recording_unavailable");
    return;
  }
  $("feedbackStatus").textContent = "Transcribing your speech and preparing your feedback…";
  const stopped = new Promise(resolve => { state.recordStopResolve = resolve; });
  state.recorder.stop();
  await stopped;
  if (state.audioBlob && state.audioBlob.size) {
    const saved = await submitFeedback();
    if (!saved) await saveCurrentSession("", null, "feedback_unavailable");
  } else {
    $("feedbackError").textContent = "No speech recording was captured. Please try again.";
    $("feedbackError").classList.remove("hidden");
    await saveCurrentSession("", null, "recording_empty");
  }
}
async function toggleRecording() {
  if (state.recorder && state.recorder.state === "recording") return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.chunks = [];
    state.audioBlob = null;
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type));
    state.recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 });
    state.recorder.ondataavailable = event => { if (event.data.size) state.chunks.push(event.data); };
    state.recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
      clearInterval(state.recordInterval);
      state.audioBlob = new Blob(state.chunks, { type: state.recorder.mimeType || "audio/webm" });
      $("recordingStatus").classList.add("hidden");
      $("recordButton").classList.remove("recording");
      $("recordLabel").textContent = "Recording complete";
      $("feedbackSubmit").disabled = !state.audioBlob.size;
      if (state.recordStopResolve) { const resolve = state.recordStopResolve; state.recordStopResolve = null; resolve(); }
    };
    state.recorder.start(1000);
    state.recordSeconds = 0;
    $("recordingStatus").classList.remove("hidden");
    $("recordButton").classList.add("recording");
    $("recordLabel").textContent = "Recording your speaking";
    $("recordNote").textContent = "The recording stays in this browser until you finish the session.";
    state.recordInterval = setInterval(() => {
      state.recordSeconds++;
      $("recordingClock").textContent = `${String(Math.floor(state.recordSeconds / 60)).padStart(2, "0")}:${String(state.recordSeconds % 60).padStart(2, "0")}`;
    }, 1000);
    return true;
  } catch (_) {
    toast("Allow microphone access to get automatic feedback. You can still practise without it.");
    return false;
  }
}
function renderFeedback(data) {
  const feedback = data.feedback || {};
  const scoreHtml = Object.entries(METRICS).map(([metric, label]) => {
    const score = getMetricValue(feedback, metric);
    const reason = feedback.scores?.[metric]?.reason || "";
    return `<div class="feedback-score"><span>${escapeHtml(label)}</span><b>${score === null ? "—" : `${score}/10`}</b><small>${escapeHtml(reason)}</small></div>`;
  }).join("");
  const corrections = (Array.isArray(feedback.corrections) ? feedback.corrections : []).map(item => `<div class="correction-item"><p><b>You said</b> ${escapeHtml(item.original || "")}</p><p><b>Try</b> ${escapeHtml(item.improved || "")}</p><small>${escapeHtml(item.reason || "")}</small></div>`).join("");
  $("feedbackResult").innerHTML = `<div class="feedback-overall">OVERALL SESSION SCORE <b>${overallFor(feedback) === null ? "—" : `${overallFor(feedback).toFixed(1)}/10`}</b></div><div class="feedback-score-grid">${scoreHtml}</div><h4>What went well</h4><p>${escapeHtml(feedback.what_went_well || "You made time to practise—that counts.")}</p><h4>One thing to improve</h4><p>${escapeHtml(feedback.improve || "Keep using clear, simple sentences.")}</p><h4>Sentence examples</h4>${corrections || '<p>No specific correction this time. Keep going!</p>'}<h4>Your next small step</h4><p>${escapeHtml(feedback.next_tip || "Keep practising a little each day.")}</p><p class="transcript">“${escapeHtml(data.transcript || "") }”</p>`;
  $("feedbackResult").classList.remove("hidden");
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function getMetricValue(feedback, metric) {
  const value = feedback?.scores?.[metric];
  const number = Number(typeof value === "object" ? value?.score : value);
  return Number.isFinite(number) && number > 0 ? Math.max(1, Math.min(10, number)) : null;
}
function overallFor(feedback) {
  const values = Object.keys(METRICS).map(metric => getMetricValue(feedback, metric)).filter(value => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function startOfWeek(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}
function formatDate(value, includeTime = false) {
  const options = includeTime ? { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" };
  return new Date(value).toLocaleString(undefined, options);
}
function formatDuration(seconds) {
  const mins = Math.floor((seconds || 0) / 60), secs = Math.floor((seconds || 0) % 60);
  return mins ? `${mins} min${secs ? ` ${secs}s` : ""}` : `${secs}s`;
}
function rankFor(score) {
  if (score === null) return "Starting";
  if (score < 4) return "Starting";
  if (score < 6) return "Building";
  if (score < 8) return "Growing";
  return "Confident";
}
function updateGrowthText(current, previous) {
  if (current === null || previous === null) return { label: "Building your baseline", change: "Need two weeks of scored sessions to compare" };
  const change = current - previous;
  if (change >= 0.5) return { label: "Moving forward", change: `+${change.toFixed(1)} points vs last week` };
  if (change >= 0.15) return { label: "Making progress", change: `+${change.toFixed(1)} points vs last week` };
  if (change > -0.25) return { label: "Steady progress", change: `${change > 0 ? "+" : ""}${change.toFixed(1)} points vs last week` };
  return { label: "Keep building", change: `${change.toFixed(1)} points vs last week` };
}
async function saveCurrentSession(transcript, feedback, status) {
  const row = {
    createdAt: state.sessionStartedAt || new Date().toISOString(),
    topic: state.topic,
    durationSeconds: Math.max(state.recordSeconds, state.elapsedSeconds),
    transcript: transcript || "",
    feedback: feedback || null,
    status
  };
  try {
    await storeSession(row);
    if (!$("progressDashboard").classList.contains("hidden")) await renderDashboard();
  } catch (error) {
    console.error("Could not save this practice session", error);
    toast("This session couldn't be saved in this browser.");
  }
}
async function renderDashboard() {
  let sessions;
  try { sessions = await listSessions(); }
  catch (error) { console.error(error); toast("Couldn't open your local practice history."); return; }
  const now = new Date(), thisStart = startOfWeek(now), lastStart = new Date(thisStart); lastStart.setDate(lastStart.getDate() - 7);
  const nextStart = new Date(thisStart); nextStart.setDate(nextStart.getDate() + 7);
  const current = sessions.filter(item => { const date = new Date(item.createdAt); return date >= thisStart && date < nextStart; });
  const previous = sessions.filter(item => { const date = new Date(item.createdAt); return date >= lastStart && date < thisStart; });
  const currentScored = current.map(item => overallFor(item.feedback)).filter(value => value !== null);
  const previousScored = previous.map(item => overallFor(item.feedback)).filter(value => value !== null);
  const currentOverall = average(currentScored), previousOverall = average(previousScored);
  const latestScored = sessions.filter(item => overallFor(item.feedback) !== null).slice(0, 8);
  const levelAverage = average(latestScored.map(item => overallFor(item.feedback)));
  const weekEnd = new Date(nextStart); weekEnd.setDate(weekEnd.getDate() - 1);
  $("weekRange").textContent = `${formatDate(thisStart)} – ${formatDate(weekEnd)}  ·  compared with last week`;
  $("weekSessions").textContent = current.length;
  const seconds = current.reduce((total, item) => total + (item.durationSeconds || 0), 0);
  $("weekMinutes").textContent = `${Math.round(seconds / 60)} min`;
  $("previousMinutes").textContent = `${Math.round(previous.reduce((total, item) => total + (item.durationSeconds || 0), 0) / 60)} min last week`;
  $("weekScore").textContent = currentOverall === null ? "—" : `${currentOverall.toFixed(1)} / 10`;
  const growth = updateGrowthText(currentOverall, previousOverall);
  $("scoreChange").textContent = currentOverall === null ? "Finish a session to get your first score" : growth.change;
  $("currentRank").textContent = rankFor(levelAverage);
  $("growthRank").textContent = `Weekly growth: ${growth.label}`;

  $("scoreBars").innerHTML = Object.entries(METRICS).map(([metric, label]) => {
    const currentValue = average(current.map(item => getMetricValue(item.feedback, metric)).filter(value => value !== null));
    const previousValue = average(previous.map(item => getMetricValue(item.feedback, metric)).filter(value => value !== null));
    const delta = currentValue === null || previousValue === null ? "—" : `${currentValue - previousValue > 0 ? "+" : ""}${(currentValue - previousValue).toFixed(1)}`;
    return `<div class="skill-row"><div class="skill-label"><span>${escapeHtml(label)}</span><b>${currentValue === null ? "—" : currentValue.toFixed(1)}</b><small>${delta}</small></div><div class="skill-track"><i style="width:${currentValue === null ? 0 : currentValue * 10}%"></i></div></div>`;
  }).join("");

  const scoredDimensions = Object.keys(METRICS).map(metric => ({ metric, score: average(current.map(item => getMetricValue(item.feedback, metric)).filter(value => value !== null)) })).filter(item => item.score !== null);
  const strongest = [...scoredDimensions].sort((a, b) => b.score - a.score)[0];
  $("strengthInsight").textContent = strongest ? `${METRICS[strongest.metric]} is your strongest area this week (${strongest.score.toFixed(1)}/10).` : "Complete a session to see your strengths.";
  const tagCounts = new Map();
  current.forEach(item => {
    const sessionTags = new Set();
    (Array.isArray(item.feedback?.error_tags) ? item.feedback.error_tags : []).forEach(tag => {
      const name = typeof tag === "string" ? tag : tag.tag;
      if (!name || sessionTags.has(name)) return;
      sessionTags.add(name);
      const entry = tagCounts.get(name) || { count: 0, explanation: typeof tag === "object" ? tag.explanation : "" };
      entry.count += 1; if (!entry.explanation && typeof tag === "object") entry.explanation = tag.explanation || "";
      tagCounts.set(name, entry);
    });
  });
  const mostRepeated = [...tagCounts.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const weakest = [...scoredDimensions].sort((a, b) => a.score - b.score)[0];
  $("focusInsight").textContent = mostRepeated ? `${mostRepeated[0].replaceAll("_", " ")} appeared in ${mostRepeated[1].count} session${mostRepeated[1].count === 1 ? "" : "s"}${mostRepeated[1].explanation ? ` — ${mostRepeated[1].explanation}` : "."}` : weakest ? `${METRICS[weakest.metric]} is a good area to practise next (${weakest.score.toFixed(1)}/10).` : "Repeated improvement points will show up here.";
  $("nextFocus").textContent = mostRepeated ? `In your next practice, notice ${mostRepeated[0].replaceAll("_", " ")} and try one corrected sentence.` : weakest ? `Keep your focus small: practise ${METRICS[weakest.metric].toLowerCase()} in your next session.` : "One practice at a time.";
  $("historyList").innerHTML = sessions.length ? sessions.map(item => {
    const score = overallFor(item.feedback);
    return `<button class="history-row" data-session-id="${item.id}"><span class="history-date">${escapeHtml(formatDate(item.createdAt, true))}</span><span class="history-topic">${escapeHtml(item.topic?.title || "Speaking practice")}</span><span class="history-duration">${formatDuration(item.durationSeconds)}</span><span class="history-score">${score === null ? "Pending" : `${score.toFixed(1)}/10`}</span><span class="history-chevron">›</span></button>`;
  }).join("") : '<p class="empty-history">Your finished sessions will appear here.</p>';
  $("historyList").querySelectorAll("[data-session-id]").forEach(button => button.addEventListener("click", () => openSessionDetail(Number(button.dataset.sessionId))));
}
async function openSessionDetail(id) {
  const sessions = await listSessions();
  const item = sessions.find(session => session.id === id);
  if (!item) return;
  const feedback = item.feedback;
  const scoreBlock = feedback?.scores ? `<div class="detail-score-grid">${Object.entries(METRICS).map(([metric, label]) => { const value = getMetricValue(feedback, metric); const reason = feedback.scores[metric]?.reason || ""; return `<div><span>${escapeHtml(label)}</span><b>${value === null ? "—" : `${value}/10`}</b><small>${escapeHtml(reason)}</small></div>`; }).join("")}</div>` : '<p class="detail-muted">Scores are unavailable for this session.</p>';
  const corrections = (Array.isArray(feedback?.corrections) ? feedback.corrections : []).map(item => `<div class="correction-item"><p><b>You said</b> ${escapeHtml(item.original || "")}</p><p><b>Try</b> ${escapeHtml(item.improved || "")}</p><small>${escapeHtml(item.reason || "")}</small></div>`).join("") || '<p class="detail-muted">No specific sentence corrections for this session.</p>';
  $("sessionDetails").innerHTML = `<p class="detail-date">${escapeHtml(formatDate(item.createdAt, true))} · ${formatDuration(item.durationSeconds)}</p><h2>${escapeHtml(item.topic?.title || "Speaking practice")}</h2><div class="feedback-overall">OVERALL SESSION SCORE <b>${overallFor(feedback) === null ? "—" : `${overallFor(feedback).toFixed(1)}/10`}</b></div><h3>Score breakdown</h3>${scoreBlock}<h3>What went well</h3><p>${escapeHtml(feedback?.what_went_well || "Feedback wasn't available for this session.")}</p><h3>Sentences to improve</h3>${corrections}<h3>Transcript</h3><div class="transcript-text">${escapeHtml(item.transcript || "Transcript wasn't saved for this session.")}</div><h3>Next small step</h3><p>${escapeHtml(feedback?.next_tip || "Try another short practice session.")}</p>`;
  $("sessionDialog").showModal();
}
async function submitFeedback() {
  if (!state.audioBlob) return false;
  const button = $("feedbackSubmit");
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span>Transcribing and reviewing…';
  $("feedbackStatus").textContent = "Transcribing your speech and preparing your feedback…";
  $("feedbackError").classList.add("hidden");
  let success = false;
  try {
    const form = new FormData();
    const audioName = state.audioBlob.type.includes("mp4") ? "speaking-practice.mp4" : "speaking-practice.webm";
    form.append("audio", state.audioBlob, audioName);
    form.append("topic", state.topic?.title || "Speaking practice");
    const response = await fetch("/api/feedback", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Feedback is unavailable right now.");
    if (data.feedback) {
      renderFeedback(data);
      $("feedbackStatus").textContent = "Feedback is ready. Your transcript and suggestions are below.";
      await saveCurrentSession(data.transcript, data.feedback, "complete");
    } else {
      $("feedbackStatus").textContent = "Your transcript is ready, but feedback couldn't be generated.";
      $("feedbackError").textContent = data.feedback_error || "Transcript saved without scores this time.";
      $("feedbackError").classList.remove("hidden");
      await saveCurrentSession(data.transcript, null, "transcription_only");
    }
    success = true;
  } catch (error) {
    $("feedbackError").textContent = error.message;
    $("feedbackError").classList.remove("hidden");
    $("feedbackStatus").textContent = "I couldn't prepare feedback this time.";
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>Get my feedback</span><span class="button-arrow">↗</span>';
    state.audioBlob = null;
    state.chunks = [];
  }
  return success;
}
$("newTopic").addEventListener("click", newTopic); $("anotherTopic").addEventListener("click", newTopic); $("startButton").addEventListener("click", startTimer); $("ideaButton").addEventListener("click", getIdea); $("finishButton").addEventListener("click", finishSession); $("continueButton").addEventListener("click", () => { state.continued = true; $("timerFinished").classList.add("hidden"); $("timerHint").textContent = "Keep going for as long as you like. The timer will count your extra time."; }); $("recordButton").addEventListener("click", toggleRecording); $("feedbackSubmit").addEventListener("click", submitFeedback); $("closeFeedback").addEventListener("click", () => { $("feedbackPanel").classList.add("hidden"); $("topicActions").classList.remove("hidden"); });
$("soundToggle").classList.toggle("muted", !state.sound); $("soundToggle").addEventListener("click", () => { state.sound = !state.sound; localStorage.setItem("saymore.sound", state.sound ? "on" : "off"); $("soundToggle").classList.toggle("muted", !state.sound); toast(state.sound ? "Timer sound on" : "Timer sound off"); });
$("progressButton").addEventListener("click", async () => { $("progressDashboard").classList.remove("hidden"); await renderDashboard(); $("progressDashboard").scrollIntoView({ behavior: "smooth", block: "start" }); });
$("closeReview").addEventListener("click", () => { $("progressDashboard").classList.add("hidden"); document.querySelector(".practice-card")?.scrollIntoView({ behavior: "smooth", block: "center" }); });
$("clearHistory").addEventListener("click", async () => {
  if (!window.confirm("Clear all saved transcripts, feedback, and progress from this browser? This cannot be undone.")) return;
  try { await clearSessions(); await renderDashboard(); toast("Your local practice history was cleared."); }
  catch (error) { console.error(error); toast("Couldn't clear the saved history."); }
});
$("closeDialog").addEventListener("click", () => $("sessionDialog").close());
$("sessionDialog").addEventListener("click", event => { if (event.target === $("sessionDialog")) $("sessionDialog").close(); });
