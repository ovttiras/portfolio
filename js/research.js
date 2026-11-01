// ================================ Научная работа: публикации, доклады, рецензии
// Публикации берутся из data/publications.json — чтобы добавить статью, достаточно дописать её туда.
(function () {
    const section = document.getElementById("research");
    if (!section) return;

    const OWNER = /^Tinkov\b/;
    const i18n = {
        en: {
            search: "Search by title, author or keyword…",
            all: "All",
            topics: {
                hdac: "HDAC inhibitors",
                toxicity: "Toxicology",
                kras: "KRAS",
                antiviral: "SARS-CoV-2",
                methods: "Methods & descriptors"
            },
            stats: [["publications", "publications"], ["first", "as first author"], ["venues", "journals & venues"], ["years", "years"]],
            abstract: "Abstract",
            journal: "Journal",
            app: "Web app",
            cite: "BibTeX",
            copied: "Copied",
            online: "Online first",
            conference: "Conference",
            empty: "Nothing found. Try another query or filter.",
            loadError: "Could not load the publication list.",
            revStats: [["reviews", "verified peer reviews"], ["journals", "journals"], ["top", "for SAR and QSAR in Environmental Research"], ["since", "started reviewing"]],
            revIntro: "Peer reviewer for international journals in cheminformatics, QSAR modelling, toxicology, bioinformatics and drug discovery.",
            revCount: (n) => `${n} ${n === 1 ? "review" : "reviews"}`,
            revSource: "Verified in",
            talkIntro: "Recent conference talks.",
            scope: { international: "International", "national-intl": "All-Russian, with international participation" },
            dateTbd: "Date to be added"
        },
        ru: {
            search: "Поиск по названию, автору или ключевому слову…",
            all: "Все",
            topics: {
                hdac: "Ингибиторы HDAC",
                toxicity: "Токсикология",
                kras: "KRAS",
                antiviral: "SARS-CoV-2",
                methods: "Методы и дескрипторы"
            },
            stats: [["publications", "публикаций"], ["first", "первым автором"], ["venues", "журналов и изданий"], ["years", "годы"]],
            abstract: "Абстракт",
            journal: "Журнал",
            app: "Веб-приложение",
            cite: "BibTeX",
            copied: "Скопировано",
            online: "Online first",
            conference: "Конференция",
            empty: "Ничего не найдено. Попробуйте другой запрос или фильтр.",
            loadError: "Не удалось загрузить список публикаций.",
            revStats: [["reviews", "подтверждённых рецензий"], ["journals", "журналов"], ["top", "для SAR and QSAR in Environmental Research"], ["since", "начало рецензирования"]],
            revIntro: "Рецензент международных журналов по хемоинформатике, QSAR-моделированию, токсикологии, биоинформатике и разработке лекарств.",
            revCount: (n) => `${n} ${plural(n, "рецензия", "рецензии", "рецензий")}`,
            revSource: "Подтверждено в",
            talkIntro: "Последние выступления на научных конференциях.",
            scope: { international: "Международная", "national-intl": "Всероссийская с международным участием" },
            dateTbd: "Дата уточняется"
        }
    };

    // русское склонение: 1 рецензия, 2 рецензии, 5 рецензий
    function plural(n, one, few, many) {
        const mod10 = n % 10, mod100 = n % 100;
        if (mod10 === 1 && mod100 !== 11) return one;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
        return many;
    }

    let pubs = [];
    let reviews = null;
    let talks = [];
    let topic = "all";
    let query = "";

    function lang() {
        const ru = document.getElementById("ru-btn");
        return ru && ru.classList.contains("active") ? "ru" : "en";
    }
    const t = (key) => i18n[lang()][key];
    const $ = (sel) => section.querySelector(sel);

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }

    // ---------------------------------------------------------------- Подвкладки
    section.querySelectorAll(".research-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            section.querySelectorAll(".research-tab").forEach((other) => {
                const active = other === tab;
                other.classList.toggle("active", active);
                other.setAttribute("aria-selected", String(active));
                document.getElementById(`research-${other.dataset.panel}`).hidden = !active;
            });
        });
    });

    // ---------------------------------------------------------------- BibTeX
    function bibtex(pub) {
        const key = `${pub.authors[0].split(" ")[0].toLowerCase()}${pub.year}${pub.title.split(/\W+/)[0].toLowerCase()}`;
        const authors = pub.authors.map((a) => a.replace(/^(\S+)\s+(.+)$/, "$1, $2")).join(" and ");
        const fields = [
            ["author", authors],
            ["title", pub.title],
            [pub.type === "conference" ? "booktitle" : "journal", pub.venue],
            ["year", pub.year],
            ["doi", pub.doi]
        ];
        if (pub.details) fields.push(["note", pub.details]);
        const entry = pub.type === "conference" ? "inproceedings" : "article";
        return `@${entry}{${key},\n` + fields.map(([k, v]) => `  ${k} = {${v}}`).join(",\n") + "\n}";
    }

    async function copy(text, button) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (e) {
            const area = document.createElement("textarea");
            area.value = text;
            document.body.appendChild(area);
            area.select();
            document.execCommand("copy");
            area.remove();
        }
        const label = button.querySelector("span");
        label.textContent = t("copied");
        button.classList.add("done");
        setTimeout(() => {
            label.textContent = t("cite");
            button.classList.remove("done");
        }, 1600);
    }

    // ---------------------------------------------------------------- Отрисовка
    function renderStats() {
        const years = pubs.map((p) => p.year);
        const values = {
            publications: pubs.length,
            first: pubs.filter((p) => OWNER.test(p.authors[0])).length,
            venues: new Set(pubs.map((p) => p.venue)).size,
            years: `${Math.min(...years)}–${Math.max(...years)}`
        };
        $(".pub-stats").innerHTML = t("stats")
            .map(([key, label]) => `<div class="pub-stat"><b>${values[key]}</b><span>${label}</span></div>`)
            .join("");
        section.querySelector('[data-count="publications"]').textContent = pubs.length;
    }

    function renderFilters() {
        const counts = {};
        pubs.forEach((p) => p.topics.forEach((tp) => { counts[tp] = (counts[tp] || 0) + 1; }));
        const items = [["all", t("all"), pubs.length]]
            .concat(Object.keys(t("topics")).filter((k) => counts[k]).map((k) => [k, t("topics")[k], counts[k]]));
        const box = $(".pub-filters");
        box.innerHTML = items
            .map(([key, label, n]) => `<button type="button" class="pub-filter${key === topic ? " active" : ""}" data-topic="${key}">${escapeHtml(label)}<small>${n}</small></button>`)
            .join("");
        box.querySelectorAll(".pub-filter").forEach((btn) => btn.addEventListener("click", () => {
            topic = btn.dataset.topic;
            renderFilters();
            renderList();
        }));
    }

    function matches(pub) {
        if (topic !== "all" && !pub.topics.includes(topic)) return false;
        if (!query) return true;
        const haystack = [pub.title, pub.venue, pub.authors.join(" "), pub.abstract || "", pub.year].join(" ").toLowerCase();
        return query.split(/\s+/).every((word) => haystack.includes(word));
    }

    function card(pub) {
        const authors = pub.authors
            .map((a) => (OWNER.test(a) ? `<b>${escapeHtml(a)}</b>` : escapeHtml(a)))
            .join(", ");
        const online = /advance online/i.test(pub.details || "");
        const details = (pub.details || "").replace(/\.?\s*Advance online publication/i, "").trim();
        const badges = [
            online ? `<span class="pub-badge">${t("online")}</span>` : "",
            pub.type === "conference" ? `<span class="pub-badge">${t("conference")}</span>` : ""
        ].join("");
        const topics = pub.topics.map((tp) => `<span class="pub-topic">${escapeHtml(t("topics")[tp] || tp)}</span>`).join("");
        const doiUrl = `https://doi.org/${pub.doi}`;
        const actions = [
            pub.abstract ? `<button type="button" class="pub-action pub-toggle" aria-expanded="false"><i class="fas fa-align-left"></i><span>${t("abstract")}</span><i class="fas fa-chevron-down pub-chevron"></i></button>` : "",
            `<a class="pub-action" href="${doiUrl}" target="_blank" rel="noopener"><i class="fas fa-arrow-up-right-from-square"></i><span>${t("journal")}</span></a>`,
            pub.app ? `<a class="pub-action pub-action-accent" href="${escapeHtml(pub.app.url)}" target="_blank" rel="noopener"><i class="fas fa-flask"></i><span>${t("app")}</span></a>` : "",
            `<button type="button" class="pub-action pub-cite"><i class="fas fa-quote-right"></i><span>${t("cite")}</span></button>`
        ].join("");

        const li = document.createElement("li");
        li.className = "pub";
        li.innerHTML = `
            <article class="pub-card">
                <div class="pub-meta"><span class="pub-venue">${escapeHtml(pub.venue)}</span>${details ? `<span class="pub-details">${escapeHtml(details)}</span>` : ""}${badges}</div>
                <h3 class="pub-title"><a href="${doiUrl}" target="_blank" rel="noopener">${escapeHtml(pub.title)}</a></h3>
                <p class="pub-authors">${authors}</p>
                <div class="pub-footer">
                    <div class="pub-actions">${actions}</div>
                    <div class="pub-topics">${topics}</div>
                </div>
                ${pub.abstract ? `<div class="pub-abstract" hidden><p>${escapeHtml(pub.abstract)}</p><span class="pub-doi">DOI: <a href="${doiUrl}" target="_blank" rel="noopener">${escapeHtml(pub.doi)}</a></span></div>` : ""}
            </article>`;

        const toggle = li.querySelector(".pub-toggle");
        if (toggle) {
            toggle.addEventListener("click", () => {
                const box = li.querySelector(".pub-abstract");
                box.hidden = !box.hidden;
                toggle.setAttribute("aria-expanded", String(!box.hidden));
                li.classList.toggle("open", !box.hidden);
            });
        }
        li.querySelector(".pub-cite").addEventListener("click", (e) => copy(bibtex(pub), e.currentTarget));
        return li;
    }

    function renderList() {
        const list = $(".pub-list");
        list.innerHTML = "";
        let year = null;
        const shown = pubs.filter(matches);
        shown.forEach((pub) => {
            if (pub.year !== year) {
                year = pub.year;
                const heading = document.createElement("li");
                heading.className = "pub-year";
                heading.setAttribute("aria-hidden", "true");
                heading.textContent = year;
                list.appendChild(heading);
            }
            list.appendChild(card(pub));
        });
        const empty = $(".pub-empty");
        empty.hidden = shown.length > 0;
        empty.textContent = t("empty");
    }

    function renderReviews() {
        if (!reviews) return;
        const journals = reviews.journals.slice().sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        const total = journals.reduce((sum, j) => sum + j.count, 0);
        const max = journals[0].count;
        const values = { reviews: total, journals: journals.length, top: max, since: reviews.since };
        $(".rev-stats").innerHTML = t("revStats")
            .map(([key, label]) => `<div class="pub-stat"><b>${values[key]}</b><span>${escapeHtml(label)}</span></div>`)
            .join("");
        $(".rev-intro").textContent = t("revIntro");
        $(".rev-list").innerHTML = journals
            .map((j) => `<li class="rev-item">
                    <div class="rev-row"><span class="rev-name">${escapeHtml(j.name)}</span><span class="rev-count">${escapeHtml(t("revCount")(j.count))}</span></div>
                    <div class="rev-bar"><i style="width:${Math.max(4, (j.count / max) * 100)}%"></i></div>
                </li>`)
            .join("");
        $(".rev-source").innerHTML = `<i class="fas fa-circle-check"></i>${escapeHtml(t("revSource"))} <a href="${escapeHtml(reviews.source.url)}" target="_blank" rel="noopener">${escapeHtml(reviews.source.name)}</a>`;
        section.querySelector('[data-count="reviews"]').textContent = total;
    }

    function renderTalks() {
        const l = lang();
        $(".talk-intro").textContent = t("talkIntro");
        $(".talk-list").innerHTML = talks
            .map((talk) => {
                const when = [talk.date[l], talk.place[l]].filter(Boolean).join(" · ");
                const scope = t("scope")[talk.scope];
                return `<li class="talk">
                    <div class="talk-dot"><i class="fas fa-microphone-lines"></i></div>
                    <article class="pub-card talk-card">
                        <div class="pub-meta">${when ? `<span class="talk-when"><i class="far fa-calendar"></i>${escapeHtml(when)}</span>` : `<span class="talk-when talk-tbd">${escapeHtml(t("dateTbd"))}</span>`}${scope ? `<span class="pub-badge">${escapeHtml(scope)}</span>` : ""}</div>
                        <h3 class="pub-title">${escapeHtml(talk.name[l])}</h3>
                    </article>
                </li>`;
            })
            .join("");
    }

    function renderAll() {
        $(".pub-search-input").placeholder = t("search");
        renderReviews();
        renderTalks();
        if (!pubs.length) return;
        renderStats();
        renderFilters();
        renderList();
    }

    $(".pub-search-input").addEventListener("input", (e) => {
        query = e.target.value.trim().toLowerCase();
        renderList();
    });
    document.querySelectorAll(".lang-btn").forEach((btn) => btn.addEventListener("click", renderAll));

    fetch("data/publications.json")
        .then((resp) => {
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return resp.json();
        })
        .then((data) => {
            pubs = data.slice().sort((a, b) => b.year - a.year);
            renderAll();
        })
        .catch((err) => {
            console.warn("Publications:", err);
            const empty = $(".pub-empty");
            empty.hidden = false;
            empty.textContent = t("loadError");
        });

    fetch("data/talks.json")
        .then((resp) => {
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return resp.json();
        })
        .then((data) => {
            talks = data;
            renderTalks();
        })
        .catch((err) => console.warn("Talks:", err));

    fetch("data/reviews.json")
        .then((resp) => {
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return resp.json();
        })
        .then((data) => {
            reviews = data;
            renderReviews();
        })
        .catch((err) => console.warn("Reviews:", err));

    renderAll();
})();
