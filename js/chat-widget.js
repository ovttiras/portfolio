// ================================ AI-ассистент (RAG по блогу и портфолио)
// Адрес бэкенда задаётся атрибутом data-api-url у тега <script>.
(function () {
    const script = document.currentScript;
    const API_URL = ((script && script.dataset.apiUrl) || "http://localhost:8000").replace(/\/$/, "");
    const STORAGE_KEY = "rag-chat-history";
    const MAX_HISTORY = 12;

    const i18n = {
        en: {
            open: "Ask my AI",
            title: "AI assistant",
            subtitle: "Answers based on Oleg's blog & portfolio",
            welcome: "Hi! I'm Oleg's AI assistant. Ask me about his blog posts, projects, experience or skills.",
            placeholder: "Ask a question…",
            send: "Send",
            clear: "Clear chat",
            close: "Close",
            sources: "Sources",
            error: "Sorry, the assistant is unavailable right now. You can contact Oleg at oleg.tinkov.chem@mail.ru.",
            rateLimit: "Too many questions — please wait a minute.",
            disclaimer: "AI can make mistakes. Check the sources.",
            suggestions: [
                "What is Oleg's experience with RAG and LLMs?",
                "Which drug discovery projects has he built?",
                "What does he write about in his blog?",
                "How can I contact Oleg?"
            ]
        },
        ru: {
            open: "Спросить AI",
            title: "AI-ассистент",
            subtitle: "Отвечает по блогу и портфолио Олега",
            welcome: "Привет! Я AI-ассистент Олега. Спросите меня о его статьях в блоге, проектах, опыте или навыках.",
            placeholder: "Задайте вопрос…",
            send: "Отправить",
            clear: "Очистить чат",
            close: "Закрыть",
            sources: "Источники",
            error: "Извините, ассистент сейчас недоступен. Связаться с Олегом можно по адресу oleg.tinkov.chem@mail.ru.",
            rateLimit: "Слишком много вопросов — подождите минуту.",
            disclaimer: "AI может ошибаться. Проверяйте источники.",
            suggestions: [
                "Какой у Олега опыт с RAG и LLM?",
                "Какие проекты по разработке лекарств он сделал?",
                "О чём он пишет в блоге?",
                "Как связаться с Олегом?"
            ]
        }
    };

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
    const root = document.createElement("div");
    root.className = "rag-chat";
    root.innerHTML = `
        <button type="button" class="rag-chat-launcher" aria-expanded="false" aria-controls="rag-chat-panel">
            <i class="fas fa-robot"></i><span class="rag-chat-launcher-label"></span>
        </button>
        <div class="rag-chat-panel" id="rag-chat-panel" role="dialog" aria-modal="false" hidden>
            <div class="rag-chat-header">
                <div class="rag-chat-avatar"><i class="fas fa-robot"></i></div>
                <div class="rag-chat-heading">
                    <h4 class="rag-chat-title"></h4>
                    <p class="rag-chat-subtitle"></p>
                </div>
                <button type="button" class="rag-chat-icon-btn rag-chat-clear"><i class="fas fa-trash-alt"></i></button>
                <button type="button" class="rag-chat-icon-btn rag-chat-close"><i class="fas fa-times"></i></button>
            </div>
            <div class="rag-chat-messages" aria-live="polite"></div>
            <div class="rag-chat-suggestions"></div>
            <form class="rag-chat-form">
                <textarea class="rag-chat-input" rows="1" maxlength="1000"></textarea>
                <button type="submit" class="rag-chat-send"><i class="fas fa-paper-plane"></i></button>
            </form>
            <p class="rag-chat-disclaimer"></p>
        </div>`;
    document.body.appendChild(root);

    const $ = (sel) => root.querySelector(sel);
    const launcher = $(".rag-chat-launcher");
    const panel = $(".rag-chat-panel");
    const messagesEl = $(".rag-chat-messages");
    const suggestionsEl = $(".rag-chat-suggestions");
    const form = $(".rag-chat-form");
    const input = $(".rag-chat-input");
    const sendBtn = $(".rag-chat-send");

    function applyLanguage() {
        $(".rag-chat-launcher-label").textContent = t("open");
        launcher.setAttribute("aria-label", t("open"));
        $(".rag-chat-title").textContent = t("title");
        $(".rag-chat-subtitle").textContent = t("subtitle");
        $(".rag-chat-clear").title = t("clear");
        $(".rag-chat-clear").setAttribute("aria-label", t("clear"));
        $(".rag-chat-close").title = t("close");
        $(".rag-chat-close").setAttribute("aria-label", t("close"));
        $(".rag-chat-disclaimer").textContent = t("disclaimer");
        input.placeholder = t("placeholder");
        sendBtn.setAttribute("aria-label", t("send"));
        panel.setAttribute("aria-label", t("title"));
        renderAll();
    }

    function addMessage(role, text, sources) {
        const el = document.createElement("div");
        el.className = `rag-msg rag-msg-${role}`;
        const bubble = document.createElement("div");
        bubble.className = "rag-msg-bubble";
        el.appendChild(bubble);
        messagesEl.appendChild(el);
        updateMessage(el, role, text, sources || []);
        return el;
    }

    function updateMessage(el, role, text, sources) {
        const bubble = el.querySelector(".rag-msg-bubble");
        if (role === "user") bubble.textContent = text;
        else bubble.innerHTML = text ? renderMarkdown(text, sources) : '<span class="rag-typing"><i></i><i></i><i></i></span>';

        let list = el.querySelector(".rag-sources");
        if (list) list.remove();
        // Показываем только источники, на которые модель сослалась (или все, если ссылок нет)
        const cited = sources.filter((s) => text.includes(`[${s.n}]`));
        const shown = cited.length ? cited : (text && !busy ? sources : []);
        if (role === "assistant" && shown.length) {
            list = document.createElement("div");
            list.className = "rag-sources";
            list.innerHTML = `<span class="rag-sources-title">${t("sources")}:</span>` + shown.map((s) => {
                const label = `${s.n}. ${escapeHtml(s.title)}${s.date ? ` <small>${escapeHtml(s.date)}</small>` : ""}`;
                return s.url
                    ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${label}</a>`
                    : `<span>${label}</span>`;
            }).join("");
            el.appendChild(list);
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderAll() {
        messagesEl.innerHTML = "";
        addMessage("assistant", t("welcome"));
        history.forEach((m) => addMessage(m.role, m.content, m.sources));
        suggestionsEl.innerHTML = "";
        if (!history.length) {
            t("suggestions").forEach((q) => {
                const chip = document.createElement("button");
                chip.type = "button";
                chip.className = "rag-chip";
                chip.textContent = q;
                chip.addEventListener("click", () => ask(q));
                suggestionsEl.appendChild(chip);
            });
        }
    }

    // ---------------------------------------------------------------- Запрос
    async function ask(question) {
        question = question.trim();
        if (!question || busy) return;
        busy = true;
        sendBtn.disabled = true;
        suggestionsEl.innerHTML = "";
        input.value = "";
        autoGrow();

        const payloadHistory = history.slice(-MAX_HISTORY).map(({ role, content }) => ({ role, content }));
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
    function toggle(open) {
        panel.hidden = !open;
        root.classList.toggle("open", open);
        launcher.setAttribute("aria-expanded", String(open));
        if (open) {
            messagesEl.scrollTop = messagesEl.scrollHeight;
            input.focus();
        }
    }

    function autoGrow() {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 120) + "px";
    }

    launcher.addEventListener("click", () => toggle(panel.hidden));
    $(".rag-chat-close").addEventListener("click", () => toggle(false));
    $(".rag-chat-clear").addEventListener("click", () => {
        if (busy) return;
        history = [];
        saveHistory();
        renderAll();
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
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !panel.hidden) toggle(false);
    });
    document.querySelectorAll(".lang-btn").forEach((btn) => btn.addEventListener("click", () => {
        if (!busy) applyLanguage();
    }));

    applyLanguage();
})();
