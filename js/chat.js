// ================================ AI-ассистент (RAG по блогу и портфолио) — главный экран сайта
// Адрес бэкенда задаётся атрибутом data-api-url у тега <script>.
(function () {
    const script = document.currentScript;
    const API_URL = ((script && script.dataset.apiUrl) || "http://localhost:8000").replace(/\/$/, "");
    const STORAGE_KEY = "rag-chat-history";
    const MAX_HISTORY = 12;
    const AVATAR = "img/hero.jpg";

    const i18n = {
        en: {
            launcher: "Ask my AI",
            emptyTitle: "What would you like to know?",
            emptyText: "I'm Oleg's AI assistant. I answer based on his blog, projects and CV, with links to the sources.",
            placeholder: "Ask anything about Oleg…",
            send: "Send",
            clear: "New chat",
            sources: "Sources",
            error: "Sorry, the assistant is unavailable right now. You can contact Oleg at oleg.tinkov.chem@mail.ru.",
            rateLimit: "Too many questions — please wait a minute.",
            disclaimer: "AI can make mistakes. Check the sources.",
            suggestions: [
                ["fa-robot", "RAG & LLM", "What is Oleg's experience with RAG and LLMs?"],
                ["fa-flask", "Drug discovery", "Which drug discovery projects has he built?"],
                ["fa-pen-nib", "Blog", "What does he write about in his blog?"],
                ["fa-briefcase", "Career", "Where does Oleg work now and what does he do?"]
            ]
        },
        ru: {
            launcher: "Спросить AI",
            emptyTitle: "Что вы хотите узнать?",
            emptyText: "Я AI-ассистент Олега. Отвечаю по его блогу, проектам и резюме — со ссылками на источники.",
            placeholder: "Спросите что угодно об Олеге…",
            send: "Отправить",
            clear: "Новый чат",
            sources: "Источники",
            error: "Извините, ассистент сейчас недоступен. Связаться с Олегом можно по адресу oleg.tinkov.chem@mail.ru.",
            rateLimit: "Слишком много вопросов — подождите минуту.",
            disclaimer: "AI может ошибаться. Проверяйте источники.",
            suggestions: [
                ["fa-robot", "RAG и LLM", "Какой у Олега опыт с RAG и LLM?"],
                ["fa-flask", "Разработка лекарств", "Какие проекты по разработке лекарств он сделал?"],
                ["fa-pen-nib", "Блог", "О чём он пишет в блоге?"],
                ["fa-briefcase", "Карьера", "Где сейчас работает Олег и чем занимается?"]
            ]
        }
    };

    const root = document.getElementById("rag-chat");
    if (!root) return;
    const home = root.closest(".chat-home");
    const homeSection = document.getElementById("home");

    let history = loadHistory();
    let busy = false;

    function lang() {
        const ru = document.getElementById("ru-btn");
        return ru && ru.classList.contains("active") ? "ru" : "en";
    }
    const t = (key) => i18n[lang()][key];

    function loadHistory() {
        try {
            return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) || [];
        } catch (e) {
            return [];
        }
    }
    function saveHistory() {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
        } catch (e) { /* приватный режим — история живёт только в памяти */ }
    }

    // ---------------------------------------------------------------- Markdown
    function escapeHtml(text) {
        return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }

    function inline(text, sources) {
        return text
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
            .replace(/\[(\d+)\]/g, (match, n) => {
                const src = sources.find((s) => s.n === Number(n));
                if (!src) return match;
                const title = escapeHtml(src.title);
                return src.url
                    ? `<a class="rag-cite" href="${escapeHtml(src.url)}" target="_blank" rel="noopener" title="${title}">${n}</a>`
                    : `<span class="rag-cite" title="${title}">${n}</span>`;
            });
    }

    function renderMarkdown(md, sources) {
        const parts = escapeHtml(md).split(/```[\w-]*\n?/);
        let html = "";
        parts.forEach((part, i) => {
            if (i % 2 === 1) {
                html += `<pre><code>${part}</code></pre>`;
                return;
            }
            let list = null;
            part.split("\n").forEach((line) => {
                const item = line.match(/^\s*(?:[-*•]|(\d+)\.)\s+(.*)$/);
                if (item) {
                    const tag = item[1] ? "ol" : "ul";
                    if (list !== tag) {
                        if (list) html += `</${list}>`;
                        html += `<${tag}>`;
                        list = tag;
                    }
                    html += `<li>${inline(item[2], sources)}</li>`;
                    return;
                }
                if (list) {
                    html += `</${list}>`;
                    list = null;
                }
                const heading = line.match(/^#{1,4}\s+(.*)$/);
                if (heading) html += `<p><strong>${inline(heading[1], sources)}</strong></p>`;
                else if (line.trim()) html += `<p>${inline(line, sources)}</p>`;
            });
            if (list) html += `</${list}>`;
        });
        return html;
    }

    // ---------------------------------------------------------------- Разметка
    root.innerHTML = `
        <div class="rag-chat-messages" aria-live="polite"></div>
        <form class="rag-chat-form">
            <div class="rag-chat-inputbox">
                <textarea class="rag-chat-input" rows="1" maxlength="1000"></textarea>
                <button type="submit" class="rag-chat-send"><i class="fas fa-arrow-up"></i></button>
            </div>
            <div class="rag-chat-footer">
                <span class="rag-chat-disclaimer"></span>
                <button type="button" class="rag-chat-clear"><i class="fas fa-plus"></i> <span></span></button>
            </div>
        </form>`;

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "rag-chat-launcher";
    launcher.innerHTML = '<i class="fas fa-robot"></i><span></span>';
    document.body.appendChild(launcher);

    const $ = (sel) => root.querySelector(sel);
    const messagesEl = $(".rag-chat-messages");
    const form = $(".rag-chat-form");
    const input = $(".rag-chat-input");
    const sendBtn = $(".rag-chat-send");
    const clearBtn = $(".rag-chat-clear");

    function applyLanguage() {
        launcher.querySelector("span").textContent = t("launcher");
        launcher.setAttribute("aria-label", t("launcher"));
        clearBtn.querySelector("span").textContent = t("clear");
        $(".rag-chat-disclaimer").textContent = t("disclaimer");
        input.placeholder = t("placeholder");
        sendBtn.setAttribute("aria-label", t("send"));
        renderAll();
    }

    function renderEmptyState() {
        const empty = document.createElement("div");
        empty.className = "rag-empty";
        empty.innerHTML = `
            <h2 class="rag-empty-title">${escapeHtml(t("emptyTitle"))}</h2>
            <p class="rag-empty-text">${escapeHtml(t("emptyText"))}</p>
            <div class="rag-suggestions"></div>`;
        const grid = empty.querySelector(".rag-suggestions");
        t("suggestions").forEach(([icon, label, question]) => {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "rag-suggestion";
            card.innerHTML = `<i class="fas ${icon}"></i><span class="rag-suggestion-label">${escapeHtml(label)}</span>`
                + `<span class="rag-suggestion-text">${escapeHtml(question)}</span>`;
            card.addEventListener("click", () => ask(question));
            grid.appendChild(card);
        });
        messagesEl.appendChild(empty);
    }

    function addMessage(role, text, sources) {
        const el = document.createElement("div");
        el.className = `rag-msg rag-msg-${role}`;
        el.innerHTML = (role === "assistant" ? `<img class="rag-msg-avatar" src="${AVATAR}" alt="">` : "")
            + '<div class="rag-msg-body"><div class="rag-msg-bubble"></div></div>';
        messagesEl.appendChild(el);
        updateMessage(el, role, text, sources || []);
        return el;
    }

    function updateMessage(el, role, text, sources) {
        const body = el.querySelector(".rag-msg-body");
        const bubble = el.querySelector(".rag-msg-bubble");
        if (role === "user") bubble.textContent = text;
        else bubble.innerHTML = text ? renderMarkdown(text, sources) : '<span class="rag-typing"><i></i><i></i><i></i></span>';

        let list = el.querySelector(".rag-sources");
        if (list) list.remove();
        // Показываем источники, на которые модель сослалась (или все, если ссылок нет)
        const cited = sources.filter((s) => text.includes(`[${s.n}]`));
        const shown = cited.length ? cited : (text && !busy ? sources : []);
        if (role === "assistant" && shown.length) {
            list = document.createElement("div");
            list.className = "rag-sources";
            list.innerHTML = `<span class="rag-sources-title">${t("sources")}:</span>` + shown.map((s) => {
                const label = `<b>${s.n}</b> ${escapeHtml(s.title)}`;
                return s.url
                    ? `<a class="rag-source" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${label}</a>`
                    : `<span class="rag-source">${label}</span>`;
            }).join("");
            body.appendChild(list);
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderAll() {
        messagesEl.innerHTML = "";
        if (home) home.classList.toggle("chat-active", history.length > 0);
        if (!history.length) renderEmptyState();
        history.forEach((m) => addMessage(m.role, m.content, m.sources));
    }

    // ---------------------------------------------------------------- Запрос
    async function ask(question) {
        question = question.trim();
        if (!question || busy) return;
        busy = true;
        sendBtn.disabled = true;
        input.value = "";
        autoGrow();

        const payloadHistory = history.slice(-MAX_HISTORY).map(({ role, content }) => ({ role, content }));
        if (!history.length) {
            messagesEl.innerHTML = "";
            if (home) home.classList.add("chat-active");
        }
        history.push({ role: "user", content: question });
        addMessage("user", question);
        const reply = { role: "assistant", content: "", sources: [] };
        const el = addMessage("assistant", "");

        try {
            const resp = await fetch(`${API_URL}/api/chat/stream`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question, history: payloadHistory })
            });
            if (resp.status === 429) throw new Error("rate");
            if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const events = buffer.split("\n\n");
                buffer = events.pop();
                for (const raw of events) {
                    if (!raw.startsWith("data: ")) continue;
                    const event = JSON.parse(raw.slice(6));
                    if (event.type === "sources") reply.sources = event.sources;
                    else if (event.type === "token") reply.content += event.content;
                    else if (event.type === "error") throw new Error(event.message);
                }
                updateMessage(el, "assistant", reply.content, reply.sources);
            }
            if (!reply.content) throw new Error("empty");
        } catch (err) {
            console.warn("AI assistant:", err);
            reply.content = err.message === "rate" ? t("rateLimit") : t("error");
            reply.sources = [];
            reply.failed = true;
        } finally {
            busy = false;
            sendBtn.disabled = false;
            updateMessage(el, "assistant", reply.content, reply.sources);
            if (reply.failed) {
                history.pop(); // не отправляем неудачный вопрос в историю диалога
            } else {
                history.push({ role: "assistant", content: reply.content, sources: reply.sources });
                saveHistory();
            }
            input.focus();
        }
    }

    // ---------------------------------------------------------------- События
    function autoGrow() {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 160) + "px";
    }

    // Кнопка «Спросить AI» видна на остальных разделах и возвращает на главную с чатом
    function syncLauncher() {
        launcher.classList.toggle("visible", !homeSection.classList.contains("active"));
    }
    launcher.addEventListener("click", () => {
        // Переключаем раздел сами: клик по пункту меню на мобильных ещё и открывает боковую панель
        document.querySelectorAll(".section").forEach((s) => s.classList.remove("active", "back-section"));
        homeSection.classList.add("active");
        document.querySelectorAll(".nav a").forEach((a) => {
            a.classList.toggle("active", a.getAttribute("href") === "#home");
        });
        input.focus();
    });
    new MutationObserver(syncLauncher).observe(homeSection, { attributes: true, attributeFilter: ["class"] });

    clearBtn.addEventListener("click", () => {
        if (busy) return;
        history = [];
        saveHistory();
        renderAll();
        input.focus();
    });
    form.addEventListener("submit", (e) => {
        e.preventDefault();
        ask(input.value);
    });
    input.addEventListener("input", autoGrow);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            ask(input.value);
        }
    });
    document.querySelectorAll(".lang-btn").forEach((btn) => btn.addEventListener("click", () => {
        if (!busy) applyLanguage();
    }));

    applyLanguage();
    syncLauncher();
})();
