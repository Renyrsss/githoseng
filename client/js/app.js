document.addEventListener("DOMContentLoaded", function () {
    const config = window.HELPDESK_CONFIG;

    let form = document.querySelector(".layout");
    let success = document.querySelector(".success");
    let successImg = document.querySelector(".success__img");
    let categoryList = document.querySelector(".categoryList");
    let categoryEmpty = document.querySelector(".categoryEmpty");
    let categorySearch = document.querySelector(".categorySearch");
    let selectionSummary = document.querySelector("#selectionSummary");
    let inputs = document.querySelectorAll(".main__inputs");
    let textArea = document.querySelector("textarea");
    let btn = document.querySelector(".btn__submit");
    let searchInput = document.querySelector(".main__searchInput");
    let catalog = document.querySelector(".main__catalog");

    // Один ключ на одну заполненную форму: если отправка сорвалась и человек
    // нажал кнопку повторно, корп-система вернёт уже созданную заявку вместо
    // дубля. Новый ключ выдаётся только после успешной отправки.
    let submissionKey = createSubmissionKey();
    let sending = false;
    let searchTimer = null;
    let searchRequestId = 0;

    renderCategories();
    restoreRequester();

    let radioInput = categoryList.querySelectorAll(".radioInput");

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        submit();
    });

    function submit() {
        if (sending) {
            return;
        }
        if (!checkInputs(inputs, textArea, categoryList, radioInput)) {
            return;
        }

        let query;
        let legacyCategoryId;
        let service = null;
        radioInput.forEach((item) => {
            if (item.checked) {
                query = item.value;
                legacyCategoryId = item.id;
                service = findService(item.id);
            }
        });

        if (!service) {
            alert("Не удалось определить службу для выбранной категории!");
            return;
        }

        let massage = `<b>Заявка  ${query}</b>\n`;
        massage += `<b>ФИО : ${inputs[1].value}</b>\n`;
        massage += `<b>Отделение : ${inputs[2].value}</b>\n`;
        massage += `<b>Телеофн : ${inputs[0].value}</b>\n`;
        massage += `<b>Комментарий : ${textArea.value}</b>\n`;
        massage += `<b>Запрос : ${query}</b>\n`;

        const legacyPayload = {
            userName: inputs[1].value,
            userPhone: inputs[0].value,
            userSide: inputs[2].value,
            userComment: textArea.value,
            userQuery: query,
            legacyCategoryId,
            legacyEndpoint: service.endpoint,
            serviceGroupSlug: config.serviceGroupSlug,
            departmentKey: config.departmentKey,
            submissionKey,
        };

        setSending(true);

        // allSettled, а не all: недоступность корп-системы или Telegram больше
        // не показывает ошибку по заявке, которая на самом деле создана.
        Promise.allSettled([
            axios.post(`${config.legacyApiUrl}${service.endpoint}`, {
                data: {
                    userName: legacyPayload.userName,
                    userPhone: legacyPayload.userPhone,
                    userSide: legacyPayload.userSide,
                    userComment: legacyPayload.userComment,
                    userQuery: legacyPayload.userQuery,
                },
            }),
            axios.post(config.corpHelpdeskUrl, legacyPayload),
            axios.post(
                `${config.telegramApiUrl}/bot${service.botToken}/sendMessage`,
                {
                    chat_id: service.chatId,
                    parse_mode: "html",
                    text: massage,
                }
            ),
        ])
            .then((results) => {
                const [legacyResult, corpResult, telegramResult] = results;
                logRejected("Старый HelpDesk", legacyResult);
                logRejected("Корп-система", corpResult);
                logRejected("Telegram", telegramResult);

                if (
                    legacyResult.status === "rejected" &&
                    corpResult.status === "rejected"
                ) {
                    alert(
                        "Ошибка при отправке! Заявка не зарегистрирована, попробуйте ещё раз."
                    );
                    return;
                }

                submissionKey = createSubmissionKey();
                rememberRequester();
                textArea.value = "";
                radioInput.forEach((item) => {
                    item.checked = false;
                });
                updateSelectionSummary();
                showSuccess();

                // Телефон остаётся в поиске: человек тут же видит свою заявку.
                if (searchInput && !searchInput.value.trim()) {
                    searchInput.value = inputs[0].value.trim();
                }
                refreshQueryList();
            })
            .finally(() => {
                setSending(false);
            });
    }

    // ── Категории ────────────────────────────────────────────
    function renderCategories() {
        const groups = window.HELPDESK_CATEGORIES || [];
        categoryList.innerHTML = "";

        groups.forEach((group, index) => {
            const wrap = createElement("div", "categoryGroup");
            wrap.dataset.group = group.key;
            if (index === 0) {
                wrap.classList.add("is-open");
            }

            const toggle = createElement("button", "categoryGroup__toggle");
            toggle.type = "button";
            toggle.appendChild(createElement("span", "categoryGroup__chevron"));

            const title = createElement("span");
            title.appendChild(document.createTextNode(group.title));
            title.appendChild(createElement("span", "categoryGroup__hint", group.hint));
            toggle.appendChild(title);
            toggle.appendChild(
                createElement("span", "categoryGroup__count", group.items.length)
            );
            toggle.addEventListener("click", () => {
                wrap.classList.toggle("is-open");
            });
            wrap.appendChild(toggle);

            const items = createElement("div", "categoryGroup__items");
            group.items.forEach((item) => {
                const label = createElement("label", "categoryItem");
                label.dataset.text = item.value.toLowerCase();

                const radio = document.createElement("input");
                radio.type = "radio";
                radio.name = "report";
                radio.className = "radioInput";
                radio.id = item.id;
                radio.value = item.value;
                radio.addEventListener("change", () => {
                    updateSelectionSummary();
                    categoryList.classList.remove("is-invalid");
                });

                label.appendChild(radio);
                label.appendChild(createElement("span", null, item.value));
                items.appendChild(label);
            });

            wrap.appendChild(items);
            categoryList.appendChild(wrap);
        });
    }

    function updateSelectionSummary() {
        let chosen = null;
        radioInput.forEach((item) => {
            if (item.checked) {
                chosen = item.value;
            }
        });

        categoryList.querySelectorAll(".categoryItem").forEach((label) => {
            const radio = label.querySelector(".radioInput");
            label.classList.toggle("is-selected", Boolean(radio && radio.checked));
        });

        selectionSummary.textContent = chosen
            ? `Выбрано: ${chosen}`
            : "Категория не выбрана";
        selectionSummary.classList.toggle("is-chosen", Boolean(chosen));
    }

    if (categorySearch) {
        categorySearch.addEventListener("input", () => {
            const needle = categorySearch.value.trim().toLowerCase();
            let visibleTotal = 0;

            categoryList.querySelectorAll(".categoryGroup").forEach((group) => {
                let visible = 0;
                group.querySelectorAll(".categoryItem").forEach((label) => {
                    const match = !needle || label.dataset.text.indexOf(needle) !== -1;
                    label.hidden = !match;
                    if (match) visible += 1;
                });

                group.hidden = visible === 0;
                visibleTotal += visible;
                // При поиске разделы раскрываются сами, иначе совпадение не видно.
                if (needle) {
                    group.classList.toggle("is-open", visible > 0);
                }
            });

            categoryEmpty.hidden = visibleTotal > 0;
        });
    }

    // ── Поиск заявок по телефону ─────────────────────────────
    if (searchInput) {
        searchInput.addEventListener("input", () => {
            window.clearTimeout(searchTimer);
            searchTimer = window.setTimeout(refreshQueryList, config.searchDebounceMs);
        });
    }

    function refreshQueryList() {
        if (!searchInput || !catalog) {
            return;
        }

        const phone = searchInput.value.trim();
        if (phone.length < config.searchMinDigits) {
            renderQueryList([]);
            return;
        }

        // Ответы приходят не по порядку: показываем только последний запрос.
        searchRequestId += 1;
        const requestId = searchRequestId;

        searchQueriesByPhone(phone).then((items) => {
            if (requestId === searchRequestId) {
                renderQueryList(items);
            }
        });
    }

    function renderQueryList(items) {
        catalog.innerHTML = "";
        items.forEach((item) => {
            const statusClass = STATUS_CLASS[item.Progress];
            if (statusClass) {
                catalog.appendChild(buildQueryCard(item, statusClass));
            }
        });
    }

    // ── Мелочи формы ─────────────────────────────────────────
    function showSuccess() {
        success.style.display = "block";
        successImg.classList.add("successLoadingActive");
        setTimeout(() => {
            success.style.display = "none";
            successImg.classList.remove("successLoadingActive");
        }, 3400);
    }

    // ФИО и отделение у одного человека не меняются от заявки к заявке.
    function rememberRequester() {
        try {
            window.localStorage.setItem(
                "helpdeskRequester",
                JSON.stringify({
                    phone: inputs[0].value,
                    name: inputs[1].value,
                    department: inputs[2].value,
                })
            );
        } catch (err) {
            console.warn("Не удалось сохранить данные заявителя", err);
        }
    }

    function restoreRequester() {
        try {
            const saved = JSON.parse(
                window.localStorage.getItem("helpdeskRequester") || "{}"
            );
            if (saved.phone) inputs[0].value = saved.phone;
            if (saved.name) inputs[1].value = saved.name;
            if (saved.department) inputs[2].value = saved.department;
        } catch (err) {
            console.warn("Не удалось прочитать данные заявителя", err);
        }
    }

    function setSending(value) {
        sending = value;
        btn.disabled = value;
        btn.textContent = value ? "Отправляем…" : "Отправить заявку";
    }

    function findService(categoryId) {
        return (
            config.services.find((item) =>
                String(categoryId).includes(item.match)
            ) || null
        );
    }
});

