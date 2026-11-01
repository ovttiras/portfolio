// ================================ Подвкладки (Научная работа, Портфолио)
// Кнопка .research-tab с data-panel="x" внутри .research-tabs[data-prefix="p"] показывает панель #p-x.
document.querySelectorAll(".research-tabs[data-prefix]").forEach((tabs) => {
    const buttons = tabs.querySelectorAll(".research-tab");
    buttons.forEach((tab) => {
        tab.addEventListener("click", () => {
            buttons.forEach((other) => {
                const active = other === tab;
                other.classList.toggle("active", active);
                other.setAttribute("aria-selected", String(active));
                document.getElementById(`${tabs.dataset.prefix}-${other.dataset.panel}`).hidden = !active;
            });
        });
    });
});
