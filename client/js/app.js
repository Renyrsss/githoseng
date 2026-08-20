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
    let statusHint = document.querySelector(".statusHint");
    let catalog = document.querySelector(".main__catalog");

    // Один ключ на одну заполненную форму: если отправка сорвалась и человек
    // нажал кнопку повторно, корп-система вернёт уже созданную заявку вместо
    // дубля. Новый ключ выдаётся только после успешной отправки.
    let submissionKey = createSubmissionKey();
    let sending = false;
    let searchTimer = null;
    let searchRequestId = 0;

    let categoryGroups = [];
    let radioInput = [];

    attachPhoneMask(inputs[0]);
    attachPhoneMask(searchInput);
    forgetRequester();

    loadCategories().then((groups) => {
        categoryGroups = groups;
        renderCategories();
    });

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
        let categoryId = null;
        let service = null;
        radioInput.forEach((item) => {
            if (item.checked) {
                query = item.value;
                legacyCategoryId = item.id;
                categoryId = Number(item.dataset.categoryId) || null;
                service = findService(item.dataset.serviceKey);
            }
        });

        // В заявку уходит номер одними цифрами (77XXXXXXXXX): по нему потом
        // ищется статус, а корп-система нормализует его сама.
        const phoneDigits = readPhone(inputs[0]);
        const phoneApi = config.phoneCountryCode + phoneDigits;

        let massage = `<b>Заявка  ${query}</b>\n`;
        massage += `<b>ФИО : ${inputs[1].value}</b>\n`;
        massage += `<b>Отделение : ${inputs[2].value}</b>\n`;
        massage += `<b>Телеофн : ${formatPhone(phoneDigits)}</b>\n`;
        massage += `<b>Комментарий : ${textArea.value}</b>\n`;
        massage += `<b>Запрос : ${query}</b>\n`;

        const legacyPayload = {
            userName: inputs[1].value,
            userPhone: phoneApi,
            userSide: inputs[2].value,
            userComment: textArea.value,
            userQuery: query,
            // Категория из корп-системы приходит с настоящим id — по нему
            // заявка ложится точно, без сопоставления по тексту.
            categoryId,
            legacyCategoryId,
            legacyEndpoint: service ? service.endpoint : null,
            serviceGroupSlug: config.serviceGroupSlug,
            departmentKey: config.departmentKey,
            submissionKey,
        };

        setSending(true);

        // Старый Strapi знает только три исходные бригады, а Telegram-группа
        // есть не у всех. Чего нет — то пропускается: заявка в любом случае
        // уходит в корп-систему, где её видит диспетчер.
        const legacyRequest = service && service.endpoint
            ? axios.post(`${config.legacyApiUrl}${service.endpoint}`, {
                  data: {
                      userName: legacyPayload.userName,
                      userPhone: legacyPayload.userPhone,
                      userSide: legacyPayload.userSide,
                      userComment: legacyPayload.userComment,
                      userQuery: legacyPayload.userQuery,
                  },
              })
            : Promise.resolve(null);
        const telegramRequest = service && service.botToken && service.chatId
            ? axios.post(`${config.telegramApiUrl}/bot${service.botToken}/sendMessage`, {
                  chat_id: service.chatId,
                  parse_mode: "html",
                  text: massage,
              })
            : Promise.resolve(null);

        // allSettled, а не all: недоступность корп-системы или Telegram больше
        // не показывает ошибку по заявке, которая на самом деле создана.
        Promise.allSettled([
            legacyRequest,
            axios.post(config.corpHelpdeskUrl, legacyPayload),
            telegramRequest,
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
                inputs.forEach((item) => {
                    item.value = "";
                    delete item.dataset.digits;
                });
                textArea.value = "";
                radioInput.forEach((item) => {
                    item.checked = false;
                });
                updateSelectionSummary();
                showSuccess();

                // Тот же номер сразу подставляем в поиск — человек видит
                // свою только что отправленную заявку.
                writePhone(searchInput, phoneDigits);
                refreshQueryList();
            })
            .finally(() => {
                setSending(false);
            });
    }

    // ── Категории ────────────────────────────────────────────
    /**
     * Каталог берётся из корп-системы: что завели в админке, то и появляется в
     * форме. Если корп-система недоступна, работает встроенный список из
     * categories.js — форма не должна умирать вместе с ней.
     */
    function loadCategories() {
        return axios
            .get(config.corpCategoriesUrl)
            .then((res) => {
                const groups = normalizeCorpCatalog((res.data && res.data.data) || []);
                if (!groups || groups.length === 0) {
                    throw new Error("Каталог корп-системы пуст");
                }
                return groups;
            })
            .catch((err) => {
                console.warn("Каталог из корп-системы недоступен, беру встроенный", err);
                return normalizeStaticCatalog(window.HELPDESK_CATEGORIES);
            });
    }

    function renderCategories() {
        categoryList.innerHTML = "";

        categoryGroups.forEach((group) => {
            const wrap = createElement("div", "categoryGroup");

            const toggle = createElement("button", "categoryGroup__toggle");
            toggle.type = "button";
            toggle.appendChild(createElement("span", "categoryGroup__chevron"));

            const title = createElement("span");
            title.appendChild(document.createTextNode(group.title));
            if (group.hint) {
                title.appendChild(createElement("span", "categoryGroup__hint", group.hint));
            }
            toggle.appendChild(title);
            toggle.appendChild(
                createElement("span", "categoryGroup__count", group.items.length)
            );
            toggle.addEventListener("click", () => {
                wrap.classList.toggle("is-open");
            });
            wrap.appendChild(toggle);

            // Внутренний контейнер нужен для плавного раскрытия: анимируется
            // внешняя сетка, а содержимое просто обрезается по высоте.
            const items = createElement("div", "categoryGroup__items");
            const inner = createElement("div", "categoryGroup__itemsInner");

            group.items.forEach((item) => {
                const label = createElement("label", "categoryItem");
                label.dataset.text = item.value.toLowerCase();

                const radio = document.createElement("input");
                radio.type = "radio";
                radio.name = "report";
                radio.className = "radioInput";
                radio.id = item.key;
                radio.value = item.value;
                radio.dataset.categoryId = item.categoryId || "";
                radio.dataset.serviceKey = item.serviceKey || "";
                radio.addEventListener("change", () => {
                    updateSelectionSummary();
                    categoryList.classList.remove("is-invalid");
                });

                label.appendChild(radio);
                label.appendChild(createElement("span", null, item.value));
                inner.appendChild(label);
            });

            items.appendChild(inner);
            wrap.appendChild(items);
            categoryList.appendChild(wrap);
        });

        radioInput = categoryList.querySelectorAll(".radioInput");
        updateSelectionSummary();
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

    // ── Статус последней заявки ──────────────────────────────
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

        const digits = readPhone(searchInput);
        catalog.innerHTML = "";

        // Номер ищется целиком: по куску телефона чужие заявки больше не видны.
        if (digits.length < config.phoneNationalLength) {
            setStatusHint(
                digits.length === 0
                    ? "Покажем последнюю заявку, отправленную с этого номера"
                    : "Введите номер полностью — 10 цифр после +7"
            );
            return;
        }

        setStatusHint("Ищем заявку…");
        searchRequestId += 1;
        const requestId = searchRequestId;

        findLatestQuery(digits).then((item) => {
            if (requestId !== searchRequestId) {
                return;
            }
            if (!item) {
                setStatusHint("Заявок с этого номера не найдено");
                return;
            }
            setStatusHint("Последняя заявка с этого номера");
            catalog.appendChild(buildQueryCard(item));
        });
    }

    function setStatusHint(text) {
        if (statusHint) {
            statusHint.textContent = text;
        }
    }

    // ── Телефон ──────────────────────────────────────────────
    // Код страны зафиксирован, вводятся только 10 национальных цифр,
    // поэтому «бесконечный» ввод и чужие форматы больше невозможны.
    function attachPhoneMask(input) {
        if (!input) {
            return;
        }

        let previous = "";

        const apply = (event) => {
            let digits = toNationalDigits(input.value);
            let formatted = formatPhone(digits);

            // Backspace по скобке или пробелу не должен возвращать их обратно:
            // если разметка не изменилась, убираем ещё одну цифру.
            const deleting =
                event && typeof event.inputType === "string" &&
                event.inputType.indexOf("delete") === 0;
            if (deleting && formatted === previous) {
                digits = digits.slice(0, -1);
                formatted = formatPhone(digits);
            }

            input.value = formatted;
            input.dataset.digits = digits;
            previous = formatted;
            if (digits.length === config.phoneNationalLength) {
                input.classList.remove("is-invalid");
            }
        };

        input.addEventListener("input", apply);
        input.addEventListener("focus", () => {
            if (!input.value) {
                input.value = `+${config.phoneCountryCode} (`;
                previous = input.value;
            }
        });
        input.addEventListener("blur", () => {
            if (!input.dataset.digits) {
                input.value = "";
                previous = "";
            }
        });

        apply();
    }

    function readPhone(input) {
        return (input && input.dataset.digits) || "";
    }

    function writePhone(input, digits) {
        if (!input) {
            return;
        }
        input.value = formatPhone(digits);
        input.dataset.digits = digits;
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

    // Форма общая: телефон и ФИО предыдущего человека не должны в ней
    // оставаться. Ключ от старой версии заодно вычищается.
    function forgetRequester() {
        try {
            window.localStorage.removeItem("helpdeskRequester");
        } catch (err) {
            console.warn("Не удалось очистить данные заявителя", err);
        }
    }

    function setSending(value) {
        sending = value;
        btn.disabled = value;
        btn.textContent = value ? "Отправляем…" : "Отправить заявку";
    }

    function findService(serviceKey) {
        if (!serviceKey) return null;
        return config.services.find((item) => item.key === serviceKey) || null;
    }
});

