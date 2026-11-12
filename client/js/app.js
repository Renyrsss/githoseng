document.addEventListener("DOMContentLoaded", function () {
    const config = window.HELPDESK_CONFIG;

    // Браузер мог оставить у себя старую страницу и подтянуть к ней новый
    // скрипт — тогда разметки, которую он ждёт, просто нет. Просить человека
    // нажать Ctrl+Shift+R бесполезно, поэтому перезагружаемся сами по адресу
    // с меткой времени: такого URL в кэше нет, значит придёт свежий HTML.
    if (!document.querySelector(".categoryList") || !document.querySelector(".layout")) {
        const url = new URL(window.location.href);
        if (!url.searchParams.has("fresh")) {
            url.searchParams.set("fresh", String(Date.now()));
            console.warn("Страница из кэша устарела — обновляю сама");
            window.location.replace(url.toString());
            return;
        }
        console.error("Разметка страницы не совпадает со скриптом даже после обновления");
        return;
    }

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

    // Подразделения: из 1С и портала, их отдаёт корп-система
    let departments = [];
    let departmentsRequest = null;

    checkAppVersion();
    document.querySelectorAll(".departmentField").forEach(attachDepartmentPicker);
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
        if (!checkInputs(inputs, textArea, categoryList, radioInput, departments)) {
            return;
        }

        let query;
        let legacyCategoryId;
        let categoryId = null;
        let section = "";
        radioInput.forEach((item) => {
            if (item.checked) {
                query = item.value;
                legacyCategoryId = item.id;
                categoryId = Number(item.dataset.categoryId) || null;
                section = item.dataset.section || "";
            }
        });

        // Видно сразу, что уходит: раздел и категория. Кому дальше звонить
        // в Telegram, решает корп-система по каталогу.
        console.info(`Заявка · раздел «${section || "?"}» → корп-система`);

        // В заявку уходит номер одними цифрами (77XXXXXXXXX): по нему потом
        // ищется статус, а корп-система нормализует его сама.
        const phoneDigits = readPhone(inputs[0]);
        const phoneApi = config.phoneCountryCode + phoneDigits;


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
            serviceGroupSlug: config.serviceGroupSlug,
            departmentKey: config.departmentKey,
            submissionKey,
        };

        setSending(true);

        axios
            .post(config.corpHelpdeskUrl, legacyPayload)
            .then(() => {
                submissionKey = createSubmissionKey();
                inputs.forEach((item) => {
                    item.value = "";
                    delete item.dataset.digits;
                    delete item.dataset.department;
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
            .catch((err) => {
                console.error("Заявка не отправлена", err);
                alert("Ошибка при отправке! Заявка не зарегистрирована, попробуйте ещё раз.");
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
                radio.dataset.section = item.section || "";
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

    // ── Отделение ────────────────────────────────────────────
    function loadDepartments() {
        if (!departmentsRequest) {
            departmentsRequest = axios
                .get(`${config.corpApiUrl}/api/tickets/legacy/departments`)
                .then((res) => {
                    departments = ((res.data && res.data.data) || [])
                        .map((item) => item.name_ru)
                        .filter(Boolean);
                    if (departments.length === 0) {
                        throw new Error("Список отделений пуст");
                    }
                    return departments;
                })
                .catch((err) => {
                    // Корп-система недоступна — берём снимок из репозитория.
                    // Пустое поле хуже устаревшего списка: в него пишут что попало.
                    departments = window.HELPDESK_DEPARTMENTS || [];
                    console.warn(
                        departments.length > 0
                            ? `Корп-система недоступна, беру список отделений из снимка (${departments.length})`
                            : "Список отделений недоступен, поле останется свободным",
                        err
                    );
                    if (departments.length === 0) {
                        throw err;
                    }
                    return departments;
                });
        }
        return departmentsRequest;
    }

    /**
     * Отделение выбирается из списка, а не печатается: раньше в это поле
     * писали «ТЕСТ», «1 этаж» и прочее, и заявку некуда было отнести.
     * Список приезжает из корп-системы — там он собирается из 1С вместе с
     * карточками сотрудников. Если список не пришёл, поле остаётся обычным
     * текстовым, иначе форма стала бы неотправляемой из-за чужого сбоя.
     */
    function attachDepartmentPicker(input) {
        if (!input) {
            return;
        }

        const list = input.parentNode.querySelector(".suggest__list");
        const row = input.parentNode.parentNode;
        const hint = row.querySelector(".suggest__hint");
        const manual = row.querySelector("[data-manual]");

        // Отделения приезжают из 1С, и там бывает не всё: командированные,
        // подрядчики, новые подразделения. Галочка снимает проверку по списку
        // для этого поля — человек пишет своё, заявка не застревает. Снятая
        // галочка возвращает поле к выбору из списка: передумать можно в любой
        // момент, не перезагружая страницу.
        if (manual) {
            const label = row.querySelector(".fieldRow__label");
            const listLabel = label ? label.textContent : "";
            const listHint = hint ? hint.textContent : "";
            const listPlaceholder = input.placeholder;

            manual.addEventListener("change", () => {
                if (manual.checked) {
                    input.dataset.manual = "1";
                    delete input.dataset.department;
                    close();
                    if (label) label.textContent = "Отдел · впишите вручную";
                    input.placeholder = "Например: Отдел логистики";
                    if (hint) hint.textContent = "Впишите название своего отдела";
                } else {
                    delete input.dataset.manual;
                    // Вписанное вручную в списке обычно не находится, и поиск
                    // сразу показал бы «ничего не нашлось». Оставляем только то,
                    // что в списке есть.
                    if (!departments.includes(input.value.trim())) {
                        input.value = "";
                    }
                    if (label) label.textContent = listLabel;
                    input.placeholder = listPlaceholder;
                    if (hint) hint.textContent = listHint;
                    render();
                }
                input.classList.remove("is-invalid");
                if (hint) hint.classList.remove("is-error");
                input.focus();
            });
        }
        let active = -1;
        let shown = [];

        loadDepartments()
            .then(() => {
                // Список приезжает уже после загрузки страницы. Перерисовываем
                // только если человек в это время стоит в поле — иначе
                // подсказки раскрывались бы сами собой при каждом заходе.
                if (!list.hidden) {
                    render();
                }
            })
            .catch(() => {
                if (hint) hint.textContent = "Список отделений недоступен — впишите вручную";
            });

        const close = () => {
            list.hidden = true;
            list.innerHTML = "";
            active = -1;
            shown = [];
        };

        const choose = (name) => {
            input.value = name;
            input.dataset.department = name;
            input.classList.remove("is-invalid");
            if (hint) {
                hint.textContent = "Выберите своё отделение из списка";
                hint.classList.remove("is-error");
            }
            close();
        };

        const render = () => {
            if (input.dataset.manual === "1") {
                close();
                return;
            }
            const needle = input.value;
            // Показываем все совпадения: список прокручивается, а обрезка до
            // восьми строк прятала половину отделений — их почти восемьдесят.
            shown = rankMatches(departments, needle);
            list.innerHTML = "";

            if (departments.length === 0) {
                close();
                return;
            }

            if (shown.length === 0) {
                const empty = createElement("p", "suggest__empty", "Ничего не нашлось — проверьте написание");
                list.appendChild(empty);
                list.hidden = false;
                return;
            }

            if (hint) {
                hint.textContent =
                    needle.trim() === ""
                        ? `Выберите своё отделение из списка (${departments.length})`
                        : `Найдено: ${shown.length}`;
                hint.classList.remove("is-error");
            }

            shown.forEach((name, index) => {
                const item = createElement("button", "suggest__item", name);
                item.type = "button";
                if (index === active) item.classList.add("is-active");
                item.addEventListener("mousedown", (e) => {
                    e.preventDefault();
                    choose(name);
                });
                list.appendChild(item);
            });
            list.hidden = false;
        };

        input.addEventListener("input", () => {
            delete input.dataset.department;
            active = -1;
            render();
        });

        input.addEventListener("focus", render);

        input.addEventListener("blur", () => {
            window.setTimeout(close, 120);
        });

        input.addEventListener("keydown", (e) => {
            if (list.hidden || shown.length === 0) {
                return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                active = e.key === "ArrowDown"
                    ? (active + 1) % shown.length
                    : (active - 1 + shown.length) % shown.length;
                render();
            } else if (e.key === "Enter") {
                e.preventDefault();
                choose(shown[active >= 0 ? active : 0]);
            } else if (e.key === "Escape") {
                close();
            }
        });
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

});

// Кэш браузера умеет держать старую страницу неделями. Сверяем версию с
// сервером и перезагружаемся один раз, если она разошлась: повторно за ту же
// версию не перезагружаемся, иначе получился бы бесконечный цикл.
function checkAppVersion() {
    const config = window.HELPDESK_CONFIG;
    if (!config.appVersion || typeof window.fetch !== "function") {
        return;
    }

    window
        .fetch(`version.json?ts=${Date.now()}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
            const fresh = data && data.version;
            if (!fresh || fresh === config.appVersion) {
                return;
            }
            const key = "helpdeskReloadedFor";
            if (window.sessionStorage.getItem(key) === fresh) {
                console.warn(
                    `Страница осталась версии ${config.appVersion}, на сервере ${fresh}. ` +
                        "Обновите страницу с Ctrl+Shift+R."
                );
                return;
            }
            window.sessionStorage.setItem(key, fresh);
            window.location.reload();
        })
        .catch(() => {});
}

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
            const source = children.length > 0 ? children : [root];

            return {
                title: root.name_ru,
                hint: "",
                items: source.map((item) => ({
                    key: `category-${item.id}`,
                    value: item.name_ru,
                    categoryId: item.id,
                    section: root.name_ru,
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
            section: group.title,
        })),
    }));
}


const STATUS_CLASS = {
    Сделано: "greenDone",
    "в работе": "yellowInWork",
    "Новая заявка": "blueNewQuery",
    Некорректная: "redInvalid",
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

    const title = createElement("p", "main__catalogId", item.userName);
    if (item.ticketNumber) {
        title.appendChild(createElement("span", "main__catalogNumber", item.ticketNumber));
    }
    card.appendChild(title);
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

// ── Умный поиск по названиям ─────────────────────────────
// Как в MedBridge: порядок слов не важен, «ё» = «е», можно набрать в
// английской раскладке («rfhlbj» → «кардио»), транслитом («kardio») и с
// опечаткой в длинном слове. Названия отделений встречаются и латиницей —
// «Отдел IT», «ОЦМК», — поэтому слово ищется ещё и в транслитерации.
const SEARCH_LATIN_KEYS = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const SEARCH_CYRILLIC_KEYS = "йцукенгшщзхъфывапролджэячсмитьбюё";
const SEARCH_TRANSLIT = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i",
    й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
    т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
    ы: "y", э: "e", ю: "yu", я: "ya", ъ: "", ь: "",
    ә: "a", ғ: "g", қ: "k", ң: "n", ө: "o", ұ: "u", ү: "u", һ: "h", і: "i",
};

function normalizeSearchText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[^0-9a-zа-яәғқңөұүһі]+/g, " ")
        .trim();
}

function transliterate(value) {
    return String(value || "")
        .split("")
        .map((char) => (SEARCH_TRANSLIT[char] !== undefined ? SEARCH_TRANSLIT[char] : char))
        .join("");
}

function swapKeyboardLayout(value) {
    return String(value || "")
        .toLowerCase()
        .split("")
        .map((char) => {
            const latin = SEARCH_LATIN_KEYS.indexOf(char);
            if (latin !== -1) return SEARCH_CYRILLIC_KEYS[latin] || char;
            const cyrillic = SEARCH_CYRILLIC_KEYS.indexOf(char);
            if (cyrillic !== -1) return SEARCH_LATIN_KEYS[cyrillic] || char;
            return char;
        })
        .join("");
}

// Отличаются не больше чем на limit букв (вставка, удаление, замена)
function withinTypos(left, right, limit) {
    if (Math.abs(left.length - right.length) > limit) return false;
    let previous = [];
    for (let j = 0; j <= right.length; j += 1) previous.push(j);
    for (let i = 1; i <= left.length; i += 1) {
        const current = [i];
        let rowMin = i;
        for (let j = 1; j <= right.length; j += 1) {
            current[j] = Math.min(
                current[j - 1] + 1,
                previous[j] + 1,
                previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
            );
            rowMin = Math.min(rowMin, current[j]);
        }
        if (rowMin > limit) return false;
        previous = current;
    }
    return previous[right.length] <= limit;
}

function uniqueFilled(list) {
    return list.filter((item, index) => item && list.indexOf(item) === index);
}

function wordMatches(word, haystack, words) {
    if (haystack.indexOf(word) !== -1) return true;
    if (word.length < 4) return false;
    // Опечатка: в слове целиком или в его начале — человек мог не дописать
    const limit = word.length >= 8 ? 2 : 1;
    return words.some(
        (candidate) =>
            withinTypos(word, candidate, limit) ||
            withinTypos(word, candidate.slice(0, word.length), limit)
    );
}

function matchesQuery(option, needle) {
    const typed = normalizeSearchText(needle);
    if (!typed) return true;
    // Другая раскладка — только если не потерялось ни одной буквы: русское
    // «бухг» в английской раскладке — «,e[u», то есть «e u», и две буквы
    // нашли бы почти всё подряд
    const swapped = normalizeSearchText(swapKeyboardLayout(needle));
    const letters = (text) => String(text || "").replace(/\s+/g, "").length;
    const swappedWhole = letters(swapped) === letters(needle);
    // «,e[u» — это «бухг» в чужой раскладке: знаки съели половину букв, и
    // искать по остаткам «e u» не нужно
    const queries =
        swappedWhole && letters(typed) < letters(needle)
            ? [swapped]
            : uniqueFilled([typed, swappedWhole ? swapped : "", normalizeSearchText(transliterate(typed))]);
    const base = normalizeSearchText(option);
    const targets = uniqueFilled([base, normalizeSearchText(transliterate(base))]);
    return queries.some((query) => {
        const words = query.split(" ").filter(Boolean);
        return targets.some((target) => {
            const targetWords = target.split(" ");
            return words.every((word) => wordMatches(word, target, targetWords));
        });
    });
}

// Совпавшие названия: сначала те, что начинаются с набранного, потом по алфавиту
function rankMatches(list, needle) {
    const typed = normalizeSearchText(needle);
    if (!typed) return list.slice();
    const first = typed.split(" ")[0];
    return list
        .filter((name) => matchesQuery(name, needle))
        .map((name) => {
            const hay = normalizeSearchText(name);
            let rank = 3;
            if (hay.indexOf(typed) === 0) rank = 0;
            else if (hay.split(" ").some((word) => word.indexOf(first) === 0)) rank = 1;
            else if (hay.indexOf(typed) !== -1) rank = 2;
            return { name, rank };
        })
        .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "ru"))
        .map((item) => item.name);
}

function matchesExactly(option, typed) {
    return normalizeSearchText(option) === normalizeSearchText(typed);
}

function checkInputs(inputs, textArea, categoryList, inputsRadio, departments) {
    const config = window.HELPDESK_CONFIG;
    let res = true;
    let firstInvalid = null;
    const hasDepartmentList = Array.isArray(departments) && departments.length > 0;

    inputs.forEach((element) => {
        const isPhone = element.classList.contains("phoneField");
        const isDepartment = element.classList.contains("departmentField");
        let invalid;

        if (isPhone) {
            invalid = (element.dataset.digits || "").length !== config.phoneNationalLength;
        } else if (isDepartment && hasDepartmentList && element.dataset.manual !== "1") {
            // Отделение должно быть выбрано из списка, а не набрано на глаз.
            const typed = element.value.trim();
            const exact = departments.find((name) => matchesExactly(name, typed));
            if (exact) {
                element.value = exact;
                element.dataset.department = exact;
            }
            invalid = !exact;
            const hint = element.parentNode.parentNode.querySelector(".suggest__hint");
            if (hint) {
                hint.textContent = invalid
                    ? "Такого отделения нет в списке — выберите из подсказок"
                    : "Выберите своё отделение из списка";
                hint.classList.toggle("is-error", invalid);
            }
        } else {
            invalid = element.value.trim() === "";
        }

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
 * Статус последней заявки — из корп-системы. Работа с заявкой идёт там, и
 * статус меняется там же; старый Strapi страница больше не опрашивает.
 */
function findLatestQuery(digits) {
    const config = window.HELPDESK_CONFIG;

    return axios
        .get(`${config.corpApiUrl}/api/tickets/legacy/status?phone=${encodeURIComponent(digits)}`)
        .then((res) => {
            const item = res.data && res.data.data;
            if (!item) {
                return null;
            }
            return {
                ticketNumber: item.ticketNumber,
                userName: item.requesterName,
                createdAt: item.createdAt,
                userQuery: item.categoryName || item.serviceName || "",
                userComment: item.comment,
                Progress: item.statusLabel,
            };
        })
        .catch((err) => {
            console.warn("Не удалось получить статус заявки", err);
            return null;
        });
}
