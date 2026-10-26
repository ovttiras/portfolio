// ================================ AI-ассистент (RAG по блогу и портфолио) — главный экран сайта
// Адрес бэкенда задаётся атрибутом data-api-url у тега <script>.
(function () {
    const script = document.currentScript;
    const API_URL = ((script && script.dataset.apiUrl) || "http://localhost:8000").replace(/\/$/, "");
    const STORAGE_KEY = "rag-chat-history";
    const MAX_HISTORY = 12;

    const i18n = {
        en: {
            launcher: "Ask my AI",
            placeholder: "Ask anything about Oleg…",
            model: "Gemini · LangChain RAG · blog, projects & CV",
            send: "Send",
            clear: "New question",
            sources: "Sources",
            error: "Sorry, the assistant is unavailable right now. You can contact Oleg at oleg.tinkov.chem@mail.ru.",
            rateLimit: "Too many questions — please wait a minute.",
            footnote: "† Gemini via Google AI Studio + LangChain RAG over Oleg's blog, projects and CV — answers cite their sources. AI can make mistakes.",
            suggestions: [
                ["fa-robot", "What is Oleg's experience with RAG and LLMs?"],
                ["fa-flask", "Which drug discovery projects has he built?"],
                ["fa-pen-nib", "What does he write about in his blog?"],
                ["fa-envelope", "How can I contact Oleg?"]
            ]
        },
        ru: {
            launcher: "Спросить AI",
            placeholder: "Спросите что угодно об Олеге…",
            model: "Gemini · LangChain RAG · блог, проекты и резюме",
            send: "Отправить",
            clear: "Новый вопрос",
            sources: "Источники",
            error: "Извините, ассистент сейчас недоступен. Связаться с Олегом можно по адресу oleg.tinkov.chem@mail.ru.",
            rateLimit: "Слишком много вопросов — подождите минуту.",
            footnote: "† Gemini через Google AI Studio + LangChain RAG по блогу, проектам и резюме Олега — ответы со ссылками на источники. AI может ошибаться.",
            suggestions: [
                ["fa-robot", "Какой у Олега опыт с RAG и LLM?"],
                ["fa-flask", "Какие проекты по разработке лекарств он сделал?"],
                ["fa-pen-nib", "О чём он пишет в блоге?"],
                ["fa-envelope", "Как связаться с Олегом?"]
            ]
        }
    };

    const root = document.getElementById("rag-chat");
    if (!root) return;
    const home = root.closest(".chat-home");
    const homeSection = document.getElementById("home");

    // Вся переписка уходит на сервер для уточняющих вопросов, но на экране — только последний ответ
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
        <form class="rag-chat-form">
            <div class="rag-chat-inputbox">
                <textarea class="rag-chat-input" rows="2" maxlength="1000"></textarea>
                <div class="rag-chat-bar">
                    <span class="rag-chat-model"><i class="rag-dot"></i><span></span></span>
                    <button type="submit" class="rag-chat-send"><i class="fas fa-arrow-up"></i></button>
                </div>
            </div>
        </form>
        <div class="rag-suggestions"></div>
        <div class="rag-answer" aria-live="polite" hidden>
            <div class="rag-answer-question"></div>
            <div class="rag-answer-bubble"></div>
            <div class="rag-answer-footer">
                <div class="rag-sources"></div>
                <button type="button" class="rag-chat-clear"><i class="fas fa-plus"></i> <span></span></button>
            </div>
        </div>
        <p class="rag-footnote"></p>`;

    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "rag-chat-launcher";
    launcher.innerHTML = '<i class="fas fa-robot"></i><span></span>';
    document.body.appendChild(launcher);

    const $ = (sel) => root.querySelector(sel);
    const form = $(".rag-chat-form");
    const input = $(".rag-chat-input");
    const sendBtn = $(".rag-chat-send");
    const clearBtn = $(".rag-chat-clear");
    const suggestionsEl = $(".rag-suggestions");
    const answerEl = $(".rag-answer");

    function applyLanguage() {
        launcher.querySelector("span").textContent = t("launcher");
        launcher.setAttribute("aria-label", t("launcher"));
        $(".rag-chat-model span").textContent = t("model");
        $(".rag-footnote").textContent = t("footnote");
        clearBtn.querySelector("span").textContent = t("clear");
        input.placeholder = t("placeholder");
        sendBtn.setAttribute("aria-label", t("send"));

        suggestionsEl.innerHTML = "";
        t("suggestions").forEach(([icon, question]) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "rag-chip";
            chip.innerHTML = `<i class="fas ${icon}"></i>${escapeHtml(question)}`;
            chip.addEventListener("click", () => ask(question));
            suggestionsEl.appendChild(chip);
        });
        renderLast();
    }

    function renderAnswer(question, text, sources) {
        answerEl.hidden = false;
        if (home) home.classList.add("chat-active");
        $(".rag-answer-question").textContent = question;
        $(".rag-answer-bubble").innerHTML = text
            ? renderMarkdown(text, sources)
            : '<span class="rag-typing"><i></i><i></i><i></i></span>';

        // Показываем источники, на которые модель сослалась (или все, если ссылок нет)
        const cited = sources.filter((s) => text.includes(`[${s.n}]`));
        const shown = cited.length ? cited : (text && !busy ? sources : []);
        $(".rag-sources").innerHTML = shown.length
            ? `<span class="rag-sources-title">${t("sources")}:</span>` + shown.map((s) => {
                const label = `<b>${s.n}</b> ${escapeHtml(s.title)}`;
                return s.url
                    ? `<a class="rag-source" href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${label}</a>`
                    : `<span class="rag-source">${label}</span>`;
            }).join("")
            : "";
    }

    function renderLast() {
        const last = history[history.length - 1];
        const question = history[history.length - 2];
        if (last && last.role === "assistant" && question) {
            renderAnswer(question.content, last.content, last.sources || []);
        } else if (!busy) {
            answerEl.hidden = true;
            if (home) home.classList.remove("chat-active");
        }
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
        const reply = { role: "assistant", content: "", sources: [] };
        renderAnswer(question, "", []);
        answerEl.scrollIntoView({ behavior: "smooth", block: "nearest" });

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
                renderAnswer(question, reply.content, reply.sources);
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
            renderAnswer(question, reply.content, reply.sources);
            if (!reply.failed) { // неудачный вопрос не попадает в историю диалога
                history.push({ role: "user", content: question });
                history.push({ role: "assistant", content: reply.content, sources: reply.sources });
                saveHistory();
            }
            input.focus();
        }
    }

    // ---------------------------------------------------------------- События
    function autoGrow() {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 200) + "px";
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
        renderLast();
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