// ── Каталог ──────────────────────────────────────────────────
// Корп-система отдаёт плоский список с parentId; форме нужны разделы с
// вложенными работами. Раздел без вложений сам становится выбором.
function normalizeCorpCatalog(groups) {
    const config = window.HELPDESK_CONFIG;
    const group = (groups || []).find((item) => item.slug === config.serviceGroupSlug);
    if (!group || !Array.isArray(group.categories)) return null;

    const roots = group.categories.filter((item) => !item.parentId);

    return roots
        .map((root) => {
            const children = group.categories.filter((item) => item.parentId === root.id);
            const serviceKey = resolveServiceKey(root);
            const source = children.length > 0 ? children : [root];

            return {
                title: root.name_ru,
                hint: "",
                items: source.map((item) => ({
                    key: `category-${item.id}`,
                    value: item.name_ru,
                    categoryId: item.id,
                    serviceKey,
                })),
            };
        })
        .filter((section) => section.items.length > 0);
}

function normalizeStaticCatalog(groups) {
    return (groups || []).map((group) => ({
        title: group.title,
        hint: group.hint,
        items: group.items.map((item) => ({
            key: item.id,
            value: item.value,
            categoryId: null,
            serviceKey: group.key,
        })),
    }));
}

// Раздел относится к службе по названию: так работают и исходные три раздела,
// и новые, заведённые в админке.
function resolveServiceKey(section) {
    const config = window.HELPDESK_CONFIG;
    const text = `${section.name_ru || ""} ${section.slug || ""}`;
    const rule = (config.sectionServiceRules || []).find((item) => item.match.test(text));
    return rule ? rule.service : null;
}

