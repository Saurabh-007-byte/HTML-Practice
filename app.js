"use strict";

const $ = (sel) => document.querySelector(sel);
const today = () => new Date().toISOString().slice(0, 10);

// ---------- Storage helper (safe if localStorage is blocked) ----------
const store = {
    get(key, fallback) {
        try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
        catch { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    },
};

// ---------- Theme ----------
const root = document.documentElement;
function setTheme(theme) {
    root.dataset.theme = theme;
    $("#themeToggle").textContent = theme === "dark" ? "☀️" : "🌙";
    store.set("theme", theme);
}
setTheme(store.get("theme", matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
$("#themeToggle").addEventListener("click", () =>
    setTheme(root.dataset.theme === "dark" ? "light" : "dark"));
$("#date").textContent = new Date().toLocaleDateString(undefined,
    { weekday: "long", month: "long", day: "numeric" });

// ---------- Tasks ----------
let tasks = store.get("tasks", []);
let filter = "all";
let dragId = null;
const saveTasks = () => store.set("tasks", tasks);

function el(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
}

function renderTasks() {
    const list = $("#taskList");
    list.replaceChildren();
    const shown = tasks.filter((t) =>
        filter === "all" || (filter === "active" ? !t.done : t.done));

    if (!shown.length) list.append(el("li", { className: "empty", textContent: "Nothing here. Add a task above." }));

    shown.forEach((t) => {
        const li = el("li", { className: "task" + (t.done ? " done" : ""), draggable: true });
        li.dataset.id = t.id;
        li.dataset.priority = t.priority;

        const check = el("input", { type: "checkbox", checked: t.done });
        check.setAttribute("aria-label", "Mark complete");
        check.addEventListener("change", () => { t.done = check.checked; saveTasks(); renderTasks(); });

        const meta = el("small", { textContent: t.due ? "Due " + t.due : "No due date" });
        if (t.due && !t.done && t.due < today()) meta.classList.add("overdue");
        const body = el("div", { className: "task-body" }, el("span", { textContent: t.text }), meta);

        const edit = el("button", { textContent: "✏️", title: "Edit" });
        edit.addEventListener("click", () => {
            const text = prompt("Edit task", t.text);
            if (text && text.trim()) { t.text = text.trim(); saveTasks(); renderTasks(); }
        });
        const del = el("button", { textContent: "🗑️", title: "Delete" });
        del.addEventListener("click", () => {
            tasks = tasks.filter((x) => x.id !== t.id); saveTasks(); renderTasks();
        });

        // Drag-and-drop reordering
        li.addEventListener("dragstart", () => { dragId = t.id; li.classList.add("dragging"); });
        li.addEventListener("dragend", () => li.classList.remove("dragging"));
        li.addEventListener("dragover", (e) => e.preventDefault());
        li.addEventListener("drop", (e) => {
            e.preventDefault();
            if (dragId === null || dragId === t.id) return;
            const from = tasks.findIndex((x) => x.id === dragId);
            const [moved] = tasks.splice(from, 1);
            tasks.splice(tasks.findIndex((x) => x.id === t.id), 0, moved);
            saveTasks(); renderTasks();
        });

        li.append(check, body, edit, del);
        list.append(li);
    });

    const open = tasks.filter((t) => !t.done).length;
    $("#taskCount").textContent = `${open} open · ${tasks.length - open} done`;
}

$("#taskForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#taskInput").value.trim();
    if (!text) return;
    tasks.unshift({
        id: Date.now(), text, done: false,
        priority: $("#taskPriority").value, due: $("#taskDate").value,
    });
    saveTasks(); renderTasks();
    e.target.reset();
    $("#taskPriority").value = "medium";
    $("#taskInput").focus();
});

document.querySelectorAll("[data-filter]").forEach((btn) =>
    btn.addEventListener("click", () => {
        filter = btn.dataset.filter;
        document.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("active", b === btn));
        renderTasks();
    }));
$("#clearDone").addEventListener("click", () => {
    tasks = tasks.filter((t) => !t.done); saveTasks(); renderTasks();
});

// ---------- Pomodoro ----------
const DURATIONS = { focus: 25 * 60, break: 5 * 60 };
let mode = "focus";
let remaining = DURATIONS.focus;
let timerId = null;
let endAt = 0;
let stats = store.get("sessions", { date: today(), count: 0 });
if (stats.date !== today()) stats = { date: today(), count: 0 };

function beep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.25, 0.5].forEach((delay) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = 880;
            gain.gain.value = 0.15;
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(ctx.currentTime + delay);
            osc.stop(ctx.currentTime + delay + 0.15);
        });
    } catch { /* audio unavailable */ }
}

function renderTimer() {
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    $("#timer").textContent = `${m}:${s}`;
    document.title = timerId ? `${m}:${s} · Desk` : "Desk — Productivity Dashboard";
    $("#bar").style.width = `${100 - (remaining / DURATIONS[mode]) * 100}%`;
    $("#sessions").textContent = `Focus sessions today: ${stats.count}`;
}

function stopTimer() {
    clearInterval(timerId); timerId = null;
    $("#startBtn").textContent = "Start";
}

function tick() {
    remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
    if (remaining === 0) {
        stopTimer(); beep();
        if (mode === "focus") { stats.count++; store.set("sessions", stats); }
        setMode(mode === "focus" ? "break" : "focus");
        return;
    }
    renderTimer();
}

function setMode(next) {
    stopTimer();
    mode = next;
    remaining = DURATIONS[mode];
    document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    renderTimer();
}

$("#startBtn").addEventListener("click", () => {
    if (timerId) { stopTimer(); renderTimer(); return; }
    endAt = Date.now() + remaining * 1000;
    timerId = setInterval(tick, 250);
    $("#startBtn").textContent = "Pause";
});
$("#resetBtn").addEventListener("click", () => setMode(mode));
document.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode)));

// ---------- Notes (auto-save) ----------
const notes = $("#notes");
notes.value = store.get("notes", "");
let noteTimer;
notes.addEventListener("input", () => {
    $("#saveStatus").textContent = "Saving…";
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
        store.set("notes", notes.value);
        $("#saveStatus").textContent = "Saved";
    }, 400);
});

// ---------- Init ----------
renderTasks();
renderTimer();