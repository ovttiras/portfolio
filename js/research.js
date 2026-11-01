// ================================ Научная работа: публикации, доклады, рецензии
// Публикации берутся из data/publications.json — чтобы добавить статью, достаточно дописать её туда.
(function () {
    const section = document.getElementById("research");
    if (!section) return;

    // фамилия владельца сайта: выделяется в списке авторов
    const OWNER = /^(Tinkov|Тиньков)(\s|$)/;
    const OWNER_NAME = { en: "Tinkov O.V.", ru: "Тиньков О.В." };
    const i18n = {
        en: {
            search: "Search by title, author or keyword…",
            all: "All",
            topics: {
                hdac: "HDAC inhibitors",
                toxicity: "Toxicology",
                kras: "KRAS",
                antiviral: "SARS-CoV-2",
                methods: "Methods & descriptors",
                other: "Other",
                teaching: "Textbooks"
            },
            featured: "Selected",
            stats: [["articles", "research papers"], ["indexed", "in Scopus / Web of Science"], ["vak", "in the VAK list"], ["textbooks", "textbooks"]],
            indexNames: { scopus: "Scopus", wos: "WoS", vak: "VAK", rinc: "RSCI" },
            types: { conference: "Conference paper", proceedings: "Proceedings", textbook: "Textbook" },
            coauthors: "co-authors:",
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
            talkIntro: "Talks and abstracts at scientific conferences.",
            talkSearch: "Search by topic, conference or city…",
            talkStats: [["talks", "talks & abstracts"], ["intl", "international or with international participation"], ["cities", "cities"], ["years", "years"]],
            intl: { full: "International", partial: "With international participation" },
            talkCoauthors: "Co-authors:",
            talkNoTitle: "Talk title to be added"
        },
        ru: {
            search: "Поиск по названию, автору или ключевому слову…",
            all: "Все",
            topics: {
                hdac: "Ингибиторы HDAC",
                toxicity: "Токсикология",
                kras: "KRAS",
                antiviral: "SARS-CoV-2",
                methods: "Методы и дескрипторы",
                other: "Другое",
                teaching: "Учебные издания"
            },
            featured: "Избранные",
            stats: [["articles", "научных статей"], ["indexed", "в Scopus / Web of Science"], ["vak", "в перечне ВАК"], ["textbooks", "учебных пособия"]],
            indexNames: { scopus: "Scopus", wos: "WoS", vak: "ВАК", rinc: "РИНЦ" },
            types: { conference: "Конференция", proceedings: "Сборник трудов", textbook: "Учебное пособие" },
            coauthors: "соавторы:",
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
            talkIntro: "Доклады и тезисы на научных конференциях.",
            talkSearch: "Поиск по теме, конференции или городу…",
            talkStats: [["talks", "докладов и тезисов"], ["intl", "международных и с международным участием"], ["cities", "городов"], ["years", "годы"]],
            intl: { full: "Международная", partial: "С международным участием" },
            talkCoauthors: "Соавторы:",
            talkNoTitle: "Тема доклада уточняется"
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
    let talkQuery = "";

    function lang() {
        const ru = document.getElementById("ru-btn");
        return ru && ru.classList.contains("active") ? "ru" : "en";
    }
    const t = (key) => i18n[lang()][key];
    const $ = (sel) => section.querySelector(sel);

    // поле может быть строкой или {ru, en}
    function loc(value) {
        if (value && typeof value === "object") return value[lang()] || value.ru || value.en || "";
        return value || "";
    }

    // порядок авторов известен не для всех работ: тогда показываем «Тиньков О.В.; соавторы: …»
    function authorList(pub) {
        return pub.authors || [OWNER_NAME[pub.lang === "en" ? "en" : "ru"], ...(pub.coauthors || [])];
    }

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
        const list = authorList(pub).filter((a) => !/^(и др|et al)/.test(a));
        const key = `tinkov${pub.year}${(pub.title.match(/[A-Za-z0-9]+/) || ["work"])[0].toLowerCase()}`;
        const authors = list.map((a) => a.replace(/^(\S+)\s+(.+)$/, "$1, $2")).join(" and ");
        const inBook = pub.type === "conference" || pub.type === "proceedings";
        const fields = [
            ["author", authors],
            ["title", pub.title],
            [pub.type === "textbook" ? "publisher" : inBook ? "booktitle" : "journal", pub.venue],
            ["year", pub.year]
        ];
        if (pub.doi) fields.push(["doi", pub.doi]);
        if (pub.details) fields.push(["note", pub.details]);
        const entry = pub.type === "textbook" ? "book" : inBook ? "inproceedings" : "article";
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
        const index = (p) => p.index || [];
        const values = {
            articles: pubs.filter((p) => p.type !== "textbook").length,
            indexed: pubs.filter((p) => index(p).includes("scopus") || index(p).includes("wos")).length,
            vak: pubs.filter((p) => index(p).includes("vak")).length,
            textbooks: pubs.filter((p) => p.type === "textbook").length
        };
        $(".pub-stats").innerHTML = t("stats")
            .map(([key, label]) => `<div class="pub-stat"><b>${values[key]}</b><span>${label}</span></div>`)
            .join("");
        section.querySelector('[data-count="publications"]').textContent = pubs.length;
    }

    function renderFilters() {
        const counts = {};
        pubs.forEach((p) => p.topics.forEach((tp) => { counts[tp] = (counts[tp] || 0) + 1; }));
        const featured = pubs.filter((p) => p.featured).length;
        const items = [["all", t("all"), pubs.length]]
            .concat(featured ? [["featured", t("featured"), featured]] : [])
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
        if (topic === "featured" ? !pub.featured : topic !== "all" && !pub.topics.includes(topic)) return false;
        if (!query) return true;
        const haystack = [pub.title, pub.venue, authorList(pub).join(" "), pub.abstract || "", pub.year].join(" ").toLowerCase();
        return query.split(/\s+/).every((word) => haystack.includes(word));
    }

    function card(pub) {
        const mark = (a) => (OWNER.test(a) ? `<b>${escapeHtml(a)}</b>` : escapeHtml(a));
        const authors = pub.authors
            ? pub.authors.map(mark).join(", ")
            : `${mark(authorList(pub)[0])}${pub.coauthors && pub.coauthors.length ? `<span class="pub-coauth">; ${t("coauthors")}</span> ${pub.coauthors.map(escapeHtml).join(", ")}` : ""}`;
        const online = /advance online/i.test(pub.details || "");
        const details = (pub.details || "").replace(/\.?\s*Advance online publication/i, "").trim();
        const badges = [
            online ? `<span class="pub-badge">${t("online")}</span>` : "",
            t("types")[pub.type] ? `<span class="pub-badge">${t("types")[pub.type]}</span>` : "",
            ...(pub.index || []).map((ix) => `<span class="pub-index pub-index-${ix}">${t("indexNames")[ix] || ix}</span>`)
        ].join("");
        const topics = pub.topics.map((tp) => `<span class="pub-topic">${escapeHtml(t("topics")[tp] || tp)}</span>`).join("");
        const doiUrl = pub.doi ? `https://doi.org/${pub.doi}` : "";
        const actions = [
            pub.abstract ? `<button type="button" class="pub-action pub-toggle" aria-expanded="false"><i class="fas fa-align-left"></i><span>${t("abstract")}</span><i class="fas fa-chevron-down pub-chevron"></i></button>` : "",
            doiUrl ? `<a class="pub-action" href="${doiUrl}" target="_blank" rel="noopener"><i class="fas fa-arrow-up-right-from-square"></i><span>${t("journal")}</span></a>` : "",
            pub.app ? `<a class="pub-action pub-action-accent" href="${escapeHtml(pub.app.url)}" target="_blank" rel="noopener"><i class="fas fa-flask"></i><span>${t("app")}</span></a>` : "",
            `<button type="button" class="pub-action pub-cite"><i class="fas fa-quote-right"></i><span>${t("cite")}</span></button>`
        ].join("");

        const li = document.createElement("li");
        li.className = "pub";
        li.innerHTML = `
            <article class="pub-card">
                <div class="pub-meta"><span class="pub-venue">${escapeHtml(pub.venue)}</span>${details ? `<span class="pub-details">${escapeHtml(details)}</span>` : ""}${badges}</div>
                <h3 class="pub-title">${doiUrl ? `<a href="${doiUrl}" target="_blank" rel="noopener">${escapeHtml(pub.title)}</a>` : escapeHtml(pub.title)}</h3>
                <p class="pub-authors">${authors}</p>
                <div class="pub-footer">
                    <div class="pub-actions">${actions}</div>
                    <div class="pub-topics">${topics}</div>
                </div>
                ${pub.abstract ? `<div class="pub-abstract" hidden><p>${escapeHtml(pub.abstract)}</p>${doiUrl ? `<span class="pub-doi">DOI: <a href="${doiUrl}" target="_blank" rel="noopener">${escapeHtml(pub.doi)}</a></span>` : ""}</div>` : ""}
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
        $(".talk-intro").textContent = t("talkIntro");
        $(".talk-search-input").placeholder = t("talkSearch");
        if (!talks.length) return;

        // «с международным участием» — отдельная метка, не путаем с международной конференцией
        const intlKind = (talk) => {
            const name = loc(talk.event);
            if (/с международным участием|with international participation/i.test(name)) return "partial";
            return /международн|international/i.test(name) ? "full" : "";
        };
        const intl = (talk) => Boolean(intlKind(talk));
        const years = talks.map((x) => x.year);
        const values = {
            talks: talks.length,
            intl: talks.filter(intl).length,
            cities: new Set(talks.map((x) => loc(x.place)).filter((c) => c && c !== "онлайн" && c !== "online")).size,
            years: `${Math.min(...years)}–${Math.max(...years)}`
        };
        $(".talk-stats").innerHTML = t("talkStats")
            .map(([key, label]) => `<div class="pub-stat"><b>${values[key]}</b><span>${escapeHtml(label)}</span></div>`)
            .join("");
        section.querySelector('[data-count="talks"]').textContent = talks.length;

        const shown = talks.filter((x) => {
            if (!talkQuery) return true;
            const haystack = [x.title, loc(x.event), loc(x.place), x.year, (x.coauthors || []).join(" ")].join(" ").toLowerCase();
            return talkQuery.split(/\s+/).every((word) => haystack.includes(word));
        });
        let year = null;
        $(".talk-list").innerHTML = shown
            .map((x) => {
                const heading = x.year !== year ? `<li class="pub-year" aria-hidden="true">${(year = x.year)}</li>` : "";
                const when = [loc(x.date), loc(x.place)].filter(Boolean).join(" · ");
                return `${heading}<li class="pub talk">
                    <article class="pub-card talk-card">
                        <div class="pub-meta">${when ? `<span class="talk-when"><i class="far fa-calendar"></i>${escapeHtml(when)}</span>` : ""}${intlKind(x) ? `<span class="pub-badge">${t("intl")[intlKind(x)]}</span>` : ""}</div>
                        <h3 class="pub-title">${x.title ? escapeHtml(x.title) : `<span class="talk-tbd">${escapeHtml(t("talkNoTitle"))}</span>`}</h3>
                        <p class="talk-event"><i class="fas fa-person-chalkboard"></i>${escapeHtml(loc(x.event))}</p>
                        ${x.coauthors && x.coauthors.length ? `<p class="pub-authors">${escapeHtml(t("talkCoauthors"))} ${x.coauthors.map(escapeHtml).join(", ")}</p>` : ""}
                    </article>
                </li>`;
            })
            .join("");
        const empty = $(".talk-empty");
        empty.hidden = shown.length > 0;
        empty.textContent = t("empty");
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
    $(".talk-search-input").addEventListener("input", (e) => {
        talkQuery = e.target.value.trim().toLowerCase();
        renderTalks();
    });
    document.querySelectorAll(".lang-btn").forEach((btn) => btn.addEventListener("click", renderAll));

    fetch("data/publications.json")
        .then((resp) => {
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return resp.json();
        })
        .then((data) => {
            // сортировка устойчивая: внутри года сохраняется порядок из файла (избранные — первыми)
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