const STATUS_CLASS = {
    Сделано: "greenDone",
    "в работе": "yellowInWork",
    "Новая заявка": "blueNewQuery",
};

// Казахстанский номер: код страны отбрасывается, остаются 10 национальных
// цифр. К одному виду приводятся и то, что печатает сама маска (+7 (777…),
// и вставленные 8 777…, +7 777…, 777….
function toNationalDigits(value) {
    const config = window.HELPDESK_CONFIG;
    const code = config.phoneCountryCode;
    const length = config.phoneNationalLength;
    const raw = String(value || "");
    let digits = raw.replace(/\D/g, "");

    if (raw.indexOf(`+${code}`) === 0 && digits.indexOf(code) === 0) {
        // Плюс с кодом — либо наша же разметка, либо вставленный полный номер.
        digits = digits.slice(code.length);
    } else if (digits.length === length + 1 && (digits[0] === "7" || digits[0] === "8")) {
        digits = digits.slice(1);
    }

    // Лишние цифры отбрасываются с конца, иначе номер «уезжал» бы влево.
    return digits.slice(0, length);
}

function formatPhone(digits) {
    const config = window.HELPDESK_CONFIG;
    if (!digits) {
        return "";
    }

    let out = `+${config.phoneCountryCode} (${digits.slice(0, 3)}`;
    if (digits.length >= 3) out += ")";
    if (digits.length > 3) out += ` ${digits.slice(3, 6)}`;
    if (digits.length > 6) out += ` ${digits.slice(6, 8)}`;
    if (digits.length > 8) out += ` ${digits.slice(8, 10)}`;
    return out;
}

// Карточка собирается через DOM, а не через innerHTML: ФИО и комментарий
// приходят от анонимных отправителей и раньше выполнялись как разметка.
function buildQueryCard(item) {
    const parts = formatCreatedAt(item.createdAt);
    const statusClass = STATUS_CLASS[item.Progress] || "greyUnknown";
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
            item.Progress || "Статус уточняется"
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
    const config = window.HELPDESK_CONFIG;
    let res = true;
    let firstInvalid = null;

    inputs.forEach((element) => {
        const isPhone = element.classList.contains("phoneField");
        const invalid = isPhone
            ? (element.dataset.digits || "").length !== config.phoneNationalLength
            : element.value.trim() === "";

        element.classList.toggle("is-invalid", invalid);
        if (invalid) {
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

/**
 * Последняя заявка по номеру. Совпадение по хвосту номера, потому что в старых
 * записях код страны записан по-разному, а хвост из 9 цифр у казахстанского номера
 * уникален. Из каждой службы берётся одна свежая запись, показывается одна
 * самая новая.
 */
function findLatestQuery(digits) {
    const config = window.HELPDESK_CONFIG;
    const tail = digits.slice(-config.statusMatchDigits);
    const query =
        `?filters[userPhone][$endsWith]=${encodeURIComponent(tail)}` +
        `&pagination[pageSize]=1` +
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
                    console.warn(`Не удалось загрузить статус: ${endpoint}`, err);
                    return [];
                })
        )
    ).then((groups) => {
        const all = groups.reduce((acc, group) => acc.concat(group), []);
        all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return all[0] || null;
    });
}