const STATUS_CLASS = {
    Сделано: "greenDone",
    "в работе": "yellowInWork",
    "Новая заявка": "blueNewQuery",
};

// Карточка собирается через DOM, а не через innerHTML: ФИО и комментарий
// приходят от анонимных отправителей и раньше выполнялись как разметка.
function buildQueryCard(item, statusClass) {
    const parts = formatCreatedAt(item.createdAt);
    const card = createElement("div", "main__catalogItem");

    card.appendChild(createElement("p", "main__catalogId", item.userName));
    card.appendChild(
        createElement("p", "main__catalogDate", `${parts.date} · ${parts.time}`)
    );
    card.appendChild(createElement("p", "main__catalogItemName", item.userQuery));
    card.appendChild(
        createElement("p", "main__catalogItemComment", item.userComment)
    );

    const progress = createElement("p", "main__catalogItemProgress");
    progress.appendChild(
        createElement(
            "span",
            `main__catalogItemProgressbar ${statusClass}`,
            item.Progress
        )
    );
    card.appendChild(progress);

    return card;
}

function createElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined && text !== null) {
        node.textContent = String(text);
    }
    return node;
}

// Время клиники — UTC+5.
function formatCreatedAt(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return { date: "", time: "" };
    }
    const local = new Date(parsed.getTime() + 5 * 60 * 60 * 1000).toISOString();
    return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function createSubmissionKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function logRejected(label, result) {
    if (result.status === "rejected") {
        console.warn(`Не удалось отправить заявку: ${label}`, result.reason);
    }
}

function checkInputs(inputs, textArea, categoryList, inputsRadio) {
    let res = true;
    let firstInvalid = null;

    inputs.forEach((element) => {
        const empty = element.value.trim() === "";
        element.classList.toggle("is-invalid", empty);
        if (empty) {
            res = false;
            firstInvalid = firstInvalid || element;
        }
    });

    const commentEmpty = textArea.value.trim() === "";
    textArea.classList.toggle("is-invalid", commentEmpty);
    if (commentEmpty) {
        res = false;
        firstInvalid = firstInvalid || textArea;
    }

    let chosen = false;
    inputsRadio.forEach((item) => {
        if (item.checked) {
            chosen = true;
        }
    });
    categoryList.classList.toggle("is-invalid", !chosen);
    if (!chosen) {
        res = false;
        firstInvalid = firstInvalid || categoryList;
    }

    if (firstInvalid && typeof firstInvalid.scrollIntoView === "function") {
        firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return res;
}

// Фильтрация по телефону выполняется на сервере: страница больше не
// выгружает в браузер все заявки всех сотрудников.
function searchQueriesByPhone(phone) {
    const config = window.HELPDESK_CONFIG;
    const query =
        `?filters[userPhone][$startsWith]=${encodeURIComponent(phone)}` +
        `&pagination[pageSize]=${config.searchPageSize}` +
        `&sort=createdAt:desc`;

    return Promise.all(
        config.statusEndpoints.map((endpoint) =>
            axios
                .get(`${config.legacyApiUrl}${endpoint}${query}`)
                .then((res) =>
                    ((res.data && res.data.data) || []).map(
                        (row) => row.attributes
                    )
                )
                .catch((err) => {
                    console.warn(`Не удалось загрузить статусы: ${endpoint}`, err);
                    return [];
                })
        )
    ).then((groups) =>
        groups
            .reduce((all, group) => all.concat(group), [])
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    );
}
